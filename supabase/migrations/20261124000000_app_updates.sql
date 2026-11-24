-- Over-the-air JavaScript updates (apps/mobile/scripts/updates/README.md).
-- The publish workflow writes one row per update with the service role; GET /api/v1/updates/manifest reads the
-- newest row for the caller's platform and runtime, also with the service role. Signed-in users and anonymous
-- callers have no access: the endpoint is the only reader.
create table public.app_updates (
  id uuid primary key,
  platform text not null check (platform in ('android', 'ios')),
  -- The native fingerprint of the APK this update runs on (expo-updates `runtimeVersion`).
  runtime_version text not null check (runtime_version ~ '^[A-Za-z0-9._+-]{1,100}$'),
  created_at timestamptz not null default now(),
  -- The Expo Updates manifest exactly as served. Text rather than jsonb so the bytes stay identical to what
  -- the publish workflow signed.
  manifest text not null check (pg_catalog.length(manifest) <= 262144),
  -- The manifest part's `expo-signature` header (a structured-field dictionary), or null when unsigned.
  signature text check (signature !~ '[^ -~]' and char_length(signature) between 1 and 4096),
  message text not null default '' check (char_length(message) <= 500),
  git_commit text check (git_commit ~ '^[0-9a-f]{40}$'),
  check (((manifest::jsonb) ->> 'id')::uuid = id),
  check ((manifest::jsonb) ->> 'runtimeVersion' = runtime_version)
);
create index app_updates_latest on public.app_updates (platform, runtime_version, created_at desc);

alter table public.app_updates enable row level security;
revoke all on public.app_updates from public, anon, authenticated;
grant select, insert, delete on public.app_updates to service_role;

-- Public-read bucket for the bundles and assets the manifests point at (no policies: only the service role,
-- which bypasses RLS, can write). Created here when the storage schema exists; the publish workflow also
-- creates it idempotently through the Storage API.
do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public) values ('app-updates', 'app-updates', true)
      on conflict (id) do update set public = true
    $sql$;
  end if;
end;
$$;
