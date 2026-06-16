# Endpoint Telemetry Plan

Last updated: 2026-06-16

TaskFish already exposes per-process TCP/UDP sockets and imported Windows Event Health. This plan defines the next telemetry layer before adding ETW, WMI, Sysmon, or MITRE ATT&CK language to user-facing security features.

## Current Baseline

- Per-process network sockets: `Get-NetTCPConnection` and `Get-NetUDPEndpoint`.
- Process identity: `Win32_Process`, signature metadata, vendor matching, trust/rule state.
- Event Health: imported `.evtx` files parsed through `wevtutil`, normalized, clustered, and optionally analyzed.

## Telemetry Sources

| Source | Near-term use | Data risk | Implementation note |
| --- | --- | --- | --- |
| WMI / CIM process data | Process identity, parent PID, executable class, service linkage. | Command lines and paths can expose private data. | Use the privacy payload builder before prompts, exports, or logs. |
| Windows Event Logs | System/Application health, update failures, service errors, kernel power events. | Event messages may include paths, usernames, app package names. | Keep import-first. Redact before sharing or exporting. |
| ETW | Future low-latency event stream for process, network, and security signals. | High volume and potentially sensitive payloads. | Add only with bounded providers, retention limits, and user-visible controls. |
| Sysmon | Optional advanced security enrichment when installed by the user. | Rich endpoint telemetry, including command lines and hashes. | Detect presence, do not require install, and label as advanced mode. |

## Low-Noise Mapping

TaskFish should map evidence to ATT&CK-style behavior only when the signal is explicit:

- Process starts from user temp plus suspicious network egress: possible execution from unusual location.
- Unsigned process with repeated public remote endpoints: suspicious network behavior.
- Repeated service failure or recovery loops: system health issue, not malware by default.
- Kernel power or WHEA events: reliability issue unless paired with security indicators.

Do not show ATT&CK technique IDs until a deterministic rule or documented mapping supports the label. Prefer plain-language behavior tags first.

## Product Rules

1. Keep raw endpoints, command lines, and event excerpts out of model prompts unless the user explicitly asks for diagnostic sharing.
2. Store only summarized evidence in generated analysis caches.
3. Add source and freshness metadata to future evidence timeline entries.
4. Let users distinguish TaskFish-observed telemetry from imported or optional Sysmon telemetry.
5. Keep security wording conservative: "watch", "review", or "needs attention" before "malware".

## Implementation Steps

1. Add a telemetry source registry with source name, collection command, privacy class, and retention rule.
2. Add tests for WMI/process privacy redaction before any ETW/Sysmon collector is added.
3. Add optional Sysmon detection only after the registry exists.
4. Add ATT&CK mapping only for deterministic, documented patterns.

