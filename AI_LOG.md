# AI Log

## 01 — Tools used

- **OpenCode with Muse Spark** (agentic coding assistant): exploration of the
  unfamiliar repo, guided implementation, debugging (Windows PowerShell
  incompatibility, index migration), and drafting of this documentation.
- No other AI assistants were used for this submission.

## 02 — How you used them

- **Exploration**: mapped the monorepo layout, auth/authorization flow
  (`ProjectAccessService`), task creation numbering, and frontend server-state
  patterns before writing code.
- **Planning**: broke the brief into ordered steps (activity endpoint → status
  auth fix → concurrency fix → tests → frontend → docs).
- **Test generation**: drafted the 9 required e2e cases from the brief's list;
  reviewed and kept them as written after they passed.
- **Debugging**: diagnosed the `pnpm dev` failure on Windows
  (`${WEB_PORT:-3742}` is bash syntax) and the stale non-unique MongoDB index.
- **Review**: discussed the concurrency fix options (atomic counter vs unique
  index + retry) and the optimistic-update strategy for the assignee selector.

## 03 — Suggestions you rejected

- **Atomic per-project counter document for task numbering.** The assistant
  listed it as an option; I rejected it because it needs a schema migration
  plus backfill for existing projects (a counter starting at 0 would collide
  with already-numbered tasks), while a unique index on
  `{ projectId, number }` plus compute-max-and-retry gives the same guarantee
  with no migration and also fixes number reuse after task deletion.
- **Cursor-based pagination for the activity endpoint from day one.** Rejected
  as overengineering for the current scale: offset pagination with a
  `(taskId, createdAt)` index serves the timeline fine, and the migration path
  is documented in the scaling section instead.

## 04 — Generated code you modified

- **Activity service (`findActivity` / `toActivityEntries`)**: the draft
  resolved users with one query per record; I changed it to a single
  `findManyByIds` batch plus an id→user map (no N+1), and added the compound
  index to serve the sorted query.
- **Assignee mutation hook**: the draft applied server truth only on success,
  which left the UI feeling laggy; I changed it to a true optimistic update
  (patch the cached task from the selected member) with rollback to the
  previous snapshot on error.
- **Activity sentences**: the draft rendered raw `from`/`to` ids; I rewrote
  them into plain-history sentences with the themselves/each-other cases from
  the brief's examples.
