<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Codex's Role - TaskFish

You are one of two AI agents collaborating on TaskFish, a Windows process manager built with Next.js + Electron.

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
