import assert from "node:assert/strict";
import test from "node:test";
import provider from "../dist/electron-main/localInferenceProvider.js";

const {
  evaluateWindowsAiGate,
  readLocalInferenceConfiguration,
  selectLocalInferenceProvider,
} = provider;

const supportedGpu = {
  providerEnabled: true,
  runtimeAvailable: true,
  windowsAppSdkVersion: "2.2.2-experimental9",
  windowsChannel: "Windows Insider Experimental Channel",
  hardwarePath: "gpu",
  gpuClass: "NVIDIA GeForce RTX 3060",
  vramGb: 6,
  developerMode: true,
  gpuDriverSupported: true,
  modelReady: true,
  modelDownloadConsent: true,
  regionOrPolicyAvailable: true,
};

test("keeps Ollama as the default provider", () => {
  const config = readLocalInferenceConfiguration({});
  assert.equal(config.requested, "ollama");
  assert.deepEqual(selectLocalInferenceProvider(config.requested), {
    requested: "ollama",
    selected: "ollama",
  });
});

test("rejects disabled and CPU Phi Silica requests with stable reason codes", () => {
  assert.equal(
    evaluateWindowsAiGate({ providerEnabled: false, runtimeAvailable: false, hardwarePath: "gpu" }),
    "windows_ai_provider_not_enabled",
  );
  assert.equal(
    evaluateWindowsAiGate({ providerEnabled: true, runtimeAvailable: false, hardwarePath: "cpu" }),
    "phi_silica_cpu_not_supported",
  );
});

test("checks the experimental channel and GPU requirements", () => {
  assert.equal(
    evaluateWindowsAiGate({ ...supportedGpu, windowsChannel: "Retail" }),
    "unsupported_windows_channel",
  );
  assert.equal(
    evaluateWindowsAiGate({ ...supportedGpu, gpuClass: "NVIDIA GeForce RTX 2060" }),
    "unsupported_gpu",
  );
  assert.equal(
    evaluateWindowsAiGate({ ...supportedGpu, developerMode: false }),
    "developer_mode_required",
  );
  assert.equal(evaluateWindowsAiGate(supportedGpu), null);
});

test("rolls an unavailable Windows AI runtime back to Ollama explicitly", () => {
  const route = selectLocalInferenceProvider("windows-ai", {
    ...supportedGpu,
    runtimeAvailable: false,
  });
  assert.equal(route.selected, "ollama");
  assert.equal(route.reasonCode, "windows_ai_runtime_unavailable");
});

test("requires explicit consent before a model download", () => {
  assert.equal(
    evaluateWindowsAiGate({
      ...supportedGpu,
      modelReady: false,
      modelDownloadConsent: false,
    }),
    "model_download_requires_user_consent",
  );
});
