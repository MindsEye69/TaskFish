import type { ProcessProfile, ProcessProfilesData, RuleConfig } from "./types";

export const MANUAL_PROFILE_ID = "manual";

const limited = (): RuleConfig => ({ action: "LIMITED", autoKillMins: null });

export const DEFAULT_PROFILES: ProcessProfile[] = [
  {
    id: "gaming",
    name: "Gaming",
    description: "Limit launchers, chat, sync, and browser helpers that commonly compete with games.",
    builtIn: true,
    rules: {
      discord: limited(),
      msedge: limited(),
      chrome: limited(),
      onedrive: limited(),
      teams: limited(),
      steamwebhelper: limited(),
      epicgameslauncher: limited(),
      battlenet: limited(),
    },
  },
  {
    id: "work",
    name: "Work",
    description: "Quiet game launchers and entertainment apps while keeping collaboration tools available.",
    builtIn: true,
    rules: {
      discord: limited(),
      steam: limited(),
      steamwebhelper: limited(),
      epicgameslauncher: limited(),
      battlenet: limited(),
      spotify: limited(),
    },
  },
  {
    id: "battery",
    name: "Battery",
    description: "Reduce background helpers, launchers, and sync clients to stretch unplugged runtime.",
    builtIn: true,
    rules: {
      chrome: limited(),
      msedge: limited(),
      discord: limited(),
      teams: limited(),
      onedrive: limited(),
      steamwebhelper: limited(),
      epicgameslauncher: limited(),
      spotify: limited(),
    },
  },
];

export function normalizeRuleKey(name: string) {
  return (name || "").toLowerCase().replace(/\.exe$/i, "");
}

export function normalizeProfileRules(rules: Record<string, RuleConfig> = {}) {
  const normalized: Record<string, RuleConfig> = {};
  for (const [name, rule] of Object.entries(rules)) {
    if (!rule || rule.action === "NONE") continue;
    normalized[normalizeRuleKey(name)] = {
      action: rule.action,
      autoKillMins: rule.autoKillMins ?? null,
      ...(rule.manualControl ? { manualControl: true } : {}),
      ...(rule.overrideTrust ? { overrideTrust: rule.overrideTrust } : {}),
    };
  }
  return normalized;
}

export function createProfileId(name: string) {
  const slug = normalizeRuleKey(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `custom-${slug || "profile"}`;
}

export function ensureProfilesData(raw: unknown): ProcessProfilesData {
  const source = raw && typeof raw === "object" ? raw as Partial<ProcessProfilesData> : {};
  const customProfiles = Array.isArray(source.profiles)
    ? source.profiles
        .filter(profile => profile && typeof profile.id === "string" && !profile.builtIn)
        .map(profile => ({
          id: profile.id,
          name: profile.name || "Custom Profile",
          description: profile.description || "Saved rule set.",
          rules: normalizeProfileRules(profile.rules),
          updatedAt: profile.updatedAt,
        }))
    : [];

  return {
    activeProfileId: source.activeProfileId || MANUAL_PROFILE_ID,
    profiles: [...DEFAULT_PROFILES, ...customProfiles],
  };
}

export function findProfile(data: ProcessProfilesData, profileId: string) {
  return data.profiles.find(profile => profile.id === profileId) ?? null;
}
