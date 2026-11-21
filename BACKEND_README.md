# Dayframe backend

Dayframe combines task organization, bilingual quick entry, habits, focus sessions, and mobile release checks. Start the mobile integration from **feat/backend-core**.

| Path | Role |
| --- | --- |
| [API_CONTRACT.md](API_CONTRACT.md) | Mobile behavior and integration examples |
| [openapi.yaml](openapi.yaml) | OpenAPI 3.1 wire contract and operation IDs |
| [packages/shared/types.ts](packages/shared/types.ts) | Dependency-free TypeScript types |
| [supabase/migrations](supabase/migrations) | PostgreSQL 17 schema, access control, and transactions |
| [supabase/functions/api](supabase/functions/api) | Supabase Edge Function, recurrence engine, and parser |
| [tests](tests) | Parser, REST handler, and executable PostgreSQL migration tests |

## Run locally

Use Node.js 24+, the Supabase CLI, and Docker.

~~~sh
npm ci
npm run check
npm test

supabase start
supabase db reset
supabase functions serve api
~~~

Run the database reset against a disposable local dev instance. Use the local project URL and publishable (or legacy anon) key printed by the CLI. The function uses Supabase's environment-provided `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Set `DAYFRAME_SUPABASE_PUBLISHABLE_KEY` to use a publishable key instead.

The REST base URL is `http://127.0.0.1:54321/functions/v1/api/v1`. An Android emulator accesses the host with `10.0.2.2` in place of `127.0.0.1`. For a physical device, use a reachable development Supabase project or local host.

Use the Supabase SDK to register or sign in with email and password. Its `access_token` becomes the REST Bearer token. The local email inbox is available from the URL shown by `supabase status`.

~~~sh
curl "$SUPABASE_URL/functions/v1/api/v1/tasks/parse" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"매일 오전 8시 영단어 30개 #공부 p1","timezone":"Asia/Seoul"}'
~~~

PGlite executes the same migrations in PostgreSQL with simulated Supabase request roles and user IDs. The handler tests exercise the HTTP boundary with mocked Supabase responses. The hosted Auth callback, Edge gateway, and APK link require a configured deployment for end-to-end verification.

## Deploy to a Supabase project

~~~sh
supabase link --project-ref "$DAYFRAME_PROJECT_REF"
supabase db push
supabase functions deploy api
~~~

Enable email sign-in and configure email delivery in Supabase. For OAuth, enable the chosen provider in Supabase and register Supabase's callback with the provider. Allow the mobile app's redirect in Supabase and register the corresponding deep link in the Android and iOS app configuration. The local placeholder is `dayframe://auth/callback`. Configure the mobile Supabase client for PKCE and exchange the returned code for a session. Use the same app-specific redirect through the OAuth grant and code exchange.

A single Edge Function exposes the anonymous version route and the authenticated API. Every private route validates the session against Supabase Auth before data access and passes the same access token to PostgREST. PostgreSQL RLS enforces owner restrictions independently. The Edge Function and mobile client use publishable credentials. Write release metadata through the SQL editor or from a trusted CI environment with restricted secret access.

The same function serves the AI assistant endpoint at `/functions/v1/api/mcp/<token>`. It needs the `SUPABASE_SERVICE_ROLE_KEY` that Supabase provides to every Edge Function, and uses it only to resolve a connection token to its owner and open a session for that owner. Data is always read and written with the owner's session.

Projects have a membership relation reserved for future invitations. Owner-scoped primary and foreign keys prevent a user from joining their rows to another owner's projects, tasks, tags, habits or logs. Sharing can add membership-aware policies and invitation flows to the existing project relation. Keep private habits, focus history and account profiles owner-only.

## Publish an APK update

1. Build and sign an APK in the mobile pipeline. Use the installed app's package ID and signing key, and increase Android's version code.
2. Attach the APK to a published GitHub Release and capture its HTTPS asset URL. A separate public release repository supports downloads by friends while keeping the source private.
3. Verify that the direct link is reachable for the intended audience. Then publish the metadata below through the SQL editor or trusted CI, replacing the example with the actual release details.

~~~sql
insert into public.app_releases (
  latest_version, version_code, min_supported_version, release_notes,
  apk_download_url, ios_store_or_test_flight_url, published_at
) values (
  '1.2.0', 12, '1.0.0', 'Release notes for the mobile app.',
  'https://github.com/OWNER/RELEASES_REPO/releases/download/v1.2.0/dayframe.apk',
  null, now()
);
~~~

The service selects the highest published `version_code`. Rows with no publication time or with a future publication time stay out of the response. Roll forward with a higher build number for a replacement. Set the optional Apple Store/TestFlight URL after iOS distribution is configured.

Run `npm run openapi` after changing route validation or the documented operations. `npm run check` verifies the generated contract and runs OpenAPI lint.
