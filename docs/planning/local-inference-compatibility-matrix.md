# Local Inference Compatibility Matrix

Last updated: 2026-06-23

TaskFish currently uses Ollama for local process analysis. This matrix records the minimum facts that must be known before adding or switching local inference runtimes.

## Source Baseline

- Windows AI overview: https://learn.microsoft.com/en-us/windows/ai/overview
- Windows AI APIs: https://learn.microsoft.com/en-us/windows/ai/apis/
- Foundry Local overview: https://learn.microsoft.com/en-us/azure/foundry-local/what-is-foundry-local
- Foundry Local Agentic Retrieval what's new: https://learn.microsoft.com/en-us/azure/azure-arc/agents-tools-foundry-local/whats-new
- Foundry Local Agentic Retrieval release notes: https://learn.microsoft.com/en-us/azure/azure-arc/agents-tools-foundry-local/release-notes
- Foundry Local releases: https://github.com/microsoft/Foundry-Local/releases
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md

## Runtime Summary

| Runtime | Fit for TaskFish | Current status |
| --- | --- | --- |
| Ollama | Best current default for cross-device local LLM analysis in the Electron app. | Implemented through Electron IPC and local HTTP on `localhost:11434`. |
| Windows AI APIs | Useful future path for Windows-native AI features when the target API covers the task and hardware support is acceptable. | Planning only. Not a drop-in replacement for the current process-analysis LLM flow. |
| Foundry Local | Candidate for a managed local model runtime with Microsoft-hosted model acquisition and OpenAI-style app integration. | Planning candidate. Needs packaging, cache, logging, and model availability checks. |
| Foundry Local Agentic Retrieval | Candidate edge RAG and agent orchestration layer for future TaskFish documentation, ticket, or system-health retrieval workflows. | Preview-only planning candidate. Not appropriate for default process analysis until BYOM, layer mode, diagnostics, privacy, and release-note security validation are complete. |

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

## Foundry Local Agentic Retrieval Preview Matrix

Agentic Retrieval is separate from the current TaskFish Ollama process-analysis path. It should be evaluated as an edge RAG/agent platform, not as a simple model replacement.

| Mode / `layerSelection` | What it deploys | TaskFish fit | Minimum constraints | Fallback path | Privacy and retention notes | Security validation before use |
| --- | --- | --- | --- | --- | --- | --- |
| `combined` | Full Agentic Retrieval platform: agent orchestration plus knowledge ingestion/RAG. | Future local knowledge assistant over TaskFish docs, imported event-log guidance, and user-approved support material. | Preview only. Requires an OpenAI-compatible BYOM language-model endpoint; embedding/image components require 2 GPUs in current preview notes; Docling parser runs on CPU. | Keep current Ollama process analysis and static docs if the platform, GPUs, or BYOM endpoint are unavailable. | Highest data boundary: thread history, knowledge collections, MCP knowledge sources, ingestion artifacts, model endpoint traffic, logs, and diagnostics all need explicit retention notes and opt-out behavior. | Validate current release includes the February 2026 security fixes for Next.js DoS and Langchain XXE before enabling document ingestion or externally reachable APIs. Confirm ports/API families exposed by the deployment are expected. |
| `agentic` | Agents Runtime without local data ingestion. | Possible future task-planning or support-agent runtime when TaskFish needs threads, runs, streaming, or tool orchestration. | Preview only. Requires BYOM endpoint. No GPU requirement for local data ingestion in this mode because knowledge ingestion is not deployed. | Use current deterministic UI flows and Ollama analysis. Do not require Agentic Retrieval for core process controls. | Chat/thread history is part of the data boundary. Do not send raw process telemetry, command lines, paths, endpoints, or imported event excerpts without explicit user action and redaction. | Validate Agents Runtime API behavior, auth assumptions, timeouts, and streaming behavior against current release notes before any TaskFish integration. |
| `knowledge` | Knowledge ingestion and RAG without agent orchestration. | Possible future searchable local support corpus for TaskFish docs, runbooks, event guidance, and user-imported references. | Preview only. Requires BYOM endpoint; embedding/image pipeline currently has 2-GPU preview constraint; parser is CPU-based. | Use bundled documentation and local deterministic event clustering when ingestion is unavailable. | Ingested files, collection names, vector data, parsing logs, and retrieval traces are sensitive. User-private imports must have clear deletion/export controls before production use. | Validate Langchain XXE fix and parser dependency state before accepting user-provided files. Validate collection RBAC and MCP surface exposure before indexing sensitive docs. |

## Foundry Local Agentic Retrieval Gate

Do not enable Agentic Retrieval in TaskFish until a named owner has verified these items for the target preview/release version:

1. **Owner:** TaskFish runtime owner.
2. **BYOM endpoint:** endpoint URL, model identity, auth method, timeout behavior, and whether the endpoint can ever route to cloud inference.
3. **Layer mode:** selected `layerSelection`, exposed ports/API families, and which TaskFish feature is allowed to call it.
4. **Hardware profile:** whether the target machine satisfies the mode-specific GPU/CPU requirements; if not, the feature must stay disabled with a clear fallback.
5. **Privacy boundary:** cache paths, chat/thread history behavior, ingestion storage, diagnostics/logging, and deletion/opt-out behavior.
6. **Security fixes:** validation that release-note security fixes affecting Next.js DoS and Langchain XXE are present before using APIs or document ingestion that depend on those components.
7. **MCP exposure:** if `remote_mcp` or `indexed_sources_mcp` knowledge sources are used, they must go through the same tool/source trust review as any other executable integration.

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

## Current Implementation Status

- 2026-06-16: Electron process-analysis prompt telemetry now passes through `electron-main/processPrivacy.ts`.
- The current boundary is a privacy-safe telemetry builder, not a full runtime-provider abstraction.
- 2026-06-23: Added Agentic Retrieval preview matrix covering BYOM-only endpoint behavior, `layerSelection` modes, GPU/fallback limits, chat-history privacy, diagnostics/logging assumptions, and release-note security validation ownership.
- The full provider interface should be added before Foundry Local, Windows AI API, or additional model runtime integration.

## Open Verification Items

- Confirm the exact Foundry Local model cache path and diagnostics/log files on a test machine.
- Confirm Foundry Local's JavaScript/HTTP integration shape and tool-calling behavior for structured `AnalysisResult` output.
- Confirm Agentic Retrieval BYOM endpoint behavior, auth, timeouts, ports, chat/thread history, and diagnostics for each selected `layerSelection` mode.
- Confirm the deployed Agentic Retrieval version includes the noted Next.js DoS and Langchain XXE fixes before enabling document ingestion, external API access, or MCP knowledge sources.
- Confirm whether Phi Silica through Windows AI APIs can produce reliable short process summaries with the required JSON schema.
- Add automated tests that prove privacy redaction runs before `analyzeProcess` for every provider.
