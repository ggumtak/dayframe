-- A repeating task's occurrence can be moved off its slot (for example done early on Monday instead of
-- Wednesday). occurrence_at remembers that slot, so completing the moved occurrence continues after it
-- instead of bringing the same Wednesday back. It is cleared whenever the occurrence advances or the series
-- is re-anchored.
alter table public.tasks
  add column occurrence_at timestamptz,
  add constraint tasks_occurrence_requires_repeat check (occurrence_at is null or recurrence_rule is not null);

create or replace function public.update_task() returns trigger language plpgsql set search_path = '' as $$
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
    new.occurrence_at := null;
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
    -- A new series starts on its own slot, so there is no moved-off slot to remember.
    new.occurrence_at := null;
  else
    new.recurrence_anchor_at := old.recurrence_anchor_at;
  end if;
  if new.recurrence_rule is null then
    new.occurrence_at := null;
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

create or replace function public.complete_task(
  p_task uuid, p_request uuid, p_revision timestamptz, p_next_due timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  task_row public.tasks;
  previous public.task_completions;
  done_at timestamptz := statement_timestamp();
  outcome jsonb;
begin
  if caller is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text || ':' || p_request::text, 0));
  select * into previous from public.task_completions where user_id = caller and request_id = p_request;
  if found then
    if previous.task_id <> p_task then
      raise exception 'Request ID already used' using errcode = '23505';
    end if;
    return previous.result;
  end if;
  select * into task_row from public.tasks where id = p_task and user_id = caller for update;
  if not found then raise exception 'Task is unavailable' using errcode = 'PT404'; end if;
  if task_row.updated_at is distinct from p_revision or task_row.completed_at is not null then
    raise exception 'Task revision changed or the task is already completed' using errcode = 'PT409';
  end if;

  if (task_row.recurrence_rule is null) <> (p_next_due is null)
    or p_next_due <= greatest(task_row.due_at, done_at - interval '30 seconds')
  then
    raise exception 'Invalid next occurrence' using errcode = '23514';
  end if;

  update public.tasks
  set due_at = coalesce(p_next_due, due_at),
      completed_at = case when p_next_due is null then done_at end,
      occurrence_at = null
  where id = p_task and user_id = caller
  returning jsonb_build_object('task', to_jsonb(tasks), 'completed_at', done_at,
    'occurrence_due_at', task_row.due_at) into outcome;
  insert into public.task_completions (user_id, request_id, task_id, due_at, completed_at, result)
  values (caller, p_request, p_task, task_row.due_at, done_at, outcome);
  return outcome;
end;
$$;
