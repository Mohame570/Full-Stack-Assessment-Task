# Bug Report — Unauthorized Task Modification

Reported by support: "Some users appear to be able to modify tasks belonging to
projects they are not members of."

## Verdict

The issue **exists**. Any authenticated user could change the **status** of any
task in any project, including projects they are not members of.

## Root Cause

`PATCH /tasks/:taskId/status` performed no authorization at all:

- `apps/api/src/tasks/tasks.controller.ts` — `updateStatus` did not extract the
  current user (`@CurrentUser('id')` was missing), so there was no identity to
  authorize against.
- `apps/api/src/tasks/tasks.service.ts` — `TasksService.updateStatus` loaded the
  task with `findTaskOrFail` and saved the new status without calling
  `ProjectAccessService` (no `assertCanView`, no `canManage`/creator check).

Every other task mutation (`update`, `assignTask`, `remove`, `findOne`) goes
through `ProjectAccessService`; `updateStatus` was the single route that
skipped it — likely an oversight when the status endpoint was split out of the
generic update.

## Impact

Any logged-in user (for example the seeded `outside@example.com`, who belongs
to no organization) could move any task to any status (`TODO`, `IN_PROGRESS`,
`DONE`). Status drives the project board, so this silently corrupts project
state across organization boundaries. Title/description/priority were protected
by `update`; only `status` was exposed.

## Reproduction

Automated (added in `apps/api/test/task-assignment.e2e.spec.ts`):

```ts
await request(app.getHttpServer())
  .patch(`/tasks/${taskId}/status`)
  .set('Authorization', authHeader(outsider))
  .send({ status: TaskStatus.IN_PROGRESS })
  .expect(403);
```

Before the fix this returned `200` and changed the task. After the fix it
returns `403`. Manual equivalent: log in as `outside@example.com`, take any
task id from another project, `PATCH /tasks/:taskId/status`.

## Fix

- Controller now extracts `@CurrentUser('id')` and passes it to the service.
- Service now calls `projectAccessService.assertCanView(task.projectId, userId)`
  and applies the same rule as the generic `update`: the caller must be a
  project manager (`OWNER` / `ADMIN` / `PROJECT_MANAGER` via `canManage`) or
  the task creator, otherwise `403 Forbidden`.

Files changed:

- `apps/api/src/tasks/tasks.controller.ts` — `updateStatus` accepts the current
  user id.
- `apps/api/src/tasks/tasks.service.ts` — `updateStatus` enforces project
  membership and the manage-or-creator rule, and reuses the loaded project for
  the response instead of refetching it.

Assumption documented: the brief does not spell out who may change status, so
changing status follows the same permission as editing the task. Stricter or
looser variants would be a one-line change in the same place.

## Regression Prevention

- `task-assignment.e2e.spec.ts` → "refuses status changes from outside the
  project" fails (200 instead of 403) if the guard is ever removed.
- The existing suite (`tasks`, `projects`, `comments`, `auth`) keeps passing:
  29/29 green, so the fix did not narrow any legitimate path.
