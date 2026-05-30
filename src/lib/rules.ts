import fs from "fs/promises";
import path from "path";
import { RuleConfig, RuleAction } from "./types";

const RULES_PATH = path.join(process.cwd(), "data", "rules.json");

export type RulesData = Record<string, RuleConfig>;

async function ensureDataDir() {
  const dir = path.dirname(RULES_PATH);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function getRules(): Promise<RulesData> {
  try {
    await ensureDataDir();
    const data = await fs.readFile(RULES_PATH, "utf-8");
    const parsed = JSON.parse(data);
    
    // Migrate old string-based rules
    const migrated: RulesData = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        migrated[key] = { action: value as RuleAction, autoKillMins: null };
      } else {
        migrated[key] = value as RuleConfig;
      }
    }
    return migrated;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return {};
    }
    console.error("Failed to read rules:", err);
    return {};
  }
}

function normalizeRuleKey(name: string): string {
  return name.toLowerCase().replace(/\.exe$/i, "");
}

export async function saveRule(name: string, config: RuleConfig): Promise<RulesData> {
  const rules = await getRules();
  const key = normalizeRuleKey(name);
  // Also remove any stale mixed-case variant that may have been saved previously
  if (key !== name) delete rules[name];
  if (config.action === "NONE" && config.autoKillMins === null && !config.manualControl) {
    delete rules[key];
  } else {
    rules[key] = config;
  }
  await fs.writeFile(RULES_PATH, JSON.stringify(rules, null, 2), "utf-8");
  return rules;
}
