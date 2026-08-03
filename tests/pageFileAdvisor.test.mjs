import assert from "node:assert/strict";
import test from "node:test";
import advisor from "../dist/src/lib/pageFileAdvisor.js";

const { assessPageFileConfiguration, isPageFileConfigurationHealthy } = advisor;

test("recognizes a system-managed pagefile on a selected drive", () => {
  const configuration = assessPageFileConfiguration({
    automaticManaged: false,
    totalRamMB: 32768,
    files: [{
      path: "D:\\pagefile.sys",
      allocatedMB: 8704,
      currentUsageMB: 0,
      peakUsageMB: 0,
      initialSizeMB: 0,
      maximumSizeMB: 0,
      driveFreeMB: 655360,
    }],
    volumes: [{
      drive: "D:",
      diskName: "Development NVMe",
      busType: "NVMe",
      mediaType: "SSD",
      sizeMB: 1000000,
      freeMB: 655360,
    }],
  });

  assert.equal(configuration.management, "system-managed");
  assert.equal(configuration.advice.kind, "keep-managed");
  assert.equal(configuration.totalDriveFreeMB, 655360);
  assert.equal(configuration.placement.kind, "keep-current");
  assert.equal(isPageFileConfigurationHealthy(configuration), true);
});

test("flags an observed custom pagefile cap", () => {
  const configuration = assessPageFileConfiguration({
    automaticManaged: false,
    totalRamMB: 16384,
    files: [{
      path: "C:\\pagefile.sys",
      allocatedMB: 4096,
      currentUsageMB: 3900,
      peakUsageMB: 3900,
      initialSizeMB: 2048,
      maximumSizeMB: 4096,
      driveFreeMB: 65536,
    }],
  });

  assert.equal(configuration.management, "custom");
  assert.equal(configuration.advice.kind, "custom-cap");
  assert.equal(isPageFileConfigurationHealthy(configuration), false);
});

test("flags a missing pagefile", () => {
  const configuration = assessPageFileConfiguration({ automaticManaged: false, totalRamMB: 16384, files: [] });
  assert.equal(configuration.management, "none");
  assert.equal(configuration.advice.kind, "missing");
});

test("recommends moving a pagefile from an HDD to eligible NVMe storage", () => {
  const configuration = assessPageFileConfiguration({
    automaticManaged: false,
    totalRamMB: 32768,
    files: [{
      path: "D:\\pagefile.sys",
      allocatedMB: 8704,
      currentUsageMB: 0,
      peakUsageMB: 0,
      initialSizeMB: 0,
      maximumSizeMB: 0,
      driveFreeMB: 655360,
    }],
    volumes: [
      { drive: "D:", diskName: "Archive HDD", busType: "SATA", mediaType: "HDD", sizeMB: 8000000, freeMB: 655360 },
      { drive: "F:", diskName: "Fast NVMe", busType: "NVMe", mediaType: "SSD", sizeMB: 500000, freeMB: 218000 },
      { drive: "C:", diskName: "System SSD", busType: "SATA", mediaType: "SSD", sizeMB: 500000, freeMB: 12000 },
    ],
  });

  assert.equal(configuration.volumes.find(volume => volume.drive === "D:")?.containsPageFile, true);
  assert.equal(configuration.placement.kind, "move-to-faster-storage");
  assert.deepEqual(configuration.placement.candidateDrives, ["F:"]);
});
