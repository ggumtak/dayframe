import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { test } from 'node:test';

import {
  buildManifest, contentTypeFor, fingerprintChanges, hashes, manifestUrlFor, planUpdate, sameContent, scopeKeyFor,
  signatureHeader,
} from './lib.mjs';

const supabaseUrl = 'https://wasffexunmarprxpsawf.supabase.co/';
const runtime = 'bf6c4f813ec7c420dc7fdf1b44dea5e5bd95e5cc';
const files = {
  '_expo/static/js/android/index-abc.hbc': Buffer.from('bytecode'),
  'assets/0a328cd9c1afd0afe8e3b1ec5165b1b4': Buffer.from('png bytes'),
  'assets/ca4b48e04dc1ce10bfbddb262c8b835f': Buffer.from('font bytes'),
};
const metadata = { version: 0, bundler: 'metro', fileMetadata: { android: {
  bundle: '_expo/static/js/android/index-abc.hbc',
  assets: [{ path: 'assets/0a328cd9c1afd0afe8e3b1ec5165b1b4', ext: 'png' }, { path: 'assets/ca4b48e04dc1ce10bfbddb262c8b835f', ext: 'ttf' }],
} } };
const plan = () => planUpdate({ metadata, platform: 'android', runtimeVersion: runtime, supabaseUrl, read: (path) => files[path] });

test('hashes are what expo-updates checks: base64url SHA-256 without padding, and an MD5 key', () => {
  const bytes = Buffer.from('hello');
  assert.deepEqual(hashes(bytes), {
    sha256: createHash('sha256').update(bytes).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    md5: '5d41402abc4b2a76b9719d911017c592',
  });
  assert.doesNotMatch(hashes(Buffer.from('any?')).sha256, /[+/=]/);
});

test('an export becomes content-addressed uploads and manifest assets', () => {
  const { uploads, launchAsset, assets } = plan();
  const bundle = hashes(files['_expo/static/js/android/index-abc.hbc']);
  assert.deepEqual(launchAsset, {
    hash: bundle.sha256, key: bundle.md5, contentType: 'application/javascript', fileExtension: '.bundle',
    url: `https://wasffexunmarprxpsawf.supabase.co/storage/v1/object/public/app-updates/android/${runtime}/${bundle.md5}.hbc`,
  });
  assert.equal(uploads.length, 3);
  assert.equal(uploads[0].objectPath, `android/${runtime}/${bundle.md5}.hbc`);
  assert.deepEqual(assets.map((asset) => [asset.fileExtension, asset.contentType]), [['.png', 'image/png'], ['.ttf', 'font/ttf']]);
  // Keys and extensions make the client's file names (key + fileExtension): no separators allowed.
  for (const asset of [launchAsset, ...assets]) assert.match(asset.key + asset.fileExtension, /^[0-9a-f]{32}\.[a-z]+$/);
  assert.throws(() => planUpdate({ metadata: { fileMetadata: {} }, platform: 'android', runtimeVersion: runtime, supabaseUrl, read: () => Buffer.alloc(0) }),
    /no android bundle/);
  assert.throws(() => planUpdate({ metadata, platform: 'android', runtimeVersion: '../x', supabaseUrl, read: (path) => files[path] }),
    /Invalid runtime version/);
  const sneaky = { fileMetadata: { android: { ...metadata.fileMetadata.android, assets: [{ path: 'assets/0a328cd9c1afd0afe8e3b1ec5165b1b4', ext: '../png' }] } } };
  assert.throws(() => planUpdate({ metadata: sneaky, platform: 'android', runtimeVersion: runtime, supabaseUrl, read: (path) => files[path] }),
    /Unexpected asset extension/);
});

