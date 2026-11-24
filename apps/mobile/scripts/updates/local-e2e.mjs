#!/usr/bin/env node
// End-to-end check of an over-the-air update without a phone or the live project: serves an `expo export` as
// fake Storage and the real API function handler (supabase/functions/api) over local HTTP, then asks for the
// manifest the way expo-updates does and checks the answer against what the client enforces.
//
//   npx expo export --platform android --output-dir /tmp/ota
//   node scripts/updates/local-e2e.mjs --dist /tmp/ota [--runtime <fingerprint>] [--key <private key PEM file>]
//
// Needs `npm ci` both here and at the repository root (the handler imports the backend's dependencies), and
// Node 22.18 or newer to load the handler's TypeScript. With --key, certs/certificate.pem must be present.
// The client-side rules mirrored here are cited from expo-updates 58's Android sources.
import { spawnSync } from 'node:child_process';
import { randomUUID, sign, verify, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { buildManifest, hashes, planUpdate, signatureHeader } from './lib.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(appRoot, 'package.json'));
const { parseMultipart } = require('multitars'); // the multipart library @expo/cli serves manifests with
const { parseDictionary } = require('structured-headers');

const args = { dist: null, runtime: null, key: null };
for (let i = 2; i < process.argv.length; i += 1) {
  const flag = process.argv[i];
  if (flag === '--dist') args.dist = resolve(process.argv[++i]);
  else if (flag === '--runtime') args.runtime = process.argv[++i];
  else if (flag === '--key') args.key = resolve(process.argv[++i]);
  else throw new Error('Unknown argument: ' + flag);
}
if (!args.dist) throw new Error('Usage: local-e2e.mjs --dist <expo export dir> [--runtime <fingerprint>] [--key <pem>]');

const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { cwd: appRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(command + ' ' + commandArgs.join(' ') + ' failed:\n' + result.stderr);
  return result.stdout;
};
const runtime = args.runtime ?? JSON.parse(run('npx', ['expo-updates', 'fingerprint:generate', '--platform', 'android'])).hash;
const publicConfig = JSON.parse(run('npx', ['expo', 'config', '--type', 'public', '--json']));
const checks = [];
const check = (ok, what) => {
  if (!ok) throw new Error('FAILED: ' + what);
  checks.push(what);
};

const { createHandler } = await import(pathToFileURL(join(appRoot, '../../supabase/functions/api/handler.ts')).href);

// One local server plays Supabase: Storage's public objects, PostgREST for app_updates, and the api function.
const objects = new Map();
let row = null;
let restCalls = 0;
const server = createServer();
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + server.address().port;
const handler = createHandler({
  url: base, key: 'publishable', serviceKey: 'service-role',
  fetch: async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    check(url.pathname === '/rest/v1/app_updates' && headers.get('apikey') === 'service-role', 'the endpoint reads app_updates with the service role');
    restCalls += 1;
    const matches = row && url.searchParams.get('platform') === 'eq.android' && url.searchParams.get('runtime_version') === 'eq.' + runtime;
    return Response.json(matches ? [row] : []);
  },
});
server.on('request', async (request, response) => {
  const url = new URL(request.url, base);
  const object = url.pathname.startsWith('/storage/v1/object/public/app-updates/')
    ? objects.get(url.pathname.slice('/storage/v1/object/public/app-updates/'.length)) : undefined;
  if (object) {
    response.writeHead(200, { 'content-type': object.contentType, 'content-length': object.bytes.length }).end(object.bytes);
    return;
  }
  if (url.pathname.startsWith('/functions/v1/api/')) {
    const reply = await handler(new Request(url, { method: request.method, headers: request.headers }));
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(Buffer.from(await reply.arrayBuffer()));
    return;
  }
  response.writeHead(404).end();
});

