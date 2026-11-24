# Over-the-air updates

JavaScript and asset changes reach installed apps as a few-MB download instead of a new APK. Updates are served
by the project's own Supabase: the `api` Edge Function answers the expo-updates client at
`/functions/v1/api/v1/updates/manifest`, and the files sit in the public Storage bucket `app-updates`.

## How it fits together

- **Runtime version = native fingerprint.** `app.config.ts` sets `runtimeVersion: { policy: 'fingerprint' }`.
  The Gradle build writes the fingerprint into the APK (`assets/fingerprint`), and the app sends it with every
  check. Anything that needs a new APK (a native module, a config plugin, an icon, the app config, the code
  signing certificate) changes it. The server only offers an update built for the same fingerprint, so an
  update can never reach native code it was not built for. `fingerprint.config.js` lists the fingerprint inputs.
- **On the phone.** expo-updates checks on every cold start (`checkAutomatically: 'ON_LOAD'`), downloads in the
  background without delaying start-up (`fallbackToCacheTimeout: 0`), and applies the update on the next cold
  start. Settings > 업데이트 확인 checks over the air first and offers "다시 시작해 적용"; only when there is no
  update for this build does it look for a newer APK (GitHub Releases), as before. Settings shows
  "1.9.0 · 11월 24일 업데이트" while an over-the-air update is running.
- **Publishing.** Actions > *Publish over-the-air update* on `main` (`.github/workflows/publish-ota.yml`):
  1. reads the runtime of the latest APK release (`android-runtime-version.txt`, attached by the release
     workflow from the APK's own `assets/fingerprint`);
  2. computes main's fingerprint and stops with "native change: release an APK" when they differ;
  3. `npx expo export --platform android`;
  4. `publish.mjs` uploads the bundle and assets to `app-updates/android/<runtime>/<md5><ext>`, downloads each
     one back from its public URL and checks its SHA-256, and only then inserts the `app_updates` row. Files are
     stored by content, so a re-run uploads nothing twice, and the run stops without publishing when the newest
     update already has exactly this code (`force` overrides).
- **Pull requests.** CI's *Native fingerprint* job compares the PR's fingerprint with its base and reports
  "can ship over the air" or "needs a new APK" with the changed inputs. Locally:
  `npx expo-updates fingerprint:generate --platform android | jq -r .hash` on both commits.

Every APK build also checks that the fingerprint in the APK equals the one computed before prebuild (the way
the publish workflow computes it), so a mismatch fails the build instead of silently stranding updates.

## Size

The download is the Hermes bundle (about 7 MB, about 3 MB if Storage serves it compressed) plus only the assets
whose content changed: assets are keyed by the MD5 of their bytes, the same key the APK's embedded copies have,
so expo-updates never downloads an asset it already holds.

## One-time setup

1. Apply `supabase/migrations/20261124000000_app_updates.sql` (table `app_updates`, readable and writable only
   by the service role; it also creates the public bucket `app-updates` when the storage schema exists, and the
   publish workflow creates it otherwise).
2. Deploy the `api` function with the updates route.
3. The publish workflow reuses the release workflow's `SUPABASE_SERVICE_ROLE_KEY` secret (and checks the
   optional `SUPABASE_URL` variable against `release.config.json`).
4. Release an APK that contains expo-updates (Actions > Build Android APK). Earlier APKs cannot take updates,
   and the publish workflow refuses until the latest release has `android-runtime-version.txt`.

## Code signing (optional)

Without it, the app accepts any update served over HTTPS by the project's Supabase, and only the service role
can write the table and the bucket. With it, the app also rejects any manifest not signed with the owner's key,
so a leaked service-role key alone could not push code to the phone.

1. On your own computer: `node scripts/updates/generate-signing-key.mjs`. It writes `certs/certificate.pem` and
   the private key to `~/.dayframe/updates-signing-key.pem` (outside the repository, never printed).
2. `gh secret set UPDATES_SIGNING_PRIVATE_KEY < ~/.dayframe/updates-signing-key.pem`, and back the key file up
   offline. Losing it means a new certificate and a new APK.
3. Commit `certs/certificate.pem` (`.gitignore` allows exactly this `.pem`) and release an APK. The certificate
   changes the fingerprint, so only APKs built with it check signatures, and they accept signed updates only.
   From then on `publish.mjs` refuses to publish without the secret or with a key that does not match the
   certificate. The key id is derived from the certificate, so replacing it also needs a new APK.

## Checking without a phone

```sh
npx expo export --platform android --output-dir /tmp/ota
node scripts/updates/publish.mjs --dist /tmp/ota --runtime "$(npx expo-updates fingerprint:generate --platform android | jq -r .hash)" --dry-run --manifest-out /tmp/manifest.json
node scripts/updates/local-e2e.mjs --dist /tmp/ota          # add --key <pem> with a certificate in certs/
node --test "scripts/updates/*.test.mjs"
```

`local-e2e.mjs` serves the export as fake Storage and the real API function handler over local HTTP, requests
the manifest with the client's headers, parses the multipart answer with `multitars`, and checks every rule
the Android client enforces (cited in the script), every asset hash, and the signature.
