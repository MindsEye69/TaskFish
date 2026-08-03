import type {
  PageFileConfiguration,
  PageFileEntry,
  PageFileManagement,
  PageFileVolume,
  StoragePerformanceTier,
} from "./types";

interface PageFileProbeEntry {
  path?: unknown;
  allocatedMB?: unknown;
  currentUsageMB?: unknown;
  peakUsageMB?: unknown;
  initialSizeMB?: unknown;
  maximumSizeMB?: unknown;
  driveFreeMB?: unknown;
  temporary?: unknown;
}

interface PageFileProbeVolume {
  drive?: unknown;
  label?: unknown;
  diskNumber?: unknown;
  diskName?: unknown;
  busType?: unknown;
  mediaType?: unknown;
  sizeMB?: unknown;
  freeMB?: unknown;
}

export interface PageFileProbe {
  automaticManaged?: unknown;
  totalRamMB?: unknown;
  files?: unknown;
  volumes?: unknown;
}

function nonNegativeNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function optionalSize(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function normalizeFile(value: unknown): PageFileEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as PageFileProbeEntry;
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  if (!path) return null;
  const driveMatch = path.match(/^([a-z]:)/i);
  return {
    path,
    drive: driveMatch?.[1].toUpperCase(),
    allocatedMB: nonNegativeNumber(raw.allocatedMB),
    currentUsageMB: nonNegativeNumber(raw.currentUsageMB),
    peakUsageMB: nonNegativeNumber(raw.peakUsageMB),
    initialSizeMB: optionalSize(raw.initialSizeMB),
    maximumSizeMB: optionalSize(raw.maximumSizeMB),
    driveFreeMB: optionalSize(raw.driveFreeMB),
    temporary: Boolean(raw.temporary),
  };
}

function getStoragePerformanceTier(busType?: string, mediaType?: string): StoragePerformanceTier {
  const bus = (busType || "").toLowerCase();
  const media = (mediaType || "").toLowerCase();
  if (bus === "nvme") return "nvme";
  if (media === "ssd") return "ssd";
  if (media === "hdd") return "hdd";
  if (bus && bus !== "unknown") return "other";
  return "unknown";
}

function normalizeVolume(value: unknown): PageFileVolume | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as PageFileProbeVolume;
  const drive = typeof raw.drive === "string" ? raw.drive.trim().toUpperCase() : "";
  if (!/^[A-Z]:$/.test(drive)) return null;
  const busType = typeof raw.busType === "string" ? raw.busType.trim() : undefined;
  const mediaType = typeof raw.mediaType === "string" ? raw.mediaType.trim() : undefined;
  return {
    drive,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : undefined,
    diskNumber: optionalSize(raw.diskNumber),
    diskName: typeof raw.diskName === "string" && raw.diskName.trim() ? raw.diskName.trim() : undefined,
    busType,
    mediaType,
    sizeMB: nonNegativeNumber(raw.sizeMB),
    freeMB: nonNegativeNumber(raw.freeMB),
    performanceTier: getStoragePerformanceTier(busType, mediaType),
    containsPageFile: false,
  };
}

function classifyManagement(automaticManaged: boolean, files: PageFileEntry[]): PageFileManagement {
  if (automaticManaged) return "automatic";
  if (files.length === 0) return "none";
  const allSystemManaged = files.every(file =>
    (file.initialSizeMB ?? 0) === 0 && (file.maximumSizeMB ?? 0) === 0,
  );
  return allSystemManaged ? "system-managed" : "custom";
}

