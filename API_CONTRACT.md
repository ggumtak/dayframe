# Dayframe API contract

Use `/functions/v1/api/v1` on the Supabase URL. [openapi.yaml](openapi.yaml) is the machine-readable contract and [types.ts](packages/shared/types.ts) contains the matching TypeScript types.

Send `Authorization: Bearer <Supabase access_token>` on private requests. Add `apikey: <Supabase publishable key>` when calling through the gateway. `/app/version` can run before login. Send `Content-Type: application/json` for routes with JSON request bodies.

Successful responses contain a resource directly or a page shaped as `{ "items": [], "nextOffset": null }`. Lists use `limit` (1–100, default 50) and `offset` (default 0). Continue with `nextOffset` until it is `null`. Refresh from offset 0 after a mutation because additions and deletes can shift offsets. Deletes and tag links return `204` with an empty body. Repeating a delete is safe.

Errors use `{ "error": { "code": "INVALID_INPUT", "message": "...", "fields": ["..."] } }`. Treat `401` as a session refresh/sign-in condition, `404` as a missing record, and `409` as a conflict or stale data requiring a refresh. The optional `fields` array contains validation details. Map client-visible messaging by `code`, with `message` as a fallback.

## Accounts, organization and tasks

| Route | Methods | Behavior |
| --- | --- | --- |
| `/me` | `GET`, `PATCH` | Profile, display name, and default task time zone |
| `/projects`, `/sections`, `/tags` | `GET`, `POST` | List and create |
| `/projects/{id}`, `/sections/{id}`, `/tags/{id}` | `GET`, `PATCH`, `DELETE` | Read, update, and delete |
| `/tasks`, `/tasks/{id}` | Collection `GET`, `POST`. Item `GET`, `PATCH`, `DELETE` | Create and edit tasks at any depth |
| `/subtasks`, `/subtasks/{id}` | `GET` | Read-only view for tasks with a parent |
| `/tasks/parse` | `POST` | Preview Korean or English quick entry |
| `/tasks/{id}/tags`, `/tasks/{id}/tags/{tagId}` | Collection `GET`. Link `PUT`, `DELETE` | List, attach or remove a tag |
| `/task-tags` | `GET` | Every tag link in the account, optionally filtered with `tag_id` |
| `/tasks/{id}/complete`, `/tasks/{id}/reopen` | `POST` | Complete an occurrence or reopen a completed one-off task |
| `/tasks/reschedule-overdue` | `POST` | Move prior-date open tasks to today in their own time zone |

Sections may be filtered with `project_id`. List `/tasks?parent_task_id=root` for top-level tasks and `/tasks?parent_task_id=<uuid>` for direct children. The full list includes all depths. `project_id` filters direct project assignment. Child tasks inherit their project and section through their parent chain. Create them with `parent_task_id` and omit direct project and section fields. The parent remains fixed for the lifetime of the task. `state=open` or `state=completed` filters task and subtask lists. Priorities run from P1 (highest) to P4 (default). `position` is a signed integer sorted ascending. IDs break ties.

Calendar views can add `due_from` (inclusive) and/or `due_before` (exclusive) to task and subtask lists, using ISO 8601 instants with offsets. The results contain scheduled tasks only and sort by due time, priority, position and ID. Convert local calendar boundaries to instants before sending them.

Deleting a project cascades to its sections, directly assigned tasks and their descendants. Deleting a section clears its task links. Deleting a task cascades to its subtasks, tag links and completion history. Focus sessions retain their timing with the deleted link cleared.

`due_at` is an ISO 8601 instant with an offset. `all_day: true` uses the start of the date in the task's IANA `timezone`. Format all-day values in that zone. Send `due_at: null`, `all_day: false` and `recurrence_rule: null` together when clearing a recurring or all-day schedule. A new task defaults to the time zone from `/me`.

### Quick entry and recurrence

POST `{"text":"Tomorrow 7pm gym every Mon, Wed #health @workout p2","timezone":"Asia/Seoul"}` to `/tasks/parse`. The preview includes `title`, `due_at`, `all_day`, `timezone`, `recurrence_rule`, `recurrence_local_time`, `project`, `tags`, and `priority`.