test('the manifest has every field protocol 1 requires and carries the app config for Constants.expoConfig', () => {
  const updateUrl = manifestUrlFor(supabaseUrl);
  assert.equal(updateUrl, 'https://wasffexunmarprxpsawf.supabase.co/functions/v1/api/v1/updates/manifest');
  const text = buildManifest({
    id: '0f8b7c1e-8d0a-4c55-9a43-5a3c2d1e0b9f', createdAt: '2026-11-24T03:00:00.000Z', runtimeVersion: runtime, plan: plan(),
    updateUrl, expoClient: { name: 'Dayframe', version: '1.9.0' }, message: '빠른 추가 개선', commit: 'a'.repeat(40),
  });
  const manifest = JSON.parse(text);
  assert.deepEqual(Object.keys(manifest), ['id', 'createdAt', 'runtimeVersion', 'launchAsset', 'assets', 'metadata', 'extra']);
  assert.equal(manifest.extra.scopeKey, scopeKeyFor(updateUrl));
  assert.equal(manifest.extra.scopeKey, 'https://wasffexunmarprxpsawf.supabase.co');
  assert.equal(manifest.extra.expoClient.version, '1.9.0');
  assert.equal(manifest.extra.message, '빠른 추가 개선');
  for (const asset of [manifest.launchAsset, ...manifest.assets]) {
    assert.deepEqual(Object.keys(asset).sort(), ['contentType', 'fileExtension', 'hash', 'key', 'url']);
  }
});

test('republishing the same code is detected regardless of asset order', () => {
  const a = JSON.parse(buildManifest({ id: '1', createdAt: 'x', runtimeVersion: runtime, plan: plan(), updateUrl: manifestUrlFor(supabaseUrl), expoClient: {} }));
  const b = { ...a, id: '2', assets: [...a.assets].reverse() };
  assert.equal(sameContent(a, b), true);
  assert.equal(sameContent(a, { ...b, launchAsset: { ...b.launchAsset, hash: 'other' } }), false);
  assert.equal(sameContent(a, { ...b, assets: b.assets.slice(1) }), false);
  assert.equal(sameContent(a, null), false);
});

test('the signature header is the dictionary expo-updates parses, and verifies over the exact manifest bytes', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const manifest = '{"id":"x","extra":{"message":"한글"}}';
  const signature = sign('sha256', Buffer.from(manifest, 'utf8'), privateKey).toString('base64');
  const header = signatureHeader(signature, 'dayframe-0123456789ab');
  assert.equal(header, `sig="${signature}", keyid="dayframe-0123456789ab", alg="rsa-v1_5-sha256"`);
  const sig = /sig="([^"]+)"/.exec(header)[1];
  assert.equal(verify('sha256', Buffer.from(manifest, 'utf8'), publicKey, Buffer.from(sig, 'base64')), true);
  assert.throws(() => signatureHeader('not base64!', 'k'), /base64/);
  assert.throws(() => signatureHeader(signature, 'bad"id'), /key id/);
});

test('fingerprint changes name the inputs that need a new APK', () => {
  const before = { hash: 'a', sources: [
    { type: 'contents', id: 'expoConfig', hash: '1' },
    { type: 'package', filePath: 'node_modules/expo-camera/package.json', hash: '2' },
    { type: 'dir', filePath: 'modules/apk-installer/android', hash: '3' },
  ] };
  const after = { hash: 'b', sources: [
    { type: 'contents', id: 'expoConfig', hash: '9' },
    { type: 'dir', filePath: 'modules/apk-installer/android', hash: '3' },
    { type: 'package', filePath: 'node_modules/expo-updates/package.json', hash: '4' },
  ] };
  assert.deepEqual(fingerprintChanges(before, after), [
    { change: 'changed', source: 'contents:expoConfig' },
    { change: 'removed', source: 'package:node_modules/expo-camera/package.json' },
    { change: 'added', source: 'package:node_modules/expo-updates/package.json' },
  ]);
  assert.deepEqual(fingerprintChanges(after, after), []);
});

test('content types cover what expo export produces', () => {
  assert.equal(contentTypeFor('png'), 'image/png');
  assert.equal(contentTypeFor('.TTF'), 'font/ttf');
  assert.equal(contentTypeFor('xml'), 'application/xml');
  assert.equal(contentTypeFor('bin'), 'application/octet-stream');
});
