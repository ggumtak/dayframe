create function public.reschedule_overdue() returns jsonb
language sql security invoker set search_path = '' as $$
  with updated as (
  update public.tasks t
  set due_at = (
    (statement_timestamp() at time zone t.timezone)::date +
    case when t.all_day then time '00:00'
      else coalesce(t.recurrence_local_time, (t.due_at at time zone t.timezone)::time) end
  ) at time zone t.timezone
  where user_id = (select auth.uid()) and completed_at is null
    and due_at < date_trunc('day', statement_timestamp(), t.timezone)
  returning 1
  )
  select jsonb_build_object('count', count(*)) from updated;
$$;

revoke insert, update, delete on public.task_completions from authenticated;
create function public.complete_task(
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
      completed_at = case when p_next_due is null then done_at end
  where id = p_task and user_id = caller
  returning jsonb_build_object('task', to_jsonb(tasks), 'completed_at', done_at,
    'occurrence_due_at', task_row.due_at) into outcome;
  insert into public.task_completions (user_id, request_id, task_id, due_at, completed_at, result)
  values (caller, p_request, p_task, task_row.due_at, done_at, outcome);
  return outcome;
end;
$$;

create function public.habit_stats(p_habit uuid, p_through date default null)
returns table (
  as_of date, current_streak integer, longest_streak integer, completed_periods integer,
  evaluated_periods integer, completion_rate numeric, current_period_count integer
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  h public.habits;
  local_today date;
  final_day date;
  final_period date;
  first_period date;
  interval_days integer;
  is_open boolean;
begin
  select * into h from public.habits where id = p_habit and user_id = (select auth.uid());
  if not found then raise exception 'Habit is unavailable' using errcode = 'PT404'; end if;
  local_today := (statement_timestamp() at time zone h.timezone)::date;
  if p_through > local_today then
    raise exception 'Stats date cannot be in the future' using errcode = '23514';
  end if;
  final_day := least(coalesce(p_through, local_today), (h.archived_at at time zone h.timezone)::date);
  interval_days := case when h.cadence = 'daily' then 1 else 7 end;
  first_period := date_trunc(case when interval_days = 1 then 'day' else 'week' end, h.start_date::timestamp)::date;
  final_period := date_trunc(case when interval_days = 1 then 'day' else 'week' end, final_day::timestamp)::date;
  is_open := final_period + interval_days - 1 >= final_day
    and (final_day = local_today or final_day < final_period + interval_days - 1)
    and (h.archived_at is null or final_day < (h.archived_at at time zone h.timezone)::date);

  return query
  with log_totals as (
    select date_trunc(case when interval_days = 1 then 'day' else 'week' end, l.log_date::timestamp)::date as bucket,
      sum(l.count)::integer as progress, bool_or(l.status = 'frozen') as frozen,
      bool_or(l.status = 'skipped') as skipped
    from public.habit_logs l
    where l.habit_id = h.id and l.user_id = h.user_id and l.log_date between h.start_date and final_day
    group by 1
  ), periods as (
    select first_period + days.offset_days as bucket, coalesce(l.progress, 0) as progress,
      coalesce(l.frozen, false) as frozen, coalesce(l.skipped, false) as skipped
    from generate_series(0, final_period - first_period, interval_days) as days(offset_days)
    left join log_totals l on l.bucket = first_period + days.offset_days
    where final_day >= h.start_date
  ), classified as (
    select p.*, p.progress >= h.target_count as met,
      not (is_open and p.bucket = final_period) as closed
    from periods p
  ), streak_groups as (
    select c.*, count(*) filter (where c.closed and not c.met and not c.frozen)
      over (order by c.bucket) as streak_group
    from classified c
  ), streak_lengths as (
    select g.streak_group, count(*) filter (where g.met)::integer as length
    from streak_groups g group by g.streak_group
  ), metrics as (
    select count(*) filter (where c.met)::integer as completed,
      count(*) filter (where c.met or (c.closed and not c.frozen and not (c.skipped and c.progress = 0)))::integer as evaluated,
      coalesce(max(c.progress) filter (where c.bucket = final_period), 0) as period_progress
    from classified c
  )
  select final_day, coalesce((select s.length from streak_lengths s order by s.streak_group desc limit 1), 0),
    coalesce((select max(s.length) from streak_lengths s), 0),
    m.completed, m.evaluated, case when m.evaluated > 0 then round(m.completed::numeric / m.evaluated, 4) end,
    m.period_progress from metrics m;
end;
$$;

revoke all on function public.reschedule_overdue() from public, anon, authenticated;
revoke all on function public.complete_task(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.habit_stats(uuid, date) from public, anon, authenticated;
grant execute on function public.reschedule_overdue() to authenticated;
grant execute on function public.complete_task(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.habit_stats(uuid, date) to authenticated;
