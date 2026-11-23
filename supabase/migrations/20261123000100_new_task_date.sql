-- Where a task lands when it is written without a date: on today (the default, so it shows in 오늘 like
-- adding from Todoist's Today view), or undated in the list. The app's quick entry and the AI connection's
-- add_task both follow it; a subtask always follows its parent instead.
alter table public.users
  add column new_task_date text not null default 'today' check (new_task_date in ('today', 'none'));
grant update (new_task_date) on public.users to authenticated;
