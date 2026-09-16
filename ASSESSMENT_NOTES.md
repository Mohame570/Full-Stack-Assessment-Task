# Assessment Notes — ProjectFlow

## Architecture

**Structure.** TypeScript monorepo (`pnpm` workspaces + Turborepo) with three
units: `apps/api` (NestJS 11 + Mongoose 8 + MongoDB), `apps/web` (Next.js 16
App Router + React 19 + Tailwind 4), and `packages/shared` (enums, constants,
API response types consumed by both sides).

**Major API modules.** `auth` (register/login/me) → `users` →
`organizations` + `organization-members` → `projects` + `project-members` (+
`ProjectAccessService`) → `tasks` → `comments`. Each module follows
controller → service → Mongoose model, with DTOs validating input at the
boundary. Controllers stay thin; business rules live in services.

**Where business logic lives.** In services. The key example is
`ProjectAccessService`: a single place answering "may this user touch this
project?" (`assertCanView` gates reads, `assertCanManage` gates configuration).
Membership comes from either an elevated organization role (`OWNER`/`ADMIN`
sees every project) or an explicit project-membership row. `TasksService`
adds the task-level rules (creator-or-manager edits, assignment permissions,
numbering, activity writes).

**Frontend ↔ backend.** A single typed client (`lib/api-client.ts`) owns the
base URL, bearer header, and error parsing. Server state is owned by TanStack
Query; query keys are centralized in `lib/query-keys.ts` so invalidation is
predictable (`task`, `projectTasks`, `projectMembers`, `taskActivity`, …).
Routes are thin; feature work lives in `features/<domain>/{api,hooks,components}`.
Components are server by default, `"use client"` only where hooks demand it.

**AuthN / AuthZ.** JWT bearer tokens (`JwtAuthGuard` global, `@Public()`
opt-out), bcrypt-hashed passwords. Authentication is global; authorization is
per-service via `ProjectAccessService` plus small role checks (`canManage`,
`canView`, creator checks).

**Entities.** `User` ─ `OrganizationMember` ─ `Organization` ─ `Project` ─
`ProjectMember` ─ `User`; `Project` ─ `Task` ─ `Comment`; `Task` ─
`TaskActivity` (new, this submission). Membership lives in its own
collections with unique compound indexes. Tasks carry a per-project sequential
`number` and a human key (`ENG-1`).

## Observations (risks / weaknesses)

1. **Authorization is enforced by convention, not construction.** Every service
   method must remember to call `ProjectAccessService`; the compiler does not
   force it. That is exactly how the `updateStatus` bug happened (fixed here —
   see `BUG_REPORT.md`). Now: add regression tests for every mutation (done
   for status). Later: consider a guard/interceptor that resolves the project
   from the route and asserts access before the handler runs, so new endpoints
   are safe by default.
2. **Task numbering was `countDocuments + 1` with no unique index.** Concurrent
   creates could persist duplicate `ENG-N` keys — silent data corruption of
   the human identifier. Fixed now (unique index + max-and-retry — details in
   README). Gaps after failures/deletes are possible and accepted.
3. **Noisy N+1-prone serialization paths.** Detail/summary mapping resolves
   users per task; the pre-existing code batches them, but each new relation
   added to a serializer re-opens the question. The new activity endpoint was
   deliberately written batch-first (`findManyByIds` once) with the
   `(taskId, createdAt)` index. Later: a dataloader-style helper shared by all
   serializers.
4. **Windows-hostile dev script.** `apps/web` used `next dev --port
${WEB_PORT:-3742}` (bash syntax), so `pnpm dev` crashed on PowerShell.
   Fixed to `--port 3742` now; later, use `cross-env` or read `WEB_PORT` in
   `next.config.ts` if port flexibility matters.

## What I built (summary of changes)

- **Assignment** (already on `main` + extended): `PATCH
`/tasks/:taskId/assignee``with the three brief rules; writes a`TASK_ASSIGNEE_CHANGED` activity record covering
  unassigned→assigned→reassigned→unassigned.
- **Activity API**: `GET /tasks/:taskId/activity` — paginated, newest-first,
  access-controlled, single batched user lookup, `(taskId, createdAt)` index.
- **Bug fix**: `PATCH /tasks/:taskId/status` now enforces project membership
  (manage-or-creator, same as task edits). See `BUG_REPORT.md`.
- **Concurrency**: unique index on `{ projectId, number }` + max+1 with
  duplicate-key retry (≤5 attempts). Duplicates impossible; gaps accepted.
- **Frontend**: assignee selector (member list, search when >5, loading/empty/
  error/disabled states, optimistic update with rollback, toast on 403) and an
  activity timeline in plain-history language with relative timestamps.
- **Tests**: `task-assignment.e2e.spec.ts` — the 9 required cases. Full suite
  29/29 green.

## Code Review