try {
  // Publish: plan the export, store its files, and record the manifest the way publish.mjs does.
  const metadata = JSON.parse(readFileSync(join(args.dist, 'metadata.json'), 'utf8'));
  const plan = planUpdate({ metadata, platform: 'android', runtimeVersion: runtime, supabaseUrl: base, read: (path) => readFileSync(join(args.dist, path)) });
  for (const file of plan.uploads) objects.set(file.objectPath, { bytes: readFileSync(join(args.dist, file.source)), contentType: file.contentType });
  const updateUrl = base + '/functions/v1/api/v1/updates/manifest';
  const id = randomUUID();
  const manifest = buildManifest({ id, createdAt: new Date().toISOString(), runtimeVersion: runtime, plan, updateUrl,
    expoClient: publicConfig, message: 'local end-to-end check' });
  let signature = null;
  let certificate = null;
  let keyid = null;
  if (args.key) {
    const certificateFile = join(appRoot, 'certs/certificate.pem');
    check(existsSync(certificateFile), 'certs/certificate.pem is present for a signed run');
    certificate = new X509Certificate(readFileSync(certificateFile));
    keyid = JSON.parse(run('npx', ['expo', 'config', '--type', 'prebuild', '--json'])).updates.codeSigningMetadata.keyid;
    signature = signatureHeader(sign('sha256', Buffer.from(manifest), readFileSync(args.key, 'utf8')).toString('base64'), keyid);
  }
  row = { id, manifest, signature };

  // Ask as the Android client does (FileDownloader.createRequestForRemoteUpdate).
  const clientHeaders = {
    accept: 'multipart/mixed,application/expo+json,application/json', 'expo-platform': 'android', 'expo-protocol-version': '1',
    'expo-api-version': '1', 'expo-updates-environment': 'BARE', 'expo-runtime-version': runtime,
    'expo-current-update-id': randomUUID(), 'expo-embedded-update-id': randomUUID(),
    ...(signature ? { 'expo-expect-signature': 'sig, keyid="x", alg="rsa-v1_5-sha256"' } : {}),
  };
  const response = await fetch(updateUrl, { headers: clientHeaders });
  check(response.status === 200, 'a newer update answers 200');
  check(response.headers.get('expo-protocol-version') === '1', 'expo-protocol-version: 1');
  check(response.headers.get('expo-sfv-version') === '0', 'expo-sfv-version: 0');
  check(response.headers.get('cache-control') === 'private, max-age=0', 'cache-control: private, max-age=0');
  const contentType = response.headers.get('content-type');
  check(/^multipart\/mixed; boundary=/.test(contentType), 'content-type is multipart/mixed with a boundary (FileDownloader: contentType().type == "multipart")');

  const parts = [];
  for await (const part of parseMultipart(Readable.toWeb(Readable.from(Buffer.from(await response.arrayBuffer()))), { contentType })) {
    parts.push({ name: part.name, headers: part.headers, body: Buffer.from(await part.arrayBuffer()).toString('utf8') });
  }
  const manifestPart = parts.find((part) => part.name === 'manifest');
  check(parts.length === 1 && manifestPart, 'multitars parses exactly one part named "manifest" (content-disposition name parameter)');
  check(manifestPart.body === manifest, 'the manifest part is byte-identical to the stored manifest');

  const served = JSON.parse(manifestPart.body);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  check(uuid.test(served.id), 'id is a UUID (UUID.fromString)');
  check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(served.createdAt), 'createdAt is ISO 8601 with milliseconds (UpdatesUtils.parseDateString)');
  check(served.runtimeVersion === runtime, 'runtimeVersion matches the request');
  check(typeof served.extra?.scopeKey === 'string' && served.extra.expoClient?.slug === 'dayframe', 'extra carries scopeKey and the app config (Constants.expoConfig)');
  const safe = (name) => !/[\\/]/.test(name) && name !== '.' && name !== '..' && !name.includes('\0');
  let downloaded = 0;
  for (const asset of [served.launchAsset, ...served.assets]) {
    check(typeof asset.key === 'string' && typeof asset.url === 'string' && typeof asset.hash === 'string', 'asset ' + asset.key + ' has key, url and hash');
    check(asset === served.launchAsset || typeof asset.fileExtension === 'string', 'asset ' + asset.key + ' has a fileExtension (assets.getString)');
    check(safe(asset.key + (asset.fileExtension ?? '')), 'asset ' + asset.key + ' makes a safe file name (UpdatesUtils.isSafeFilename)');
    const bytes = Buffer.from(await (await fetch(asset.url)).arrayBuffer());
    downloaded += bytes.length;
    check(hashes(bytes).sha256 === asset.hash, 'asset ' + asset.key + ' matches its base64url SHA-256 (verifySHA256AndWriteToFile)');
  }

  if (signature) {
    // A strict RFC 8941 parser (the one @expo/cli signs development manifests with), as expo-structured-headers reads it.
    const fields = Object.fromEntries([...parseDictionary(manifestPart.headers['expo-signature'])].map(([key, [value]]) => [key, value]));
    check(fields.alg === 'rsa-v1_5-sha256' && fields.keyid === keyid, 'expo-signature is a structured dictionary naming the configured key and rsa-v1_5-sha256 (SignatureHeaderInfo)');
    check(verify('sha256', Buffer.from(manifestPart.body), certificate.publicKey, Buffer.from(fields.sig, 'base64')),
      'the signature verifies with the committed certificate (SHA256withRSA over the manifest part)');
    check(certificate.verify(certificate.publicKey) && (certificate.keyUsage ?? []).includes('1.3.6.1.5.5.7.3.3'),
      'the certificate is self-signed for code signing (CertificateChain)');
  }

  const again = await fetch(updateUrl, { headers: { ...clientHeaders, 'expo-current-update-id': id.toUpperCase() } });
  check(again.status === 204 && again.headers.get('expo-protocol-version') === '1' && (await again.text()) === '',
    'the running update answers 204 with expo-protocol-version: 1 (no update)');
  const other = await fetch(updateUrl, { headers: { ...clientHeaders, 'expo-runtime-version': 'another-runtime' } });
  check(other.status === 204, 'another runtime (an APK with different native code) gets no update');
  if (!signature) {
    const strict = await fetch(updateUrl, { headers: { ...clientHeaders, 'expo-expect-signature': 'sig' } });
    check(strict.status === 409, 'a client that requires signatures is refused an unsigned update');
  }
  check(restCalls >= 3, 'every manifest request went through the database lookup');

  const bundle = plan.uploads[0];
  const bundleBytes = objects.get(bundle.objectPath).bytes;
  console.log(checks.map((line) => 'ok  ' + line).join('\n'));
  console.log(`\nruntime ${runtime}, ${signature ? 'signed' : 'unsigned'}`);
  console.log(`bundle ${(bundle.size / 1e6).toFixed(2)} MB (${(gzipSync(bundleBytes).length / 1e6).toFixed(2)} MB gzipped), `
    + `${plan.assets.length} assets ${((downloaded - bundle.size) / 1e6).toFixed(2)} MB, all fetched and verified`);
} finally {
  server.close();
}
