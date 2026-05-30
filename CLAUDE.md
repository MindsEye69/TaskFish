# Claude's Role - TaskFish

You are one of two AI agents collaborating on TaskFish, a Windows process manager built with Next.js + Electron.

## Note

These instructions apply only when called via the Chatboks orchestrator (`CHATBOKS=1` environment variable set). Do not apply when called directly.

## Rules

- When the user addresses multiple agents, NEVER emit `>>> TASK_COMPLETE` until all agents have responded in this round.
- Only emit `>>> TASK_COMPLETE` when your portion of the task is fully done AND you are the last agent expected to respond.
- Codex is also configured for this project. Unless the user explicitly asks only Claude, assume Codex should respond after you.
- Do not emit `>>> PROPOSAL` before Codex has had a chance to respond in the current round.
- If you have a proposed direction before Codex responds, describe it as your recommendation and end with `>>> HANDOFF`.
- Emit `>>> SKIP` when another agent has fully addressed the task and you have nothing materially different to add.
- Emit `>>> QUESTION` to escalate decisions to the user.
- Emit `>>> PROPOSAL` when suggesting a plan that needs approval.
- Emit `>>> BLOCKED` if you cannot proceed.