| Tokens | Parsed behavior |
| --- | --- |
| `오늘`, `내일`, `모레`, `today`, `tomorrow`, `day after tomorrow`, `YYYY-MM-DD` | Calendar dates in the supplied zone |
| `11월 25일`, `3일 뒤`, `2주 후`, `in 3 days` | Month and day (the next time it comes around), or an offset from today |
| `다음주 화요일`, `다음 주 화요일`, `next week Tue`, `next Tue` | Weekday in the next Monday-starting week |
| `이번주 금요일`, `this Fri` | Weekday in the current Monday-starting week |
| `오전 8시`, `오후 6시 30분`, `7시 반`, `7pm`, `18:30`, `at 7:15 pm` | Local wall-clock time |
| `7시`, `7:30` (no 오전/오후 or am/pm) | The likelier half of the day: 1–5시 and 12시 are afternoon; 6–11시 is the next one still ahead today, or the morning on another day or for a repeating task. Words such as 저녁, 밤, 아침, 기상 in the title decide it. `07:30` and `19시` are taken as written |
| `아침`, `새벽`, `낮`, `저녁`, `밤` before an hour, `정오`, `자정`, `noon`, `midnight` | Day period. `밤 12시` is the midnight that ends the given date |
| `매일`, `매주`, `매주 월수금`, `월요일마다`, `every Mon, Wed`, `every 2 weeks`, `3일마다`, `daily`, `weekly` | Daily or weekly RRULE with optional weekday or interval |
| `평일마다`, `매주 주말`, `격주`, `every weekday`, `every weekend`, `every other week` | Monday–Friday, Saturday–Sunday, or a two-week interval |
| `매월 25일`, `매달 말일`, `2개월마다`, `monthly on the 25th`, `every month on the last day` | A monthly date, the last day of each month, or a monthly interval |
| `매년 5월 10일`, `2년마다`, `yearly`, `every 2 years` | A yearly date or interval |
| `#공부`, `#"Home Projects"`, `@workout`, `@"Read Later"`, `p1`–`p4` | Project name, tags, and priority |

A date or time may carry `까지`, and a time may carry `쯤` or `에`. These particles are dropped from the title. For midnight at the start of a selected day in a monthly repeat, use `자정` or `00:00`.

An optional `now` is available for deterministic previews and tests. A time by itself uses the next future occurrence. With a weekly weekday list, the first due date is the first listed weekday on or after any explicit date. For timed recurrences, persist `recurrence_local_time` with `due_at` to retain the requested local time across daylight-saving changes. A skipped wall time moves forward by the transition gap. An ambiguous wall time uses the earlier offset. Daily, weekly, monthly and yearly RRULEs accept intervals from 1 to 52. Weekly lists use `MO,TU,WE,TH,FR,SA,SU`. Monthly and yearly repeats use the starting day or date and skip periods where that date is absent. For month-end repeats, use `FREQ=MONTHLY;BYMONTHDAY=-1`. Set the first due date to the last day of its month. Unrecognized wording remains in the title.

To save, resolve the named project and tags against `/projects` and `/tags`, creating missing ones if the user chooses. POST task fields to `/tasks` with `project_id`, then attach each tag through the link route. An optional client-generated `id` lets an offline queue reconcile a conflicting creation by fetching that ID.

For completion, generate a `request_id` UUID and send it with the unchanged task `updated_at` as `expected_updated_at`. Keep the exact timestamp string, including fractional seconds. Network retries should reuse the same pair. The response includes `task`, completion timestamp, and the original `occurrence_due_at`. A repeating task keeps its ID and advances to the next scheduled time after both the previous due time and completion. Missed occurrences are skipped. A stale revision returns `409`. To reopen a one-off task, call `/reopen` without a body. The earlier completion stays in history.

Rescheduling returns `{ "count": number }`. A past-date task moves to the current calendar date in its own zone and retains its wall time and recurrence anchor. Tasks already dated today stay where they are. Refresh the task list after receiving the count.

To postpone one task occurrence while keeping the original repeat schedule, PATCH `/tasks/{id}` with the new `due_at`, the current `expected_due_at`, and `"preserve_recurrence": true`. A move of a different occurrence returns `409`. Retrying a move already applied to the current occurrence returns the current task. An ordinary schedule edit can change the recurrence anchor.

## Habits

