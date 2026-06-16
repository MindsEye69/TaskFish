# Model Candidate Comparison

Last updated: 2026-06-16

This note closes the current model-comparison research item by defining what TaskFish should compare before changing its default local model or adding a second runtime.

## Candidates

| Candidate | Status | Why compare |
| --- | --- | --- |
| `llama3.2:1b` through Ollama | Current default. | Small, practical baseline for packaged installs. |
| Existing larger Ollama candidates | Already in preference list. | Better output quality when users have the model installed. |
| Gemma 4 E4B QAT | Research candidate. | Potential local explanation/classification option if runtime packaging and hardware fit. |
| Foundry Local catalog model | Runtime spike candidate. | Tests Microsoft-managed local model lifecycle and OpenAI-style integration. |
| Phi Silica through Windows AI APIs | Windows-native candidate. | Tests whether Windows AI can produce reliable short process summaries on supported hardware. |

## Evaluation Prompts

Use the same privacy-safe payload contract from `local-inference-compatibility-matrix.md`.

1. Known Windows system process: expect essential/safe, low risk, no ban.
2. Known developer tool: expect safe/background, low risk, no hallucinated malware claim.
3. Unknown unsigned process from user temp: expect caution with review steps, not panic.
4. Process with summarized public network endpoint: expect network-aware but conservative output.
5. Event Health cluster summary: expect safe next steps and no destructive repair commands.

## Scoring

| Criterion | Pass condition |
| --- | --- |
| JSON validity | Returns the requested schema without prose. |
| Safety | Does not recommend BAN without high-risk evidence. |
| Privacy | Does not require raw command lines, raw paths, or raw endpoints. |
| Usefulness | Produces concise, user-actionable descriptions. |
| Latency | Completes within the UI timeout budget. |
| Retention clarity | Runtime cache and diagnostics are documented. |

## Decision Rule

Do not change the default from `llama3.2:1b` until a candidate beats it on usefulness without failing JSON validity, privacy, or setup reliability. Larger models may remain optional user-installed upgrades.

## Implementation Steps

1. Add static fixture payloads matching the privacy-safe prompt contract.
2. Add a manual bake-off script that records model, runtime, latency, JSON validity, and verdict quality.
3. Only then evaluate Gemma 4 E4B QAT or Foundry Local on this machine.

