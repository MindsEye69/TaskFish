# Graph Report - tasker-poc  (2026-07-25)

## Corpus Check
- 65 files · ~81,777 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 689 nodes · 1113 edges · 51 communities (46 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `06d5bb84`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 44|Community 44]]

## God Nodes (most connected - your core abstractions)
1. `collectSnapshot()` - 22 edges
2. `RuleConfig` - 16 edges
3. `compilerOptions` - 16 edges
4. `AiSetupPhase` - 14 edges
5. `TreeNode` - 14 edges
6. `Local Inference Compatibility Matrix` - 14 edges
7. `scripts` - 13 edges
8. `ProcessInfo` - 12 edges
9. `projectIdentity()` - 11 edges
10. `loadJson()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `offlineAnalysis()` --calls--> `getCategory()`  [EXTRACTED]
  electron-main/main.ts → src/lib/trust.ts
- `offlineAnalysis()` --calls--> `getTrust()`  [EXTRACTED]
  electron-main/main.ts → src/lib/trust.ts
- `ApiResponse` --references--> `ProcessInfo`  [EXTRACTED]
  src/app/page.tsx → src/lib/types.ts
- `GET()` --calls--> `runPowerShell()`  [EXTRACTED]
  src/app/api/processes/route.ts → src/app/api/api-helper.ts
- `GET()` --calls--> `runPowerShell()`  [EXTRACTED]
  src/app/api/stats/route.ts → src/app/api/api-helper.ts

## Import Cycles
- None detected.

## Communities (51 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (78): APP_RUNTIME_DIR, applyProcedureOverride(), appStatePath(), buildAttention(), buildFileTree(), buildFlows(), buildReadiness(), collectAppControl() (+70 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (40): ANALYSIS_PROMPT(), cacheAndReturnOffline(), getBestModel(), getInstalledModels(), MODEL_PREFERENCE, offlineAnalysis(), POST(), execAsync (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (35): AiSetupPhase, auditLogPath, bannedPids, buildEventFixChatPrompt(), cachePath, compactFixForChat(), CpuSample, cpuSamples (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (28): connectionSides(), countOpenTickets(), DashboardResponse, DashboardSnapshot, DEFAULT_MODULE_LAYOUT, edgeColor(), edgePath(), EdgeSelection (+20 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (35): author, dependencies, next, react, react-dom, description, devDependencies, concurrently (+27 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (17): Filter, FILTERS, Sort, TIER_KEYS, TIER_META, TierKey, buildVendorGroups(), COMPANY_CANONICAL (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (21): AuditEvent, CATEGORY_LABELS, EVENT_COLORS, HEALTH_COLORS, HEALTH_LABELS, LEVEL_COLORS, LIVE_EVENT_CHANNELS, LiveEventChannel (+13 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (18): ApiResponse, AuditEvent, DEFAULT_SETTINGS, Home(), MemoryAlertLevel, normalizeName(), ProcessHistory, processMatches() (+10 more)

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (17): Props, CATEGORY_RGB, Props, TRUST_LABEL, Props, fmtRam(), Props, TRUST_COLOR (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (19): build, appId, directories, extraResources, files, nsis, productName, win (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.12
Nodes (10): AuditEvent, EVENT_META, KIND_ICONS, normalizeNetworkTelemetry(), Props, TimelineEntry, toArray(), Props (+2 more)

### Community 12 - "Community 12"
Cohesion: 0.14
Nodes (17): apiBackupPath, apiPath, appendBuildLog(), buildLogPath, downloadFile(), ensureOllamaBinary(), { execSync }, fs (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (14): Compatibility Matrix, Current Implementation Status, Foundry Local Agentic Retrieval Gate, Foundry Local Agentic Retrieval Preview Matrix, Foundry Local Agentic Retrieval Validation Backlog, July 2026 Agentic Retrieval Release Notes Impact, Local Inference Compatibility Matrix, Open Verification Items (+6 more)

### Community 14 - "Community 14"
Cohesion: 0.24
Nodes (13): CONFIG_PATH, DASHBOARD_HOME, DashboardAction, execFileAsync, GET(), isInsideRoot(), openNativeFile(), PAPER_SLEUTH_ROOT (+5 more)

### Community 15 - "Community 15"
Cohesion: 0.24
Nodes (13): appendAudit(), auditAndPromote(), createWindow(), loadJson(), loadMetaCache(), log(), notify(), queueVerification() (+5 more)

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (12): compilerOptions, baseUrl, esModuleInterop, module, moduleResolution, outDir, paths, skipLibCheck (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.24
Nodes (11): cleanCommand(), commandAsInstruction(), EventFixStepLike, isCopyableTerminalCommand(), isRiskyCmd(), normalizeCommandLine(), removedUnsafeStep(), warningForStep() (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.21
Nodes (11): collectProcessRefs(), createTray(), enforceProcessRules(), getTrayIcon(), isProtectedProcessName(), normalizeRuleName(), normalizeRules(), runBackgroundEnforcement() (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.22
Nodes (10): evaluateWindowsAiGate(), gpuGeneration(), LocalInferenceProvider, LocalInferenceProviderId, ProviderRoute, readLocalInferenceConfiguration(), selectLocalInferenceProvider(), WindowsAiCapabilities (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (10): collectProcessTelemetry(), buildPrivacySafeProcessTelemetry(), classifyAddress(), classifyPath(), commandLineSummary(), containsSecretLikeValue(), escapeCimFilterLiteral(), RawProcessTelemetry (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (7): commitPressure(), fmtGb(), Header(), pressureColor(), Props, Props, SystemStats

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (8): buildRows(), fmtRam(), History, MemoryRow, MemoryWatch(), normalizeName(), Props, ProcessInfo

### Community 23 - "Community 23"
Cohesion: 0.20
Nodes (9): Classification Model, Current Data Map, Implementation Checklist, Implementation Status, Inference Policy, Open Follow-Up, Process Data Privacy Classes, Redaction Rules (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.39
Nodes (8): clusterEvents(), decodeXml(), EventLogEntry, extractMessage(), firstMatch(), KNOWN_EVENTS, levelDisplayName(), parseWevtutilXml()

### Community 25 - "Community 25"
Cohesion: 0.22
Nodes (8): Current Decision, Current Signal, Experiment-To-Production Promotion Checklist, Feature Matrix, Observability Contract, Runtime Rejection Reasons, Source And Verification, Windows AI Experimental Feature Gate

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (7): 1. Convert to a Desktop App, 2. Bundling Ollama (The AI Engine), 3. Creating the Installer, 4. Hardware Acceleration, Package.json additions (Example):, Steps:, Tasker: Windows Packaging & AI Bundling Guide

### Community 27 - "Community 27"
Cohesion: 0.36
Nodes (7): ensureDataDir(), getRules(), normalizeRuleKey(), RULES_PATH, RulesData, saveRule(), RuleAction

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (7): broadcastAiStatus(), ensureDefaultModel(), openSecurityCenter(), pullOllamaModel(), sendToMainWindow(), sendToWebContents(), showMainWindow()

### Community 29 - "Community 29"
Cohesion: 0.38
Nodes (3): PersistentPS, quitTaskFish(), stopOllama()

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (6): Current Baseline, Endpoint Telemetry Plan, Implementation Steps, Low-Noise Mapping, Product Rules, Telemetry Sources

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (6): Current Baseline, Health Signals, Implementation Steps, Local Analysis Trajectory Health, Report Additions, Stop And Pause Rules

### Community 32 - "Community 32"
Cohesion: 0.29
Nodes (6): Candidates, Decision Rule, Evaluation Prompts, Implementation Steps, Model Candidate Comparison, Scoring

### Community 33 - "Community 33"
Cohesion: 0.29
Nodes (6): 🧠 AI Deep Scan, 🚀 Building for Windows (.exe), Deploy on Vercel, Getting Started, Learn More, Third-party AI Runtime

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (5): Codex's Role - TaskFish, Note, Project Dashboard Session Protocol, Rules, This is NOT the Next.js you know

### Community 35 - "Community 35"
Cohesion: 0.50
Nodes (3): Claude's Role - TaskFish, Note, Rules

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (3): execAsync, POST(), PRIORITIES

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (3): killPid(), safeExec(), startOllama()

## Knowledge Gaps
- **266 isolated node(s):** `EventFixStepLike`, `LocalInferenceProviderId`, `WindowsAiHardwarePath`, `WindowsAiRejectionReason`, `WindowsAiCapabilities` (+261 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `EventCluster` connect `Community 6` to `Community 24`, `Community 1`, `Community 2`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `EventHealthReport` connect `Community 6` to `Community 24`, `Community 1`, `Community 2`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `EventHealthFinding` connect `Community 6` to `Community 24`, `Community 1`, `Community 2`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `EventFixStepLike`, `LocalInferenceProviderId`, `WindowsAiHardwarePath` to the rest of the system?**
  _266 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06172839506172839 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0655367231638418 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.0407843137254902 - nodes in this community are weakly interconnected._