export function assessPageFileConfiguration(probe: PageFileProbe): PageFileConfiguration {
  const files = Array.isArray(probe.files)
    ? probe.files.map(normalizeFile).filter((file): file is PageFileEntry => file !== null)
    : [];
  const automaticManaged = probe.automaticManaged === true;
  const totalRamMB = nonNegativeNumber(probe.totalRamMB);
  const pageFileDrives = new Set(files.map(file => file.drive).filter((drive): drive is string => Boolean(drive)));
  const volumes = Array.isArray(probe.volumes)
    ? probe.volumes.map(normalizeVolume).filter((volume): volume is PageFileVolume => volume !== null)
    : [];
  volumes.forEach(volume => { volume.containsPageFile = pageFileDrives.has(volume.drive); });
  const management = classifyManagement(automaticManaged, files);
  const totalAllocatedMB = files.reduce((sum, file) => sum + file.allocatedMB, 0);
  const totalCurrentUsageMB = files.reduce((sum, file) => sum + file.currentUsageMB, 0);
  const totalPeakUsageMB = files.reduce((sum, file) => sum + file.peakUsageMB, 0);
  const uniqueDriveFree = new Map<string, number>();
  files.forEach(file => {
    if (file.drive && file.driveFreeMB !== undefined) uniqueDriveFree.set(file.drive, file.driveFreeMB);
  });
  const totalDriveFreeMB = [...uniqueDriveFree.values()].reduce((sum, freeMB) => sum + freeMB, 0);
  const lowestDriveFreeMB = uniqueDriveFree.size > 0 ? Math.min(...uniqueDriveFree.values()) : undefined;
  const customMaximumMB = files.reduce((sum, file) => sum + (file.maximumSizeMB ?? 0), 0);
  const managedMode = management === "automatic" || management === "system-managed";
  const minimumFreeSpaceMB = Math.max(4096, Math.round(totalRamMB * 0.25));
  const nearCustomCap = management === "custom"
    && customMaximumMB > 0
    && totalPeakUsageMB >= customMaximumMB * 0.85;

  let advice: PageFileConfiguration["advice"];
  if (management === "none") {
    advice = {
      kind: "missing",
      title: "No active pagefile detected",
      detail: "Enable a system-managed pagefile on a fixed drive with sufficient free space. Without one, Windows has less commit headroom when development tools spike.",
    };
  } else if (lowestDriveFreeMB !== undefined && lowestDriveFreeMB < minimumFreeSpaceMB) {
    advice = {
      kind: "free-space",
      title: "Pagefile drive needs more free space",
      detail: "Keep meaningful free capacity on every pagefile drive so Windows can expand a managed file during memory spikes.",
    };
  } else if (nearCustomCap) {
    advice = {
      kind: "custom-cap",
      title: "Custom pagefile is nearing its configured cap",
      detail: "For changing coding workloads, switch to System managed size or raise the custom limit after confirming the drive has the space.",
    };
  } else if (managedMode) {
    advice = {
      kind: "keep-managed",
      title: management === "automatic" ? "Windows manages pagefiles automatically" : "System-managed size is selected",
      detail: "This is the recommended default. Windows can grow the pagefile as needed; TaskFish will separately warn when commit headroom becomes tight.",
    };
  } else {
    advice = {
      kind: "review",
      title: "Custom pagefile configuration detected",
      detail: "Keep this only when it is intentional. System-managed size is usually safer for variable development workloads because it avoids an arbitrary fixed cap.",
    };
  }

  const requiredFreeMB = Math.max(32768, Math.round(totalRamMB));
  const tierRank: Record<StoragePerformanceTier, number> = { nvme: 3, ssd: 2, hdd: 1, other: 0, unknown: 0 };
  const fastestPageFileTier = Math.max(
    -1,
    ...volumes.filter(volume => volume.containsPageFile).map(volume => tierRank[volume.performanceTier]),
  );
  const fasterCandidates = volumes.filter(volume =>
    !volume.containsPageFile
    && volume.freeMB >= requiredFreeMB
    && tierRank[volume.performanceTier] > fastestPageFileTier,
  );
  const candidateDrives = fasterCandidates.map(volume => volume.drive);
  let placement: PageFileConfiguration["placement"];
  if (pageFileDrives.size === 0) {
    placement = {
      kind: "review-volumes",
      title: "Choose a pagefile drive",
      detail: "Prefer a fixed SSD or NVMe volume with enough free space for Windows to grow a system-managed pagefile.",
      candidateDrives: volumes.filter(volume => volume.freeMB >= requiredFreeMB && tierRank[volume.performanceTier] >= 2).map(volume => volume.drive),
      requiredFreeMB,
    };
  } else if (fasterCandidates.length > 0) {
    const currentDrives = [...pageFileDrives].join(", ");
    placement = {
      kind: "move-to-faster-storage",
      title: "A faster pagefile drive is available",
      detail: `The current pagefile is on ${currentDrives}. Move one System managed pagefile to the fastest suitable NVMe candidate; do not add pagefiles to every drive by default.`,
      candidateDrives,
      requiredFreeMB,
    };
  } else if (fastestPageFileTier >= 2) {
    placement = {
      kind: "keep-current",
      title: "Current pagefile placement is on fast storage",
      detail: "The active pagefile is already on SSD or NVMe storage with sufficient observed capacity. Keep System managed size unless you have workload-specific evidence to change it.",
      candidateDrives: [],
      requiredFreeMB,
    };
  } else {
    placement = {
      kind: "no-eligible-fast-volume",
      title: "No faster volume meets the free-space target",
      detail: "Keep the current system-managed pagefile for now. A faster SSD or NVMe should have at least the displayed free-space target before becoming a candidate.",
      candidateDrives: [],
      requiredFreeMB,
    };
  }

  return {
    management,
    automaticManaged,
    totalRamMB,
    files,
    totalAllocatedMB,
    totalCurrentUsageMB,
    totalPeakUsageMB,
    totalDriveFreeMB,
    advice,
    volumes,
    placement,
  };
}

