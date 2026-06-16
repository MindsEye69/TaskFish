# Local Inference Compatibility Matrix

Last updated: 2026-06-16

TaskFish currently uses Ollama for local process analysis. This matrix records the minimum facts that must be known before adding or switching local inference runtimes.

## Source Baseline

- Windows AI overview: https://learn.microsoft.com/en-us/windows/ai/overview
- Windows AI APIs: https://learn.microsoft.com/en-us/windows/ai/apis/
- Foundry Local overview: https://learn.microsoft.com/en-us/azure/foundry-local/what-is-foundry-local
- Foundry Local releases: https://github.com/microsoft/Foundry-Local/releases
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md

## Runtime Summary

| Runtime | Fit for TaskFish | Current status |
| --- | --- | --- |
| Ollama | Best current default for cross-device local LLM analysis in the Electron app. | Implemented through Electron IPC and local HTTP on `localhost:11434`. |
| Windows AI APIs | Useful future path for Windows-native AI features when the target API covers the task and hardware support is acceptable. | Planning only. Not a drop-in replacement for the current process-analysis LLM flow. |
| Foundry Local | Candidate for a managed local model runtime with Microsoft-hosted model acquisition and OpenAI-style app integration. | Planning candidate. Needs packaging, cache, logging, and model availability checks. |

## Compatibility Matrix

| Capability | Ollama | Windows AI APIs | Foundry Local |
| --- | --- | --- | --- |
| Primary TaskFish use | Process explanation, risk summary, rule suggestion, deep scan. | Future Windows-native text, OCR, speech, or image capabilities where APIs fit. Phi Silica may cover text generation on supported hardware. | Process explanation and structured analysis with Microsoft-managed local models. |
| App integration style | Local HTTP API; current app launches `ollama.exe serve` and calls the runtime through Electron. | Windows App SDK APIs from native Windows app code. Electron integration likely requires a native bridge or companion process. | Local runtime and SDK/REST integration; evaluate whether it can replace or sit beside Ollama. |
| Supported languages | Any client that can call local HTTP; current implementation is TypeScript/Electron main process. | C# and C++ are first-class in the docs; JavaScript/Electron needs a bridge. | SDK/REST path should support TypeScript through HTTP if available; confirm before implementation. |
| Model size and acquisition | Depends on selected Ollama model. Current default is `llama3.2:1b`; first use may download about 1 GB. | Some models are preinstalled on supported Copilot+ PCs; others download on first readiness call through Windows components and can be several GB. | Microsoft-hosted models are acquired at runtime and shared across apps. Model list and size vary by release. |
| Hardware requirement | Runs on CPU and can use available acceleration depending on Ollama/model support. Quality and speed vary widely. | API-specific. Copilot+ PC NPU is the best-supported path; some APIs are expanding to GPU/CPU with specific requirements. | Windows 10 and later PCs are in scope, with performance depending on hardware and selected model. |
| Cache location | Ollama model cache is outside TaskFish. TaskFish analysis cache is `app.getPath("userData")\process_cache.json`. | Model components are managed by Windows and may be removable through Windows AI Components. TaskFish must not assume files are in its own userData. | Runtime-managed model cache outside TaskFish. Exact path must be discovered and documented during a spike. |
| Diagnostics/logging | TaskFish writes `logs\taskfish_debug.txt` and `logs\deep_scan_log.txt`. Ollama may have its own logs outside TaskFish. | Windows/runtime diagnostics may exist outside TaskFish. App should expose only TaskFish-owned logs unless the user opts into collecting external diagnostics. | Foundry Local diagnostics and release behavior must be reviewed before enablement. Treat logs as part of the data boundary. |
| BYOM flow | User or app can pull a model by name with `pullModel`. Model license and storage are upstream-owned. | Windows AI APIs are not a general BYOM path. Windows ML is the BYOM path, but that is separate from the ready-to-use APIs. | Candidate BYOM support depends on current Foundry Local model catalog and SDK behavior. Must be verified in a spike. |
| Offline behavior | Works after the executable and selected model are present. First-use model pull needs network unless preseeded. | Depends on API and whether model is already installed. Some readiness calls trigger downloads. | Works after runtime and model are present. First-use acquisition likely needs network. |
| Fallback behavior | Current app: if AI is unavailable, core process controls still work; analysis shows setup/error state and can prompt model download. | If unavailable, keep current Ollama path and disable Windows-AI-specific features. | If unavailable, keep current Ollama path and show runtime-specific setup state. |
| Retention boundary | Process prompts and generated summaries may pass through Ollama. TaskFish stores generated analysis in its cache. | Inputs pass to Windows-managed local components. Retention and diagnostics must be treated as external to TaskFish. | Inputs pass to Foundry Local. Cache and diagnostics must be classified before production use. |

## TaskFish Runtime Requirements

Any runtime provider must implement these behaviors before it can become the default:

1. `start`: verify the runtime is installed, start it if TaskFish owns the sidecar, and return a typed setup phase.
2. `health`: report availability, selected model, missing model/runtime errors, and actionable setup text.
3. `analyzeProcess`: accept a privacy-classified prompt payload, stream progress when supported, and return `AnalysisResult`.
4. `listModels`: return installed and available model identifiers when supported.
5. `pullOrInstallModel`: perform model acquisition only after clear user action.
6. `retentionInfo`: report known model cache, diagnostics, log, and cloud-fallback behavior.
7. `stop`: stop only the sidecar TaskFish started; never kill a user-managed runtime without clear ownership.

## Prompt Payload Contract

The runtime provider receives a structured payload, not raw process telemetry:

```json
{
  "process": {
    "name": "example.exe",
    "vendor": "Example Corp",
    "trust": "unknown",
    "category": "user"
  },
  "resources": {
    "cpuPercent": 3.2,
    "ramMB": 420,
    "handles": 180
  },
  "evidence": {
    "startupApp": false,
    "services": ["Example Service"],
    "networkSummary": "1 public remote endpoint on 443",
    "moduleSummary": "2 non-system modules"
  },
  "ruleState": {
    "action": "NONE",
    "manualControl": false
  }
}
```

The provider must not receive raw command lines, raw environment variables, unredacted user paths, or secret-like values.

## Recommended Near-Term Decision

Keep Ollama as the default runtime for the current Electron app because it is already integrated and works through local HTTP from TypeScript. Add a provider boundary before any runtime expansion:

- `ollamaProvider`: wraps the existing `startOllama`, model pull, stream, and analysis calls.
- `runtimeProvider` interface: captures the requirements above.
- `privacyPayloadBuilder`: converts process/evidence data into the prompt payload contract.

Then run a Foundry Local spike behind the same provider interface. Windows AI APIs should remain a feature-specific path, not a replacement for the general process-analysis LLM, until Electron/native bridging and hardware availability are proven.

## Open Verification Items

- Confirm the exact Foundry Local model cache path and diagnostics/log files on a test machine.
- Confirm Foundry Local's JavaScript/HTTP integration shape and tool-calling behavior for structured `AnalysisResult` output.
- Confirm whether Phi Silica through Windows AI APIs can produce reliable short process summaries with the required JSON schema.
- Add automated tests that prove privacy redaction runs before `analyzeProcess` for every provider.
