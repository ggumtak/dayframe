alter table public.tasks
  drop constraint tasks_recurrence_rule_check,
  add constraint tasks_recurrence_rule_check check (
    recurrence_rule ~
      '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=([1-9]|[1-4][0-9]|5[0-2]))?(;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU)){0,6}|;BYMONTHDAY=-1)?$'
    and (recurrence_rule not like '%;BYDAY=%' or recurrence_rule like 'FREQ=WEEKLY;%')
    and (recurrence_rule not like '%;BYMONTHDAY=%' or recurrence_rule like 'FREQ=MONTHLY;%')
  );
