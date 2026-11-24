#!/usr/bin/env node
// Publishes an `expo export` as an over-the-air update on the project's Supabase (README.md in this folder).
//
//   node scripts/updates/publish.mjs --dist <export dir> --runtime <fingerprint> [--message <text>] [--commit <sha>]
//                                    [--force] [--dry-run] [--manifest-out <file>]
//
// Environment: SUPABASE_SERVICE_ROLE_KEY (not needed with --dry-run), optional SUPABASE_URL (must match
// release.config.json), and UPDATES_SIGNING_PRIVATE_KEY (PEM) once certs/certificate.pem is committed.
//
// Order matters for fail-safety: every file is uploaded and then downloaded again and hash-checked, and only then
// is the app_updates row written. A failure anywhere before that leaves the served update unchanged.
import { spawnSync } from 'node:child_process';
import { randomUUID, sign, verify, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUCKET, buildManifest, hashes, manifestUrlFor, planUpdate, sameContent, signatureHeader,
} from './lib.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PLATFORM = 'android';

function parseArgs(argv) {
  const args = { dist: null, runtime: null, message: '', commit: null, force: false, dryRun: false, manifestOut: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--dist') args.dist = argv[++i];
    else if (flag === '--runtime') args.runtime = argv[++i];
    else if (flag === '--message') args.message = argv[++i] ?? '';
    else if (flag === '--commit') args.commit = argv[++i];
    else if (flag === '--manifest-out') args.manifestOut = argv[++i];
    else if (flag === '--force') args.force = true;
    else if (flag === '--dry-run') args.dryRun = true;
    else throw new Error('Unknown argument: ' + flag);
  }
  if (!args.dist || !args.runtime) throw new Error('Usage: publish.mjs --dist <export dir> --runtime <fingerprint> [...]');
  if (args.commit && !/^[0-9a-f]{40}$/.test(args.commit)) throw new Error('--commit must be a full commit SHA');
  args.message = args.message.trim().slice(0, 500);
  return args;
}

/**
 * The app config as the APK was built from it. `public` is what the app may read at run time (it leaves out the
 * code signing settings); `prebuild` is the full config the native project was generated from.
 */
