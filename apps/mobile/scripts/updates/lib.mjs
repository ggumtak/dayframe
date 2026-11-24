// Pure helpers for publishing over-the-air updates (see README.md). No I/O, so lib.test.mjs covers them.
import { createHash } from 'node:crypto';

export const BUCKET = 'app-updates';

/** Base64url without padding: the form expo-updates compares an asset's SHA-256 against (UpdatesUtils.toBase64Url). */
export function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

export function hashes(bytes) {
  return {
    sha256: toBase64Url(createHash('sha256').update(bytes).digest()),
    // The asset key. `expo export` names assets by the MD5 of their bytes, and the APK's embedded manifest keys
    // them the same way (packagerHash), so an asset the APK already has is never downloaded again.
    md5: createHash('md5').update(bytes).digest('hex'),
  };
}

const contentTypes = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', json: 'application/json',
  xml: 'application/xml', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', txt: 'text/plain', html: 'text/html',
};

export function contentTypeFor(extension) {
  return contentTypes[String(extension).replace(/^\./, '').toLowerCase()] ?? 'application/octet-stream';
}

/** The update URL's origin, which is also the scope key the client derives when none is configured. */
export function scopeKeyFor(updateUrl) {
  return new URL(updateUrl).origin;
}

/** The manifest URL the app is built with (app.config.ts). */
export function manifestUrlFor(supabaseUrl) {
  return supabaseUrl.trim().replace(/\/+$/, '') + '/functions/v1/api/v1/updates/manifest';
}

export function publicObjectUrl(supabaseUrl, objectPath) {
  return supabaseUrl.trim().replace(/\/+$/, '') + '/storage/v1/object/public/' + BUCKET + '/' + objectPath;
}

/**
 * Turns `expo export` output into the files to upload and the manifest's asset entries. Objects are stored by
 * content (android/<runtime>/<md5><ext>), so publishing again uploads only what changed and a re-run after a
 * failure is harmless.
 *
 * @param {object} input
 * @param {{ fileMetadata: Record<string, { bundle: string, assets: { path: string, ext: string }[] }> }} input.metadata dist/metadata.json
 * @param {'android' | 'ios'} input.platform
 * @param {string} input.runtimeVersion
 * @param {(path: string) => Buffer} input.read reads a file of the export by its metadata path
 * @param {string} input.supabaseUrl
 */
export function planUpdate({ metadata, platform, runtimeVersion, read, supabaseUrl }) {
  const files = metadata?.fileMetadata?.[platform];
  if (!files?.bundle) throw new Error(`metadata.json has no ${platform} bundle: run expo export --platform ${platform}`);
  if (!/^[A-Za-z0-9._+-]{1,100}$/.test(runtimeVersion)) throw new Error('Invalid runtime version: ' + runtimeVersion);
  const entry = (source, extension, contentType) => {
    const bytes = read(source);
    const { sha256, md5 } = hashes(bytes);
    const objectPath = `${platform}/${runtimeVersion}/${md5}${extension}`;
    return { source, objectPath, contentType, size: bytes.length, sha256, md5, url: publicObjectUrl(supabaseUrl, objectPath) };
  };
  const bundle = entry(files.bundle, '.' + (files.bundle.split('.').pop() || 'bundle'), 'application/javascript');
  const seen = new Set();
  const assets = [];
  for (const asset of files.assets ?? []) {
    if (!/^[A-Za-z0-9]+$/.test(asset.ext)) throw new Error('Unexpected asset extension: ' + asset.ext);
    const file = entry(asset.path, '.' + asset.ext, contentTypeFor(asset.ext));
    if (seen.has(file.md5 + file.objectPath)) continue;
    seen.add(file.md5 + file.objectPath);
    assets.push({ ...file, extension: '.' + asset.ext });
  }
  return {
    uploads: [bundle, ...assets],
    launchAsset: { hash: bundle.sha256, key: bundle.md5, contentType: 'application/javascript', fileExtension: '.bundle', url: bundle.url },
    assets: assets.map((asset) => ({
      hash: asset.sha256, key: asset.md5, contentType: asset.contentType, fileExtension: asset.extension, url: asset.url,
    })),
  };
}

/**
 * The Expo Updates manifest (protocol 1). `extra.expoClient` is the public app config, which the app reads back
 * as `Constants.expoConfig` while it runs this update. The returned string is what gets signed, stored and served.
 */
export function buildManifest({ id, createdAt, runtimeVersion, plan, updateUrl, expoClient, message, commit }) {
  return JSON.stringify({
    id, createdAt, runtimeVersion,
    launchAsset: plan.launchAsset,
    assets: plan.assets,
    metadata: {},
    extra: { scopeKey: scopeKeyFor(updateUrl), expoClient, message: message ?? '', ...(commit ? { commit } : {}) },
  });
}

/** True when two manifests would put the same code and assets on the phone. */
export function sameContent(a, b) {
  const digest = (manifest) => [manifest?.launchAsset?.hash, ...(manifest?.assets ?? []).map((asset) => asset.hash).sort()].join(',');
  return digest(a) === digest(b);
}

/** The `expo-signature` structured-field dictionary for an RSA-SHA256 signature (expo-updates SignatureHeaderInfo). */
export function signatureHeader(signatureBase64, keyid) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64)) throw new Error('Signature must be base64');
  if (!/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(keyid)) throw new Error('Unusable key id: ' + keyid);
  return `sig="${signatureBase64}", keyid="${keyid}", alg="rsa-v1_5-sha256"`;
}

/**
 * Which inputs differ between two `npx expo-updates fingerprint:generate` results, for telling a reviewer why a
 * change needs a new APK. Sources are matched by id (contents) or file path.
 */
export function fingerprintChanges(before, after) {
  const index = (fingerprint) => new Map((fingerprint?.sources ?? []).map((source) =>
    [source.type + ':' + (source.id ?? source.filePath ?? source.name ?? '?'), source.hash ?? null]));
  const [left, right] = [index(before), index(after)];
  const changes = [];
  for (const [key, hash] of right) {
    if (!left.has(key)) changes.push({ change: 'added', source: key });
    else if (left.get(key) !== hash) changes.push({ change: 'changed', source: key });
  }
  for (const key of left.keys()) if (!right.has(key)) changes.push({ change: 'removed', source: key });
  return changes.sort((a, b) => a.source.localeCompare(b.source));
}
