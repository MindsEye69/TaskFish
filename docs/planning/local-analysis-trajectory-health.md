# Local Analysis Trajectory Health

Last updated: 2026-06-16

TaskFish local analysis should stop wasting time when the scan is stalled, repetitive, or no longer producing new signal. This note turns the AgentStop research item into concrete product behavior.

## Current Baseline

- Deep Scan runs unknown processes with up to three concurrent workers.
- The UI shows current item and count progress.
- Ollama streaming has an idle timeout, and failed analysis falls back to deterministic output.

## Health Signals

Track these per scan run:

| Signal | Meaning | Action |
| --- | --- | --- |
| `elapsedMs` | Total scan duration. | Show duration in the scan report. |
| `perProcessElapsedMs` | One process is slow or stuck. | Mark the item as timed out and continue. |
| `fallbackCount` | AI unavailable or invalid output. | Surface "deterministic fallback used" in report. |
| `duplicateVerdictCount` | Same generic result repeats. | Warn that the scan may be low-signal. |
| `newSignalCount` | New verdict, threat flag, or suggested rule. | Highlight useful scan output. |
| `resourcePressure` | CPU/RAM pressure during scan. | Reduce concurrency or offer pause. |

## Stop And Pause Rules

- Stop a single process analysis when the model is idle beyond the existing stream timeout.
- Pause the scan if system RAM or commit pressure becomes high enough to affect the user.
- Offer "Continue scan" rather than silently retrying every failed item.
- Treat repeated offline fallback as a setup issue, not as evidence about the process.

## Report Additions

The scan report should eventually include:

- Total duration.
- Number of AI results, deterministic fallbacks, and failures.
- Number of new suggested rules.
- Any process skipped because it timed out.
- Runtime/model used for the scan.

## Implementation Steps

1. Add an in-memory scan run object in `src/app/page.tsx` with timing and fallback counters.
2. Include fallback metadata in `AnalysisResult` handling for scan reports.
3. Add a user-visible low-signal warning when most results are repeated or fallback-only.
4. Add tests after the scan orchestration is moved into a testable helper.