function expoConfig(type) {
  const result = spawnSync('npx', ['expo', 'config', '--type', type, '--json'], { cwd: appRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('expo config failed:\n' + result.stderr);
  return JSON.parse(result.stdout);
}

function service(supabaseUrl, key) {
  const base = supabaseUrl.replace(/\/+$/, '');
  return async (path, init = {}) => {
    const response = await fetch(base + path, {
      ...init, headers: { apikey: key, Authorization: 'Bearer ' + key, ...init.headers }, signal: AbortSignal.timeout(120_000),
    });
    return response;
  };
}

async function failed(response, what) {
  // Supabase error bodies name the problem; they never echo the key.
  return new Error(`${what}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
}

async function ensureBucket(call) {
  const existing = await call('/storage/v1/bucket/' + BUCKET);
  if (existing.ok) {
    const bucket = await existing.json();
    if (!bucket.public) throw new Error(`Storage bucket ${BUCKET} exists but is not public; the app downloads assets without a key`);
    return;
  }
  const created = await call('/storage/v1/bucket', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  // Another run may have created it in between.
  if (!created.ok && created.status !== 409 && !/already exists/i.test(await created.clone().text())) {
    throw await failed(created, 'Creating the storage bucket');
  }
  console.log('Created the public storage bucket ' + BUCKET);
}

async function upload(call, file, bytes) {
  const head = await fetch(file.url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
  if (head.ok && Number(head.headers.get('content-length')) === file.size) return false;
  const response = await call(`/storage/v1/object/${BUCKET}/${file.objectPath}`, {
    method: 'POST', body: bytes,
    // Objects are named by content, so they never change once written.
    headers: { 'Content-Type': file.contentType, 'cache-control': 'max-age=31536000', 'x-upsert': 'true' },
  });
  if (!response.ok) throw await failed(response, 'Uploading ' + file.objectPath);
  return true;
}

/** Downloads a file the way the app will and checks it is byte for byte what the manifest promises. */
async function verifyPublic(file) {
  const response = await fetch(file.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${file.url} is not publicly readable (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hashes(bytes).sha256 !== file.sha256) throw new Error(`${file.url} does not match the exported file`);
}

async function latestManifest(call, runtime) {
  const query = new URLSearchParams({
    select: 'id,manifest', platform: 'eq.' + PLATFORM, runtime_version: 'eq.' + runtime, order: 'created_at.desc,id.desc', limit: '1',
  });
  const response = await call('/rest/v1/app_updates?' + query);
  if (!response.ok) throw await failed(response, 'Reading the latest update (is the app_updates migration applied?)');
  const [row] = await response.json();
  return row ? { id: row.id, manifest: JSON.parse(row.manifest) } : null;
}

/** The `expo-signature` header for the manifest, null while no certificate is committed. Checked before any upload. */
function signManifest(manifest, fullConfig, { dryRun }) {
  const certificateFile = join(appRoot, 'certs/certificate.pem');
  const privateKey = process.env.UPDATES_SIGNING_PRIVATE_KEY?.trim();
  if (!existsSync(certificateFile)) {
    if (privateKey) console.log('::warning::UPDATES_SIGNING_PRIVATE_KEY is set but certs/certificate.pem is not committed; publishing unsigned.');
    return null;
  }
  const keyid = fullConfig.updates?.codeSigningMetadata?.keyid;
  if (!keyid) throw new Error('certs/certificate.pem exists but app.config.ts did not configure code signing');
  if (!privateKey && dryRun) return null;
  if (!privateKey) throw new Error('certs/certificate.pem is committed, so the app accepts only signed updates: set the UPDATES_SIGNING_PRIVATE_KEY secret');
  const signature = sign('sha256', Buffer.from(manifest, 'utf8'), privateKey).toString('base64');
  // The app verifies against the committed certificate; a key that does not belong to it would brick updates.
  const publicKey = new X509Certificate(readFileSync(certificateFile)).publicKey;
  if (!verify('sha256', Buffer.from(manifest, 'utf8'), publicKey, Buffer.from(signature, 'base64'))) {
    throw new Error('UPDATES_SIGNING_PRIVATE_KEY does not belong to certs/certificate.pem');
  }
  return signatureHeader(signature, keyid);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const release = JSON.parse(readFileSync(join(appRoot, 'release.config.json'), 'utf8'));
  const supabaseUrl = release.supabaseUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\/.+/.test(supabaseUrl)) throw new Error('release.config.json names no Supabase project');
  if (process.env.SUPABASE_URL && process.env.SUPABASE_URL.replace(/\/+$/, '') !== supabaseUrl) {
    throw new Error('SUPABASE_URL differs from release.config.json, which is the project the app asks for updates');
  }

  const config = expoConfig('public');
  const updateUrl = manifestUrlFor(supabaseUrl);
  if (config.updates?.url !== updateUrl) throw new Error(`app.config.ts asks ${config.updates?.url} for updates, not ${updateUrl}`);
  if (config.runtimeVersion?.policy !== 'fingerprint') throw new Error('app.config.ts must use the fingerprint runtime policy');

  const dist = resolve(args.dist);
  const metadata = JSON.parse(readFileSync(join(dist, 'metadata.json'), 'utf8'));
  const plan = planUpdate({
    metadata, platform: PLATFORM, runtimeVersion: args.runtime, supabaseUrl, read: (path) => readFileSync(join(dist, path)),
  });
  const total = plan.uploads.reduce((sum, file) => sum + file.size, 0);
  console.log(`Update for runtime ${args.runtime}: ${plan.uploads.length} files, ${(total / 1e6).toFixed(2)} MB`
    + ` (bundle ${(plan.uploads[0].size / 1e6).toFixed(2)} MB)`);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const manifest = buildManifest({
    id, createdAt, runtimeVersion: args.runtime, plan, updateUrl, expoClient: config, message: args.message, commit: args.commit,
  });
  if (args.manifestOut) writeFileSync(args.manifestOut, manifest);
  const signature = signManifest(manifest, expoConfig('prebuild'), args);
  if (args.dryRun) {
    console.log(`Dry run: nothing uploaded or recorded (${signature ? 'signed' : 'unsigned'}).`);
    return;
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY');
  const call = service(supabaseUrl, key);

  const latest = await latestManifest(call, args.runtime);
  if (latest && sameContent(latest.manifest, JSON.parse(manifest)) && !args.force) {
    console.log(`Nothing to publish: update ${latest.id} already serves this code and these assets.`);
    return;
  }

  await ensureBucket(call);
  let uploaded = 0;
  for (const file of plan.uploads) {
    if (await upload(call, file, readFileSync(join(dist, file.source)))) uploaded += 1;
  }
  console.log(`Uploaded ${uploaded} new files; ${plan.uploads.length - uploaded} were already stored.`);
  for (const file of plan.uploads) await verifyPublic(file);
  console.log('Every file is publicly readable and matches its hash.');

  const row = {
    id, platform: PLATFORM, runtime_version: args.runtime, created_at: createdAt, manifest, signature,
    message: args.message, git_commit: args.commit,
  };
  const inserted = await call('/rest/v1/app_updates', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row),
  });
  if (!inserted.ok) throw await failed(inserted, 'Recording the update');
  console.log(`Published update ${id}${signature ? ' (signed)' : ' (unsigned)'}.`);

  // Ask the endpoint the app asks. Before the function is redeployed with the updates route this reports a
  // problem without undoing anything: the row simply waits.
  const served = await fetch(updateUrl, {
    headers: { 'expo-platform': PLATFORM, 'expo-runtime-version': args.runtime, 'expo-protocol-version': '1', accept: 'multipart/mixed' },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await served.text();
  if (served.status === 200 && body.includes(`"id":"${id}"`)) console.log('The manifest endpoint serves it.');
  else console.log(`::warning::The manifest endpoint answered HTTP ${served.status} without this update. Is the api function deployed with the updates route?`);
}

main().catch((error) => {
  console.error('::error::' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
