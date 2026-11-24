#!/usr/bin/env node
// One-time, on the owner's own computer: creates the code signing key pair for over-the-air updates.
//
//   node scripts/updates/generate-signing-key.mjs [--key-out <file outside the repository>] [--years 10]
//
// Writes the certificate to certs/certificate.pem (commit it) and the private key to --key-out, by default
// ~/.dayframe/updates-signing-key.pem with owner-only permissions. The private key is never printed, and the
// script refuses to write it inside the repository. Store it as the UPDATES_SIGNING_PRIVATE_KEY Actions secret
// and keep an offline backup: see README.md, "Code signing".
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(appRoot, '../..');
const require = createRequire(join(appRoot, 'package.json'));
const {
  convertCertificateToCertificatePEM, convertKeyPairToPEM, generateKeyPair, generateSelfSignedCodeSigningCertificate,
} = require('@expo/code-signing-certificates');

const args = { keyOut: join(homedir(), '.dayframe', 'updates-signing-key.pem'), years: 10 };
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--key-out') args.keyOut = resolve(process.argv[++i]);
  else if (process.argv[i] === '--years') args.years = Number(process.argv[++i]);
  else {
    console.error('Usage: generate-signing-key.mjs [--key-out <file>] [--years <n>]');
    process.exit(2);
  }
}

const certificateFile = join(appRoot, 'certs/certificate.pem');
const inside = (file, root) => !relative(root, file).startsWith('..');
const keyDir = dirname(args.keyOut);
const refuseInsideRepository = (dir, root) => {
  if (!inside(dir, root)) return;
  console.error('Refusing to write the private key inside the repository. Pass --key-out with a path outside it.');
  process.exit(1);
};
refuseInsideRepository(keyDir, repoRoot);
mkdirSync(keyDir, { recursive: true, mode: 0o700 });
// Again with symbolic links resolved.
refuseInsideRepository(realpathSync(keyDir), realpathSync(repoRoot));
for (const file of [certificateFile, args.keyOut]) {
  if (existsSync(file)) {
    console.error(`${file} already exists. Replacing the key means a new APK for every device: move it away first if you mean to.`);
    process.exit(1);
  }
}
if (!Number.isInteger(args.years) || args.years < 1 || args.years > 30) {
  console.error('--years must be a whole number from 1 to 30');
  process.exit(1);
}

const keyPair = generateKeyPair();
const validityNotBefore = new Date();
const validityNotAfter = new Date(validityNotBefore);
validityNotAfter.setFullYear(validityNotAfter.getFullYear() + args.years);
const certificate = generateSelfSignedCodeSigningCertificate({
  keyPair, validityNotBefore, validityNotAfter, commonName: 'Dayframe over-the-air updates',
});
mkdirSync(dirname(certificateFile), { recursive: true });
writeFileSync(args.keyOut, convertKeyPairToPEM(keyPair).privateKeyPEM, { mode: 0o600, flag: 'wx' });
writeFileSync(certificateFile, convertCertificateToCertificatePEM(certificate), { flag: 'wx' });

console.log(`Certificate: ${relative(repoRoot, certificateFile)} (valid until ${validityNotAfter.toISOString().slice(0, 10)}). Commit it.`);
console.log(`Private key: ${args.keyOut} (not printed). Next:`);
console.log(`  gh secret set UPDATES_SIGNING_PRIVATE_KEY < "${args.keyOut}"`);
console.log('  then back the key file up offline, commit the certificate and release an APK: only APKs built with the');
console.log('  certificate check signatures, and from then on every update must be signed.');
