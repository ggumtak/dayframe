-- A connection lets an AI assistant act for its owner through /functions/v1/api/mcp/<token>.
-- Only the SHA-256 of the token is stored, and no signed-in user can read it back.
create table public.mcp_connections (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  label text not null default 'AI' check (char_length(btrim(label)) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  primary key (user_id, id)
);

alter table public.mcp_connections enable row level security;
revoke all on public.mcp_connections from public, anon, authenticated;
grant select (id, user_id, label, created_at, last_used_at), insert (id, user_id, label, token_hash), delete
  on public.mcp_connections to authenticated;
create policy own_rows on public.mcp_connections for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- The API function resolves a presented token with the service role.
grant select, update (last_used_at) on public.mcp_connections to service_role;
