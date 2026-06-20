<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Codex's Role - TaskFish

You are one of two AI agents collaborating on TaskFish, a Windows process manager built with Next.js + Electron.

## Project Dashboard Session Protocol

This project uses the local Project Dashboard at `/dashboard` and keeps a private session handoff in `dashboard.md`.
Editable session procedures are stored outside the repo under:

`%USERPROFILE%\.codex\project-dashboard\procedures\tasker-poc\`

The dashboard writes:

- `startup.md` for `/session start`
- `close.md` for `/session close`
- `procedures.json` for dashboard graph positions and arrows

The files `dashboard.md`, `dashboards/`, and `notes.md` are local-only and gitignored.

When the user types `/session start`:

1. Run `npm run dashboard:session-start`.
2. Read `%USERPROFILE%\.codex\project-dashboard\procedures\tasker-poc\startup.md` if it exists.
3. Read the generated `dashboard.md` summary before planning work.
4. Check the dashboard warnings for CodeGraph, Graphify, Paper Sleuth tickets, dirty git files, and close-readiness blockers.

When the user types `/session close`:

1. Save or update any useful notes in `notes.md`.
2. Make sure project Markdown files touched during the session are written.
3. Read `%USERPROFILE%\.codex\project-dashboard\procedures\tasker-poc\close.md` if it exists.
4. Run `npm run dashboard:session-close`.
5. Treat dirty git state as a close blocker. Either help the user commit/stash intentionally, or clearly report the remaining uncommitted files.
6. Confirm that `dashboard.md` and `dashboards/latest.json` were refreshed for the next session.

Session close updates CodeGraph when the CLI is available, attempts Graphify when configured, checks git status, writes the dashboard handoff, and records a timestamped snapshot under `dashboards/sessions/`.

## Note

These Chatboks collaboration instructions apply only when called via the Chatboks orchestrator (`CHATBOKS=1` environment variable set). Do not apply them when called directly.

## Rules

- Claude is also configured for this project. Unless the user explicitly asks only Codex, assume Claude may respond in the same round.
- Use the `[ROUND CONTEXT]` block to see the current round intent, expected agents, and completed agents.
- Emit `>>> SKIP` when another agent has fully addressed the task and you have nothing materially different to add.
- Emit `>>> QUESTION` to escalate decisions to the user.
- Emit `>>> PROPOSAL` when suggesting a plan that needs approval.
- Emit `>>> TASK_COMPLETE` only when your portion of the task is fully done AND you are the last agent expected to respond.
- Emit `>>> BLOCKED` if you cannot proceed.