| Route | Methods | Behavior |
| --- | --- | --- |
| `/habits` | `GET`, `POST` | List or create schedules |
| `/habits/{id}` | `GET`, `PATCH`, `DELETE` | Read, rename, archive with `{"archive":true}`, or delete |
| `/habits/{id}/logs` | `GET` | List daily entries, newest first |
| `/habits/{id}/logs/{date}` | `PUT`, `DELETE` | Replace or remove the entry for a habit-local `YYYY-MM-DD` |
| `/habits/{id}/stats` | `GET` | Get streaks, period progress, and completion rate |

`cadence` is `daily` or `weekly`. `target_count` is the number of completions per day or ISO Monday-starting week. `timezone` is required and `start_date` defaults to today in that zone. Archive a habit to keep its history. Cadence, goal, zone and start date stay fixed so historical stats remain meaningful.

A completed log uses a positive `count` (default 1). A skipped or frozen log uses zero. PUT sets the day's total, so the app should send the intended full count. Log dates run from the habit's start date through today or its local archive date, whichever comes first.

Stats use periods through the optional inclusive `through=YYYY-MM-DD`, capped at the archive date. The current incomplete period stays outside the denominator until it closes. A period counts immediately once it meets the goal. A frozen entry protects an otherwise unmet period from breaking the streak and excludes it from the rate. A skip without progress excludes a closed period from the rate but breaks the streak. A skip alongside partial progress leaves that period evaluated. Only completed periods increase the streak. These rules apply to days for daily habits and to weeks for weekly habits. A rate with zero evaluated periods is `null`. Other rates range from 0 to 1.

## Focus sessions

POST `/focus-sessions` to start a session. Omit `started_at` for server time. The default plan is 1,500 seconds. `task_id` or `habit_id` may link the session to one resource. Each user can have one running session. POST `/focus-sessions/{id}/finish` with `{"status":"completed"}` or `{"status":"cancelled"}`. Pass `ended_at` for an offline finish. Retrying the same terminal status returns the stored session when no conflicting end time is supplied. GET `/focus-sessions` or `/focus-sessions/{id}` for history. DELETE the item to remove it.

## AI assistants

`POST /mcp-connections` with an optional `{"label":"Claude"}` creates a connection and returns it with a `url`. `GET /mcp-connections` lists connections with `label`, `created_at` and `last_used_at`. `DELETE /mcp-connections/{id}` removes one. An account can hold five.

The `url` has the form `/functions/v1/api/mcp/<token>` and is shown only in the creation response; the server keeps a hash. It is a [Model Context Protocol](https://modelcontextprotocol.io) endpoint over Streamable HTTP with JSON replies. Add it to an assistant as a custom connector with no sign-in. The token in the path is the only credential, so anyone holding the URL can read, change and delete the account's tasks and habits until the connection is removed.

| Tool | Behavior |
| --- | --- |
| `list_tasks`, `list_projects`, `list_habits` | Read tasks by view (`today`, `overdue`, `upcoming`, `inbox`, `all`), names of projects and tags, and habits with today's progress and streak |
| `add_task` | Quick-entry text, as in `/tasks/parse`, with optional notes and parent task. Missing projects and tags are created |
| `update_task` | Title, notes, priority, project, and a natural-language `schedule` or `clear_schedule` |
| `complete_task`, `reopen_task`, `move_overdue_to_today` | Same behavior as the REST routes |
| `delete_task`, `remove_habit` | Permanent deletion (or archiving a habit); marked destructive |
| `add_habit`, `log_habit` | Create a habit, or set, skip, freeze or clear one day's entry |

Each tool call runs through the REST routes with a session for the connection's owner, so validation and row-level security are the same as for the app.

## App updates

`GET /app/version` returns `latestVersion`, `versionCode`, `minSupportedVersion`, `releaseNotes`, `apkDownloadUrl`, and `iosStoreOrTestFlightUrl`. A `404` before the first publication means no release metadata is available. Cache successful checks for up to 60 seconds. Compare the Android integer `versionCode` for APK upgrades and compare semantic version components numerically for the minimum supported version.

The app owns download progress, Android install permissions, signer verification and installation UX. iOS should open the Apple URL once one is present. The publication workflow is in [BACKEND_README.md](BACKEND_README.md).
