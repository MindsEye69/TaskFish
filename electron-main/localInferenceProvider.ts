export type LocalInferenceProviderId = "ollama" | "windows-ai";
export type WindowsAiHardwarePath = "npu" | "gpu" | "cpu" | "none";

export type WindowsAiRejectionReason =
  | "windows_ai_provider_not_enabled"
  | "unsupported_windows_app_sdk_version"
  | "unsupported_windows_channel"
  | "unsupported_gpu"
  | "developer_mode_required"
  | "gpu_driver_requirement_unmet"
  | "phi_silica_cpu_not_supported"
  | "model_download_requires_user_consent"
  | "model_not_ready_or_removed"
  | "region_or_policy_unavailable"
  | "windows_ai_runtime_unavailable";

export interface WindowsAiCapabilities {
  providerEnabled: boolean;
  runtimeAvailable: boolean;
  windowsAppSdkVersion?: string;
  windowsChannel?: string;
  hardwarePath: WindowsAiHardwarePath;
  gpuClass?: string;
  vramGb?: number;
  developerMode?: boolean;
  gpuDriverSupported?: boolean;
  modelReady?: boolean;
  modelDownloadConsent?: boolean;
  regionOrPolicyAvailable?: boolean;
}

export interface ProviderRoute {
  requested: LocalInferenceProviderId;
  selected: LocalInferenceProviderId;
  reasonCode?: WindowsAiRejectionReason;
  capabilities?: WindowsAiCapabilities;
}

export interface LocalInferenceProvider<Request, Result> {
  readonly id: LocalInferenceProviderId;
  analyze(request: Request): Promise<Result>;
}

const EXPERIMENTAL_GPU_SDK = "2.2.2-experimental9";

function gpuGeneration(gpuClass: string): number | null {
  const match = /\brtx\s*(\d{2})\d{2}\b/i.exec(gpuClass);
  return match ? Number(match[1]) : null;
}

export function evaluateWindowsAiGate(
  capabilities: WindowsAiCapabilities,
): WindowsAiRejectionReason | null {
  if (!capabilities.providerEnabled) return "windows_ai_provider_not_enabled";
  if (capabilities.regionOrPolicyAvailable === false) return "region_or_policy_unavailable";
  if (capabilities.hardwarePath === "cpu") return "phi_silica_cpu_not_supported";
  if (capabilities.hardwarePath === "none") return "model_not_ready_or_removed";

  if (capabilities.hardwarePath === "gpu") {
    if (capabilities.windowsAppSdkVersion !== EXPERIMENTAL_GPU_SDK) {
      return "unsupported_windows_app_sdk_version";
    }
    if (!/experimental/i.test(capabilities.windowsChannel ?? "")) {
      return "unsupported_windows_channel";
    }
    const generation = gpuGeneration(capabilities.gpuClass ?? "");
    if (generation === null || generation < 30 || (capabilities.vramGb ?? 0) < 6) {
      return "unsupported_gpu";
    }
    if (!capabilities.developerMode) return "developer_mode_required";
    if (!capabilities.gpuDriverSupported) return "gpu_driver_requirement_unmet";
  }

  if (!capabilities.modelReady) {
    if (!capabilities.modelDownloadConsent) return "model_download_requires_user_consent";
    return "model_not_ready_or_removed";
  }
  if (!capabilities.runtimeAvailable) return "windows_ai_runtime_unavailable";
  return null;
}

export function selectLocalInferenceProvider(
  requested: LocalInferenceProviderId,
  capabilities?: WindowsAiCapabilities,
): ProviderRoute {
  if (requested === "ollama") return { requested, selected: "ollama" };

  const checked = capabilities ?? {
    providerEnabled: false,
    runtimeAvailable: false,
    hardwarePath: "none" as const,
  };
  const reasonCode = evaluateWindowsAiGate(checked);
  return reasonCode
    ? { requested, selected: "ollama", reasonCode, capabilities: checked }
    : { requested, selected: "windows-ai", capabilities: checked };
}

export function readLocalInferenceConfiguration(
  env: NodeJS.ProcessEnv,
): { requested: LocalInferenceProviderId; windowsAi: WindowsAiCapabilities } {
  const enabled = env.TASKFISH_WINDOWS_AI_ENABLED === "1";
  const hardware = env.TASKFISH_WINDOWS_AI_HARDWARE?.toLowerCase();
  const hardwarePath: WindowsAiHardwarePath =
    hardware === "npu" || hardware === "gpu" || hardware === "cpu" ? hardware : "none";
  const optionalBoolean = (value: string | undefined) =>
    value === undefined ? undefined : value === "1";

  return {
    requested: env.TASKFISH_LOCAL_AI_PROVIDER === "windows-ai" ? "windows-ai" : "ollama",
    windowsAi: {
      providerEnabled: enabled,
      // No Windows App SDK bridge ships yet. This remains false until that adapter is added.
      runtimeAvailable: false,
      windowsAppSdkVersion: env.TASKFISH_WINDOWS_APP_SDK_VERSION,
      windowsChannel: env.TASKFISH_WINDOWS_CHANNEL,
      hardwarePath,
      gpuClass: env.TASKFISH_WINDOWS_AI_GPU_CLASS,
      vramGb: env.TASKFISH_WINDOWS_AI_VRAM_GB
        ? Number(env.TASKFISH_WINDOWS_AI_VRAM_GB)
        : undefined,
      developerMode: optionalBoolean(env.TASKFISH_WINDOWS_DEVELOPER_MODE),
      gpuDriverSupported: optionalBoolean(env.TASKFISH_WINDOWS_AI_GPU_DRIVER_SUPPORTED),
      modelReady: optionalBoolean(env.TASKFISH_WINDOWS_AI_MODEL_READY),
      modelDownloadConsent: optionalBoolean(env.TASKFISH_WINDOWS_AI_MODEL_DOWNLOAD_CONSENT),
      regionOrPolicyAvailable: optionalBoolean(env.TASKFISH_WINDOWS_AI_POLICY_AVAILABLE),
    },
  };
}