export function isPageFileConfigurationHealthy(configuration?: PageFileConfiguration): boolean {
  return configuration?.advice.kind === "keep-managed"
    && configuration.placement.kind === "keep-current";
}

export const PAGE_FILE_PROBE_SCRIPT = [
  "$computer = Get-CimInstance Win32_ComputerSystem",
  "$operatingSystem = Get-CimInstance Win32_OperatingSystem",
  "$settings = @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue)",
  "$usage = @(Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue)",
  "$drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3' -ErrorAction SilentlyContinue)",
  "$physicalDisks = @(Get-PhysicalDisk -ErrorAction SilentlyContinue)",
  "$partitions = @(Get-Partition -ErrorAction SilentlyContinue | Where-Object DriveLetter)",
  "$settingsByName = @{}",
  "foreach ($setting in $settings) { $settingsByName[([string]$setting.Name).ToLowerInvariant()] = $setting }",
  "$freeByDrive = @{}",
  "foreach ($drive in $drives) { $freeByDrive[([string]$drive.DeviceID).ToUpperInvariant()] = [int]($drive.FreeSpace / 1MB) }",
  "$physicalByDiskNumber = @{}",
  "foreach ($physicalDisk in $physicalDisks) { $physicalByDiskNumber[[string]$physicalDisk.DeviceId] = $physicalDisk }",
  "$volumes = @(foreach ($partition in $partitions) { $drive = ([string]$partition.DriveLetter).ToUpperInvariant() + ':'; $logicalDrive = $drives | Where-Object DeviceID -eq $drive | Select-Object -First 1; $disk = Get-Disk -Number $partition.DiskNumber -ErrorAction SilentlyContinue; $physicalDisk = $physicalByDiskNumber[[string]$partition.DiskNumber]; [pscustomobject]@{ drive = $drive; label = [string]$logicalDrive.VolumeName; diskNumber = [int]$partition.DiskNumber; diskName = if ($null -ne $disk) { [string]$disk.FriendlyName } else { [string]$physicalDisk.FriendlyName }; busType = if ($null -ne $disk) { [string]$disk.BusType } else { [string]$physicalDisk.BusType }; mediaType = [string]$physicalDisk.MediaType; sizeMB = if ($null -ne $logicalDrive) { [int]($logicalDrive.Size / 1MB) } else { 0 }; freeMB = if ($freeByDrive.ContainsKey($drive)) { $freeByDrive[$drive] } else { 0 } } })",
  "$files = @(foreach ($file in $usage) { $name = [string]$file.Name; $setting = $settingsByName[$name.ToLowerInvariant()]; $drive = if ($name -match '^[A-Za-z]:') { $name.Substring(0, 2).ToUpperInvariant() } else { '' }; [pscustomobject]@{ path = $name; allocatedMB = [int]$file.AllocatedBaseSize; currentUsageMB = [int]$file.CurrentUsage; peakUsageMB = [int]$file.PeakUsage; initialSizeMB = if ($null -ne $setting) { [int]$setting.InitialSize } else { $null }; maximumSizeMB = if ($null -ne $setting) { [int]$setting.MaximumSize } else { $null }; driveFreeMB = if ($freeByDrive.ContainsKey($drive)) { $freeByDrive[$drive] } else { $null }; temporary = [bool]$file.TempPageFile } })",
  "@{ automaticManaged = [bool]$computer.AutomaticManagedPagefile; totalRamMB = [int]($operatingSystem.TotalVisibleMemorySize / 1024); files = $files; volumes = $volumes } | ConvertTo-Json -Depth 5 -Compress",
].join("; ");
