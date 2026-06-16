# Process Data Privacy Classes

Last updated: 2026-06-16

TaskFish observes Windows process data so it can classify, explain, and control local activity. This document defines the data classes that must be applied before adding new local AI, telemetry, scan export, or diagnostics features.

## Scope

Current TaskFish surfaces include:

- Process list data from `Win32_Process` and process performance counters.
- Per-process identity fields exposed through `ProcessInfo`.
- Analysis summaries cached in Electron `userData`.
- Optional live evidence tabs for modules, network sockets, and services.
- Rule, profile, audit, icon, metadata, event-health, and deep-scan log files in Electron `userData`.
- Local inference through the bundled or installed Ollama runtime.

## Classification Model

| Class | Examples | Display | Cache | Logs / Exports | AI Input |
| --- | --- | --- | --- | --- | --- |
| Public app metadata | Process name, normalized executable name, vendor/company string, static trust/category, app icon | Allowed | Allowed | Allowed | Allowed |
| Resource telemetry | PID, parent PID, CPU %, RAM, handles, commit/pagefile/system totals | Allowed | Short-lived only unless used in user-visible history | Aggregate or per-process with timestamp | Allowed after process name normalization |
| Executable path | `ExecutablePath`, module `FileName`, install directory, user profile fragments in paths | Allowed only in detail views | Cache only when needed for trust verification | Redact user profile and temp path segments by default | Avoid unless path reputation is the explicit task |
| Command line | Full command line, script arguments, interpreter flags, launched document paths | Do not display by default | Do not persist by default | Redact before export | Do not send by default |
| Environment variables | Process environment, inherited PATH, tokens in env-like strings | Do not collect unless a user requests diagnostics | Do not persist | Never include raw values | Never send raw values |
| Network endpoints | Local/remote IP, hostname, port, protocol, connection state | Allowed in evidence views | Short-lived by default | Remote endpoint export requires redaction option | Send only host class or reputation features unless user opts in |
| Secrets-risk strings | API keys, bearer tokens, connection strings, private keys, cookie/session values, command fragments containing credentials | Never display raw | Never persist | Never export raw | Never send raw |
| User-private paths and names | User profile directory, Desktop/Documents/Downloads paths, file names, OneDrive/share names | Redact by default | Persist only redacted form | Export only redacted form | Send only redacted form |
| Security decisions | Rule action, manual-control flag, override trust, audit event type, risk score, threat flags | Allowed | Allowed | Allowed | Allowed as context |
| Generated analysis | AI verdict, title, description, tip, suggested rule, model error | Allowed | Allowed in `process_cache.json` | Allowed with model/runtime metadata | Output only; never treat as ground truth without evidence |

## Current Data Map

| Source | Current fields | Privacy class | Required handling |
| --- | --- | --- | --- |
| `ProcessInfo` | `id`, `name`, `ramMB`, `cpu`, `ppid`, `handles`, `trust`, `category`, `vendor`, `execPath` | Public metadata, resource telemetry, executable path | Keep `execPath` out of broad lists unless redacted or user opens details. |
| Process grid and memory watch | Name, PID-backed grouping, CPU/RAM history, trust/category, rules | Public metadata, resource telemetry, security decisions | History should stay local and bounded. |
| Analysis drawer overview | Process name, startup status, AI result, rule controls | Public metadata, security decisions, generated analysis | AI prompt should use normalized process name first. |
| Analysis drawer modules tab | DLL module name and file path | Executable path, user-private paths | Redact profile/temp path segments before scan logs or AI prompts. |
| Analysis drawer network tab | TCP/UDP local and remote endpoints | Network endpoints | Treat remote endpoint data as sensitive until classified. |
| Analysis drawer services tab | Service name, display name, state, startup mode | Public metadata, security decisions | Safe for local display and analysis. |
| Electron caches | `process_cache.json`, `rules.json`, `profiles.json`, `audit_log.json`, `process_metadata_cache.json`, `event_health_cache.json`, logs | Mixed | Each writer must classify fields before persisting new data. |
| Deep scan log | Process, verdict, rule, description/tip | Public metadata, generated analysis | Do not add paths, command lines, endpoints, or env values without redaction. |

## Redaction Rules

Apply these rules before data leaves the live UI state, enters a durable log/export, or is included in an inference prompt.

| Input | Redacted form |
| --- | --- |
| `C:\Users\<name>\...` | `%USERPROFILE%\...` |
| `%LOCALAPPDATA%`, `%APPDATA%`, `%TEMP%` expansions | Environment-variable form, not resolved username path |
| File names under Documents/Desktop/Downloads/OneDrive | Keep extension and parent class only, for example `%USERPROFILE%\Documents\*.pdf` |
| IPv4/IPv6 remote endpoints | Keep port and address class by default, for example `public-ip:443`, `private-ip:5353` |
| Hostnames | Keep registrable domain only when reputation is needed; otherwise `redacted-host` |
| Command line arguments | Keep executable and known safe flags; replace positional paths and values with `<redacted>` |
| Secret-like values | Replace the full value with `<secret:redacted>` |

Secrets-risk detection should run before all other formatting. Treat these patterns as secrets-risk even when embedded in command lines or logs: `apikey`, `api_key`, `token`, `bearer`, `secret`, `password`, `passwd`, `pwd`, `connectionstring`, `private_key`, `BEGIN RSA PRIVATE KEY`, `AWS_ACCESS_KEY_ID`, `AZURE_CLIENT_SECRET`, and URL credentials.

## Inference Policy

TaskFish may send the following to local inference runtimes without additional user consent:

- Process name and normalized executable name.
- Static trust/category, resource telemetry, startup presence, service linkage.
- Existing TaskFish rule state and prior generated analysis.

TaskFish must require explicit user action before sending:

- Full executable paths.
- Network remote endpoints.
- Non-system module paths.
- Deep event-log excerpts or imported diagnostic reports.

TaskFish must not send raw:

- Command lines.
- Environment variables.
- Secret-like strings.
- User-private file paths or filenames.

Local inference is still a data boundary. Ollama, Windows AI APIs, Foundry Local, and any future runtime can keep model files, diagnostics, request traces, or crash data outside TaskFish's own cache files. Runtime-specific retention must be documented before a runtime is enabled.

## Implementation Checklist

Before adding or changing a telemetry or AI feature:

1. Add each new field to the classification table.
2. Decide display, cache, log/export, and AI-input handling.
3. Add a redaction helper or reuse an existing one before persistence or prompting.
4. Include runtime/cache location in the local inference matrix if the feature sends data to a model runtime.
5. Add a test fixture for at least one user-private path, one command line with a fake secret, and one remote endpoint.

## Open Follow-Up

The current app already exposes module paths and network endpoints in detail views. The next implementation step should add a shared redaction helper before expanding exports, prompt content, or persistent evidence snapshots.
