#!/usr/bin/env node
// Tells a reviewer whether a change can ship over the air or needs a new APK (ci.yml, "Native fingerprint").
//
//   node scripts/updates/compare-fingerprints.mjs --head <head.json> [--base <base.json>] [--released <runtime.txt>]
//
// The JSON files are `npx expo-updates fingerprint:generate --platform android` output; runtime.txt is the
// latest APK release's android-runtime-version.txt. Prints Markdown for the job summary and one annotation.
import { existsSync, readFileSync } from 'node:fs';

import { fingerprintChanges } from './lib.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const readJson = (file) => {
  try {
    return file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
};
const head = readJson(args.head);
if (!head?.hash) throw new Error('--head must be fingerprint JSON');
const base = readJson(args.base);
const released = args.released && existsSync(args.released) ? readFileSync(args.released, 'utf8').trim() : null;

const lines = ['### Native fingerprint', '', `- This change: \`${head.hash}\``];
let annotation;
if (!base?.hash) {
  lines.push('- Base branch: could not be computed (it may predate expo-updates).');
  annotation = '::notice title=Native fingerprint::Base fingerprint unavailable; compare against the latest APK below.';
} else if (base.hash === head.hash) {
  lines.push('- Base branch: same. **No native change: this can ship as an over-the-air update.**');
  annotation = '::notice title=Native fingerprint::Unchanged: this can ship over the air (Publish over-the-air update).';
} else {
  const changes = fingerprintChanges(base, head);
  lines.push(`- Base branch: \`${base.hash}\`. **Native change: shipping it needs a new APK.** Changed inputs:`, '');
  for (const { change, source } of changes.slice(0, 40)) lines.push(`  - ${change}: \`${source}\``);
  if (changes.length > 40) lines.push(`  - and ${changes.length - 40} more`);
  annotation = `::warning title=Native fingerprint::This change alters the native fingerprint (${changes.length} inputs); it needs a new APK, not an over-the-air update.`;
}
if (released) {
  lines.push('', released === head.hash
    ? '- Latest APK release runs the same runtime: an update published after merging reaches it.'
    : `- Latest APK release runs \`${released}\`: after merging, main needs an APK before any over-the-air update.`);
} else {
  lines.push('', '- Latest APK release has no recorded runtime (released before over-the-air updates).');
}
console.log(lines.join('\n'));
console.error(annotation);
