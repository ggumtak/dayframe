create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

create function public.create_user_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.create_user_profile() from public, anon, authenticated;
create trigger dayframe_new_user after insert on auth.users
for each row execute function public.create_user_profile();
insert into public.users (id) select id from auth.users on conflict do nothing;

create table public.projects (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create unique index projects_owner_name on public.projects (user_id, lower(name));

-- Membership records are reserved for a future sharing policy migration.
create table public.project_members (
  project_owner_id uuid not null,
  project_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  foreign key (project_owner_id, project_id) references public.projects(user_id, id) on delete cascade,
  primary key (project_owner_id, project_id, user_id)
);

create table public.sections (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (user_id, project_id) references public.projects(user_id, id) on delete cascade,
  primary key (user_id, id),
  unique (user_id, project_id, id)
);
create unique index sections_project_name on public.sections (user_id, project_id, lower(name));

create table public.tags (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create unique index tags_owner_name on public.tags (user_id, lower(name));

create table public.tasks (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  project_id uuid,
  section_id uuid,
  parent_task_id uuid check (parent_task_id <> id),
  title text not null check (char_length(btrim(title)) between 1 and 500),
  notes text check (char_length(notes) <= 10000),
  priority smallint not null default 4 check (priority between 1 and 4),
  position integer not null default 0,
  due_at timestamptz,
  all_day boolean not null default false,
  timezone text not null default 'UTC',
  recurrence_rule text check (
    recurrence_rule is null or recurrence_rule ~
    '^FREQ=(DAILY|WEEKLY)(;INTERVAL=([1-9]|[1-4][0-9]|5[0-2]))?(;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU)){0,6})?$'
    and (recurrence_rule not like 'FREQ=DAILY%;BYDAY=%' or recurrence_rule is null)
  ),
  recurrence_anchor_at timestamptz,
  recurrence_local_time time,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  foreign key (user_id, project_id) references public.projects(user_id, id) on delete cascade,
  foreign key (user_id, project_id, section_id) references public.sections(user_id, project_id, id)
    on delete set null (section_id),
  foreign key (user_id, parent_task_id) references public.tasks(user_id, id) on delete cascade,
  check (section_id is null or project_id is not null),
  check (parent_task_id is null or (project_id is null and section_id is null)),
  check (due_at is not null or (not all_day and recurrence_rule is null)),
  check ((recurrence_rule is null) = (recurrence_anchor_at is null)),
  check ((recurrence_local_time is not null) = (recurrence_rule is not null and not all_day)),
  check (recurrence_local_time < time '24:00')
);
create index tasks_owner_due on public.tasks (user_id, due_at) where completed_at is null;
create index tasks_owner_parent on public.tasks (user_id, parent_task_id);
create index tasks_owner_scope on public.tasks (user_id, project_id, section_id);

create view public.subtasks with (security_invoker = true) as
select * from public.tasks where parent_task_id is not null;

create table public.task_tags (
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  task_id uuid not null,
  tag_id uuid not null,
  primary key (user_id, task_id, tag_id),
  foreign key (user_id, task_id) references public.tasks(user_id, id) on delete cascade,
  foreign key (user_id, tag_id) references public.tags(user_id, id) on delete cascade
);
create index task_tags_tag on public.task_tags (user_id, tag_id);

create table public.task_completions (
  request_id uuid not null,
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  task_id uuid not null,
  due_at timestamptz,
  completed_at timestamptz not null,
  result jsonb not null,
  primary key (user_id, request_id),
  foreign key (user_id, task_id) references public.tasks(user_id, id) on delete cascade
);
create index task_completions_task on public.task_completions (user_id, task_id);

create table public.habits (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  cadence text not null check (cadence in ('daily', 'weekly')),
  target_count integer not null default 1 check (target_count between 1 and 100),
  timezone text not null,
  start_date date not null check (start_date between date '2000-01-01' and date '2100-12-31'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.habit_logs (
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  habit_id uuid not null,
  log_date date not null,
  status text not null check (status in ('completed', 'skipped', 'frozen')),
  count integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, habit_id, log_date),
  foreign key (user_id, habit_id) references public.habits(user_id, id) on delete cascade,
  check ((status = 'completed' and count between 1 and 100)
      or (status in ('skipped', 'frozen') and count = 0))
);

create table public.focus_sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
  task_id uuid,
  habit_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_seconds integer not null default 1500 check (planned_seconds between 60 and 28800),
  status text not null default 'running' check (status in ('running', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, task_id) references public.tasks(user_id, id) on delete set null (task_id),
  foreign key (user_id, habit_id) references public.habits(user_id, id) on delete set null (habit_id),
  check (num_nonnulls(task_id, habit_id) <= 1),
  check ((status = 'running' and ended_at is null)
      or (status <> 'running' and ended_at is not null and ended_at >= started_at))
);
create unique index focus_one_running on public.focus_sessions (user_id) where status = 'running';
create index focus_task on public.focus_sessions (user_id, task_id);
create index focus_habit on public.focus_sessions (user_id, habit_id);

create table public.app_releases (
  version_code integer primary key check (version_code between 1 and 2100000000),
  latest_version text not null check (latest_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  min_supported_version text not null check (min_supported_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  release_notes text not null default '',
  apk_download_url text not null check (
    apk_download_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/[A-Za-z0-9_.%-]+/[A-Za-z0-9_.%-]+\.apk$'
  ),
  ios_store_or_test_flight_url text check (
    ios_store_or_test_flight_url ~ '^https://(apps|testflight)\.apple\.com/'
  ),
  published_at timestamptz,
  check (string_to_array(min_supported_version, '.')::numeric[] <= string_to_array(latest_version, '.')::numeric[])
);

-- Access is explicit because Supabase projects can have different default grants.
do $$
declare table_name text;
begin
  foreach table_name in array array['users', 'projects', 'project_members', 'sections', 'tags',
      'tasks', 'task_tags', 'task_completions', 'habits', 'habit_logs', 'focus_sessions', 'app_releases']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
  end loop;

  foreach table_name in array array['projects', 'sections', 'tags', 'tasks', 'task_tags',
      'task_completions', 'habits', 'habit_logs', 'focus_sessions']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format(
      'create policy own_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
  end loop;
end;
$$;

grant select, update (display_name, timezone) on public.users to authenticated;
create policy own_profile on public.users for all to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
revoke all on public.subtasks from public, anon, authenticated;
grant select on public.subtasks to authenticated;

grant select on public.app_releases to anon, authenticated;
grant select, insert, update, delete on public.app_releases to service_role;
create policy published_releases on public.app_releases for select to anon, authenticated
using (published_at <= now());

create function public.validate_timezone() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid timezone' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_timezone() from public, anon, authenticated;
create trigger users_timezone before insert or update of timezone on public.users
for each row execute function public.validate_timezone();
create trigger habits_timezone before insert or update of timezone on public.habits
for each row execute function public.validate_timezone();
create trigger tasks_timezone before insert or update of timezone on public.tasks
for each row when (new.timezone is not null) execute function public.validate_timezone();

create function public.update_task() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- An existing parent and immutable parent links keep the tree acyclic even on bulk inserts.
    if new.parent_task_id is not null and not exists (
      select from public.tasks where id = new.parent_task_id and user_id = new.user_id
    ) then
      raise exception 'Parent task is unavailable' using errcode = '23503';
    end if;
    new.recurrence_anchor_at := case when new.recurrence_rule is not null then new.due_at end;
    new.recurrence_local_time := case when new.recurrence_rule is not null and not new.all_day
      then coalesce(new.recurrence_local_time, (new.due_at at time zone new.timezone)::time) end;
    new.updated_at := clock_timestamp();
    return new;
  end if;
  if new.parent_task_id is distinct from old.parent_task_id then
    raise exception 'Task parent is immutable' using errcode = '23514';
  end if;
  if new.recurrence_rule is distinct from old.recurrence_rule
    or new.timezone is distinct from old.timezone
    or (new.due_at is distinct from old.due_at and new.recurrence_anchor_at is distinct from old.recurrence_anchor_at)
  then
    new.recurrence_anchor_at := case when new.recurrence_rule is not null then new.due_at end;
  else
    new.recurrence_anchor_at := old.recurrence_anchor_at;
  end if;
  if new.recurrence_rule is null or new.all_day then
    new.recurrence_local_time := null;
  elsif new.recurrence_local_time is distinct from old.recurrence_local_time then
    new.recurrence_local_time := coalesce(new.recurrence_local_time, (new.due_at at time zone new.timezone)::time);
  elsif new.recurrence_anchor_at is distinct from old.recurrence_anchor_at or new.timezone is distinct from old.timezone
    or new.recurrence_local_time is null then
    new.recurrence_local_time := (new.due_at at time zone new.timezone)::time;
  end if;
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
revoke all on function public.update_task() from public, anon, authenticated;
create trigger tasks_write before insert or update on public.tasks
for each row execute function public.update_task();

create function public.protect_habit_schedule() returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.cadence, new.target_count, new.timezone, new.start_date)
    is distinct from row(old.cadence, old.target_count, old.timezone, old.start_date)
    or (old.archived_at is not null and new.archived_at is distinct from old.archived_at) then
    raise exception 'Habit schedule or archive date is immutable' using errcode = '23514';
  end if;
  if old.archived_at is null and new.archived_at is not null then
    new.archived_at := statement_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function public.protect_habit_schedule() from public, anon, authenticated;
create trigger habits_schedule before update on public.habits
for each row execute function public.protect_habit_schedule();

create function public.validate_habit_log() returns trigger language plpgsql set search_path = '' as $$
declare h public.habits;
begin
  select * into h from public.habits
  where id = new.habit_id and user_id = new.user_id for share;
  if not found then
    raise exception 'Habit is unavailable' using errcode = '23503';
  end if;
  if new.log_date < h.start_date or new.log_date > least(
    (statement_timestamp() at time zone h.timezone)::date, (h.archived_at at time zone h.timezone)::date
  ) then
    raise exception 'Log date is outside the habit schedule' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_habit_log() from public, anon, authenticated;
create trigger habit_logs_date before insert or update on public.habit_logs
for each row execute function public.validate_habit_log();
