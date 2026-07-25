# Windows AI Experimental Feature Gate

Last updated: 2026-07-25

This gate prevents TaskFish from treating experimental Windows AI API behavior as a stable local-inference path.

## Source And Verification

- Source: https://learn.microsoft.com/lv-lv/windows/ai/apis/
- Source page last updated: 2026-06-11
- TaskFish verification date: 2026-06-23
- Matrix owner: TaskFish runtime owner

## Current Signal

The Windows AI API table lists Phi Silica on GPU under Windows App SDK `2.2.2-experimental9` for June 2026 Experimental and says it requires a Windows Insider Experimental Channel build. The same page describes GPU support as select NVIDIA GPUs, RTX 30 series or newer with at least 6 GB VRAM, Developer Mode enabled, and current manufacturer GPU drivers. CPU is not supported for Phi Silica.

TaskFish must keep Ollama as the default process-analysis runtime until a Windows AI provider passes this gate.

## Feature Matrix

| Feature | Stability | Hardware / OS gate | Model availability | TaskFish behavior |
| --- | --- | --- | --- | --- |
| Phi Silica on NPU | Supported path on Copilot+ PCs, subject to API access and readiness. | Copilot+ PC NPU and supported Windows App SDK version. | Preinstalled on supported Copilot+ PCs. | Planning candidate for short process summaries after provider boundary exists. |
| Phi Silica on GPU | Experimental. | Windows App SDK `2.2.2-experimental9`, Windows Insider Experimental Channel, select NVIDIA RTX 30+ GPU with 6+ GB VRAM, Developer Mode, current manufacturer driver. | Downloaded on demand through Windows Update after readiness/consent flow. | Reject unless every gate passes; never package as default. |
| Phi Silica on CPU | Not supported in reviewed API table. | None. | Not applicable. | Reject explicitly. |

## Runtime Rejection Reasons

Any future Windows AI provider must reject unsupported combinations with one of these logged reasons:

- `windows_ai_provider_not_enabled`
- `unsupported_windows_app_sdk_version`
- `unsupported_windows_channel`
- `unsupported_gpu`
- `developer_mode_required`
- `gpu_driver_requirement_unmet`
- `phi_silica_cpu_not_supported`
- `model_download_requires_user_consent`
- `model_not_ready_or_removed`
- `region_or_policy_unavailable`

The provider must not silently fall back to another inference stack without recording which stack is used.

## Observability Contract

Record these fields for every Windows AI readiness check:

- Windows App SDK version.
- Windows build/channel, when available.
- Provider name and requested capability.
- Hardware path: NPU, GPU, CPU, or none.
- Ready state before `EnsureReadyAsync`.
- Whether a model download would be triggered.
- User consent result for model download.
- Rejection reason or selected fallback.

Do not log raw process telemetry, command lines, unredacted paths, or remote endpoints as part of capability checks.

## Experiment-To-Production Promotion Checklist

Before changing TaskFish local AI strategy based on Windows AI experimental behavior:

1. Document what changed in the Windows AI API or Windows App SDK release.
2. Record the exact build/channel and Windows App SDK package version.
3. Verify process-summary quality against TaskFish model-candidate fixtures.
4. Verify no raw process telemetry bypasses `electron-main/processPrivacy.ts` or its future provider equivalent.
5. Verify model download consent and removal/reinstall behavior.
6. Define rollback to Ollama and deterministic fallback.
7. Record regression risk and owner approval in this document or a successor decision log.

## Current Decision

Windows AI API support remains disabled by default. The runtime-provider boundary and executable gate now exist in `electron-main/localInferenceProvider.ts`. A Windows AI request is accepted only after its declared build/channel, hardware, driver, Developer Mode, policy, consent, and model-readiness capabilities pass; because TaskFish does not yet ship a Windows App SDK bridge, an otherwise valid request is rejected with `windows_ai_runtime_unavailable` and explicitly routed back to Ollama. Deterministic analysis remains the final fallback if Ollama is unavailable or inference fails.

The opt-in configuration surface is intentionally machine-local:

- `TASKFISH_LOCAL_AI_PROVIDER=windows-ai`
- `TASKFISH_WINDOWS_AI_ENABLED=1`
- `TASKFISH_WINDOWS_APP_SDK_VERSION`
- `TASKFISH_WINDOWS_CHANNEL`
- `TASKFISH_WINDOWS_AI_HARDWARE` (`npu`, `gpu`, or `cpu`)
- `TASKFISH_WINDOWS_AI_GPU_CLASS`, `TASKFISH_WINDOWS_AI_VRAM_GB`, and `TASKFISH_WINDOWS_AI_GPU_DRIVER_SUPPORTED`
- `TASKFISH_WINDOWS_DEVELOPER_MODE`
- `TASKFISH_WINDOWS_AI_MODEL_READY` and `TASKFISH_WINDOWS_AI_MODEL_DOWNLOAD_CONSENT`
- `TASKFISH_WINDOWS_AI_POLICY_AVAILABLE`

These values are capability evidence for the experimental gate, not a supported end-user settings contract. Gate logs contain only provider/capability metadata and a stable `reason_code`; process telemetry is collected only after routing and continues through the existing privacy normalizer.