Reviewing the submitted `assignTask(taskId, assigneeId, userId)` as a PR —
**request changes**, and it would not pass review as-is:

1. **No authorization whatsoever.** The function never checks who `userId` is:
   any authenticated user can assign anyone to anything. It ignores all three
   brief rules (project membership of the target, manager-vs-member
   permissions, unassignment policy). This is a security finding, not style.
2. **No project scoping.** It validates that the assignee _exists_ but never
   that they are a _member of the task's project_. Must resolve project
   access for the target and reject non-members (400, not 404 — the user
   exists, the operation is invalid).
3. **Cannot unassign.** `assigneeId: string` (required) means there is no path
   for the unassigned→assigned→unassigned transitions the brief demands. The
   signature must accept `null`, and the no-op case (same assignee) should
   short-circuit without writing.
4. **No activity record.** Nothing is written for the change, so the feature
   silently drops the history requirement. Activity creation belongs in the
   same service method so the two can never diverge.
5. **Error handling / data consistency.** `findById` with a malformed id
   throws an unhandled CastError instead of a 400; the returned raw document
   leaks internal shape instead of the shared `TaskDetail` DTO. No
   duplicate-write protection is relevant here, but the write should be
   conditional where cheap.
6. **Minor**: unused `userId` parameter (dead input is a smell that auth was
   forgotten); no DTO validation at the boundary; naming (`user` for the
   assignee) conflates the actor with the target — the brief explicitly warns
   against conflating `assignee` with `createdBy`, and the same care applies
   to actor vs target.

What I would _not_ ask to change: the overall shape (load → validate →
mutate → save → return) fits the codebase's service pattern fine.

## Scaling the Activity System (5k → 500k users)

Activity is append-only, written once per change and read as "newest N for
this task" — that asymmetry drives every choice below. I would change things
in this order, each only when measurements justify it.

**1. Keep the index, drop offset pages (first change, cheap).** The
`(taskId, createdAt)` compound index already makes the hot query an
index-only range scan; keep it, and add `projectId` only if
project-level feeds appear. Offset pagination (`skip/limit`) degrades as
per-task histories grow because the database still walks skipped docs. Move
the endpoint to cursor pagination (`createdAt+_id` cursor, `limit+1`
probe): constant-time pages, no skipped-row cost, stable under concurrent
writes. The UI "load more" maps onto it directly.

**2. Split write and read paths (when writes contend).** Today the assign
request writes task + activity inline. Under 100x load, make the activity
write asynchronous: the request persists the task change, enqueues an
outbox/queue job, and a worker batch-inserts activities. Reads stay
synchronous from the same collection. Accept brief eventual consistency on
the timeline (seconds) in exchange for bounded request latency; the queue
gives retries and a dead-letter path instead of failing user requests on a
secondary write. No Kafka/RabbitMQ on day one — an in-process outbox table
or a managed queue only when volume proves it.

**3. Bound growth: retention and archiving (when storage dominates).** Define
retention with product (e.g. hot per-task history capped, full history
archived to cold object storage per project/quarter). Implementation: TTL or
scheduled move-job on `createdAt`, keeping the hot collection small so the
working set stays in memory; archived pages served from a separate
read path. Announce the policy in the UI ("showing recent activity").

**4. Cache and observe (when reads dominate).** Cache first-page timelines per
task with short TTL, invalidated by the activity writer — the write path
already knows exactly which task changed, so invalidation is precise, not
time-based guessing. Add the three metrics that actually predict trouble:
write-queue depth/lag, p95 of the hot query, and index-hit ratio; alert on
queue lag before users notice stale timelines. Real-time push (websocket/SSE)
only if product asks for live collaboration — polling/invalidation on
mutation covers the brief's UI.

What I would _not_ do: shard, CQRS/event-sourcing, or a separate analytics
store preemptively. A single indexed collection with cursor pages serves
millions of small per-task lists comfortably; each escalation above is gated
on a measured bottleneck, in the order writes → size → reads.

## If I Had Two More Days

1. **Migration-safe index rollout + backfill check.** The unique task-number
   index was applied to a dev database; I would add a startup-safe migration
   (detect duplicates, resolve, then create the constraint) so existing
   deployments cannot fail on conflicting data.
2. **Cursor pagination on the activity endpoint + "load more" UI.** The API
   contract supports paging; cursor-based pages and a timeline "show more"
   would finish the job properly.
3. **Broaden the auth safety net.** Audit every remaining mutation for the
   same missing-guard class as `updateStatus`, and spike a route-level
   project-access guard so future endpoints inherit protection.
4. **Activity for status/priority changes.** The schema (`type` field) already
   anticipates it; wire the two other "important task changes" through the
   same writer and timeline.
5. **E2E smoke for the frontend selector.** The backend rules are covered;
   one Playwright/Cypress pass over assign → timeline → rollback would lock
   the UI behavior.
