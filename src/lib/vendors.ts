import type { TrustLevel, TreeNode } from "./types";

// ---------------------------------------------------------------------------
// Vendor display definition
// ---------------------------------------------------------------------------
interface VendorDef {
  vendor: string;  // canonical display name
  icon:   string;
  color:  string;
  accent: string;  // "r,g,b" for rgba() in CSS
}

export interface VendorGroup {
  vendorId:  string;
  vendor:    string;
  icon:      string;
  color:     string;
  accent:    string;
  processes: TreeNode[];
  totalRam:  number;
  totalCpu:  number;
  trust:     TrustLevel;
}

// ---------------------------------------------------------------------------
// Known company → canonical display name + style
// This handles the legal-name variants that appear in digital certificate CN=
// e.g. "Adobe Inc.", "Adobe Systems Incorporated" → both → "Adobe"
// ---------------------------------------------------------------------------
const COMPANY_CANONICAL: Record<string, string> = {
  // Adobe
  "adobe": "Adobe", "adobe inc": "Adobe", "adobe inc.": "Adobe",
  "adobe systems": "Adobe", "adobe systems incorporated": "Adobe",
  // Microsoft
  "microsoft": "Microsoft", "microsoft corporation": "Microsoft",
  "microsoft windows": "Microsoft",
  // Google
  "google": "Google", "google llc": "Google", "google inc": "Google",
  "google inc.": "Google",
  // NVIDIA
  "nvidia": "NVIDIA", "nvidia corporation": "NVIDIA",
  // Razer
  "razer": "Razer", "razer inc": "Razer", "razer inc.": "Razer",
  // Valve / Steam
  "valve": "Steam", "valve corp": "Steam", "valve corp.": "Steam",
  "valve corporation": "Steam",
  // Meta / Oculus
  "meta": "Meta", "meta platforms": "Meta", "oculus vr": "Meta",
  "oculus": "Meta",
  // Epic Games
  "epic games": "Epic Games", "epic games inc": "Epic Games",
  // Discord
  "discord": "Discord", "discord inc": "Discord",
  // Slack
  "slack": "Slack", "slack technologies": "Slack",
  // Zoom
  "zoom": "Zoom", "zoom video communications": "Zoom",
  // Spotify
  "spotify": "Spotify", "spotify ab": "Spotify",
  // Samsung
  "samsung": "Samsung", "samsung electronics": "Samsung",
  "samsung electronics co., ltd": "Samsung",
  "samsung electronics co., ltd.": "Samsung",
  // AMD
  "amd": "AMD", "advanced micro devices": "AMD",
  "advanced micro devices, inc.": "AMD",
  // Logitech
  "logitech": "Logitech", "logitech inc": "Logitech",
  // Corsair
  "corsair": "Corsair", "corsair memory": "Corsair",
  // ASUS
  "asustek": "ASUS", "asus": "ASUS",
  // SteelSeries
  "steelseries": "SteelSeries",
  // Dropbox
  "dropbox": "Dropbox", "dropbox inc": "Dropbox",
  // OBS
  "obs project": "Streaming / OBS",
  // JetBrains
  "jetbrains": "JetBrains", "jetbrains s.r.o.": "JetBrains",
};

// Style map: canonical name → display properties
const VENDOR_STYLE: Record<string, Omit<VendorDef, "vendor">> = {
  "Adobe":             { icon: "Ai", color: "#FF4422", accent: "255,68,34" },
  "Google":            { icon: "G",  color: "#4285F4", accent: "66,133,244" },
  "NVIDIA":            { icon: "N",  color: "#76B900", accent: "118,185,0" },
  "Microsoft":         { icon: "⊞", color: "#0078D4", accent: "0,120,212" },
  "Razer":             { icon: "⚡", color: "#00D632", accent: "0,214,50" },
  "Steam":             { icon: "S",  color: "#66C0F4", accent: "102,192,244" },
  "Epic Games":        { icon: "E",  color: "#A8A8A8", accent: "140,140,140" },
  "Meta":              { icon: "◈", color: "#0082FB", accent: "0,130,251" },
  "Discord":           { icon: "D",  color: "#5865F2", accent: "88,101,242" },
  "Slack":             { icon: "#",  color: "#9B59B6", accent: "155,89,182" },
  "Zoom":              { icon: "Z",  color: "#2D8CFF", accent: "45,140,255" },
  "Spotify":           { icon: "♪", color: "#1DB954", accent: "29,185,84" },
  "Samsung":           { icon: "S",  color: "#1428A0", accent: "20,40,160" },
  "AMD":               { icon: "A",  color: "#ED1C24", accent: "237,28,36" },
  "Logitech":          { icon: "L",  color: "#00B5E2", accent: "0,181,226" },
  "Corsair":           { icon: "C",  color: "#FFCC00", accent: "255,204,0" },
  "ASUS":              { icon: "A",  color: "#00539C", accent: "0,83,156" },
  "SteelSeries":       { icon: "S",  color: "#FF4500", accent: "255,69,0" },
  "Dropbox":           { icon: "◈", color: "#0061FF", accent: "0,97,255" },
  "Streaming / OBS":   { icon: "●",  color: "#CF1E5D", accent: "207,30,93" },
  "JetBrains":         { icon: "J",  color: "#FF318C", accent: "255,49,140" },
};

// ---------------------------------------------------------------------------
// Name-pattern fallback (for processes not yet audited by background verifier)
// Pattern matching: lower === p  OR  lower.startsWith(p)
// Order matters — first match wins.
// ---------------------------------------------------------------------------
const NAME_PATTERNS: Array<{ processes: string[]; vendor: string }> = [
  { vendor: "Adobe",           processes: ["photoshop", "illustrator", "premiere", "afterfx", "lightroom", "acrord32", "acrobat", "ccxprocess", "creativecloud", "adobe", "coresync", "fcontainer", "fvcontainer", "ngenius", "ngenui"] },
  { vendor: "Google",          processes: ["chrome", "googledrivefs", "googledrivesync", "antigravity", "googlecrashhandler", "googleupdate", "google"] },
  { vendor: "NVIDIA",          processes: ["nvidia", "nvcontainer", "nvdisplay", "nvtelemetry", "nvshare", "nvwmi", "nvspc", "nvoverlay", "nvcpl", "nvtray"] },
  { vendor: "Razer",           processes: ["razer", "razecortex"] },
  { vendor: "Steam",           processes: ["steam", "gameoverlayui"] },
  { vendor: "Epic Games",      processes: ["epicgameslauncher", "eosoverlay", "epicwebhelper", "epicgames"] },
  { vendor: "Meta",            processes: ["ovrserver", "ovrruntime", "ovrclient", "oculusclient", "oculusdash", "oculusxr", "vrserver", "vrdashboard", "vrcompositor"] },
  { vendor: "Discord",         processes: ["discord"] },
  { vendor: "Slack",           processes: ["slack"] },
  { vendor: "Zoom",            processes: ["zoom", "caphost"] },
  { vendor: "Spotify",         processes: ["spotify"] },
  { vendor: "Streaming / OBS", processes: ["obs64", "obs32", "streamlabs"] },
  { vendor: "Samsung",         processes: ["samsungmagician", "samsung"] },
  { vendor: "AMD",             processes: ["amdow", "amdrsserv", "amd"] },
  { vendor: "Logitech",        processes: ["lghub", "logitech", "logioptions"] },
  { vendor: "Microsoft",       processes: ["msedge", "msedgewebview2", "onedrive", "teams", "ms-teams", "winword", "excel", "powerpnt", "onenote", "outlook", "msoasb", "windowsterminal", "gamebar", "gamemanagerservice", "widgetservice"] },
  { vendor: "JetBrains",       processes: ["idea64", "pycharm64", "webstorm64", "rider", "clion", "goland"] },
];

// ---------------------------------------------------------------------------
// Trust rank (worst wins for group level)
// ---------------------------------------------------------------------------
const TRUST_RANK: Record<TrustLevel, number> = {
  unknown: 3, background: 2, verified: 1, trusted: 0,
};

// ---------------------------------------------------------------------------
// Company name normalisation
// Strips legal suffixes, lowercases, then maps to canonical name.
// ---------------------------------------------------------------------------
function stripLegalSuffix(raw: string): string {
  return raw
    .replace(/,?\s*(Incorporated|Corporation|Corp\.|Corp|Inc\.|Inc|LLC|Ltd\.|Ltd|Limited|CO\.,?\s*LTD\.?|GmbH|S\.R\.O\.|S\.A\.|B\.V\.|A\.B\.)\.?\s*$/gi, "")
    .trim();
}

export function normalizeCompany(raw: string): string {
  if (!raw?.trim()) return "";
  const stripped = stripLegalSuffix(raw.trim());
  const key      = stripped.toLowerCase();
  return COMPANY_CANONICAL[key] ?? stripped;  // known → canonical, unknown → stripped
}

// ---------------------------------------------------------------------------
// Extract CN= from a signer subject string
// "CN=Adobe Inc., O=Adobe Inc., L=San Jose, S=California, C=US" → "Adobe Inc."
// ---------------------------------------------------------------------------
export function extractCN(subject: string): string {
  const m = subject.match(/^CN=([^,]+)/);
  return m ? m[1].trim() : subject;
}

// ---------------------------------------------------------------------------
// Get a VendorDef for a canonical company name.
// Known companies use the style map; unknown companies get a deterministic color.
// ---------------------------------------------------------------------------
function hslToRgbStr(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)) * 255);
  };
  return `${f(0)},${f(8)},${f(4)}`;
}

function defForCanonical(canonical: string): VendorDef {
  const style = VENDOR_STYLE[canonical];
  if (style) return { vendor: canonical, ...style };

  // Deterministic hue from name hash
  let hash = 0;
  for (const c of canonical) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue    = hash % 360;
  const accent = hslToRgbStr(hue, 65, 55);
  const color  = `hsl(${hue},65%,55%)`;
  return {
    vendor: canonical,
    icon:   canonical.charAt(0).toUpperCase(),
    color,
    accent,
  };
}

// ---------------------------------------------------------------------------
// Public: look up vendor by name pattern (fallback when no signer data yet)
// ---------------------------------------------------------------------------
function vendorFromNamePattern(processName: string): string | null {
  const lower = processName.toLowerCase().replace(/\.exe$/i, "");
  for (const entry of NAME_PATTERNS) {
    if (entry.processes.some((p) => lower === p || lower.startsWith(p))) {
      return entry.vendor;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: buildVendorGroups
// Primary:  group by node.vendor (company from digital signature, set by main.ts)
// Fallback: group by name pattern for processes not yet audited
// ---------------------------------------------------------------------------
export function buildVendorGroups(nodes: TreeNode[]): {
  vendors:   VendorGroup[];
  ungrouped: TreeNode[];
} {
  const vendorMap = new Map<string, VendorGroup>();
  const ungrouped: TreeNode[] = [];

  for (const node of nodes) {
    // ── 1. Primary: digital signature company ─────────────────────────────
    let canonical: string | null = null;
    if (node.vendor?.trim()) {
      canonical = normalizeCompany(node.vendor);
      if (!canonical) canonical = null;
    }

    // ── 2. Fallback: name pattern ──────────────────────────────────────────
    if (!canonical) {
      canonical = vendorFromNamePattern(node.name);
    }

    // ── 3. No match → ungrouped individual card ───────────────────────────
    if (!canonical) {
      ungrouped.push(node);
      continue;
    }

    // ── 4. Accumulate into vendor group ───────────────────────────────────
    if (!vendorMap.has(canonical)) {
      const def = defForCanonical(canonical);
      vendorMap.set(canonical, {
        vendorId:  canonical,
        vendor:    def.vendor,
        icon:      def.icon,
        color:     def.color,
        accent:    def.accent,
        processes: [],
        totalRam:  0,
        totalCpu:  0,
        trust:     node.trust,
      });
    }

    const group = vendorMap.get(canonical)!;
    group.processes.push(node);
    group.totalRam += node.ramMB;
    group.totalCpu += node.cpu;

    // Worst trust wins (unknown > background > verified > trusted)
    if (TRUST_RANK[node.trust] > TRUST_RANK[group.trust]) {
      group.trust = node.trust;
    }
  }

  const vendors = [...vendorMap.values()]
    .map((g) => ({
      ...g,
      totalRam: Math.round(g.totalRam * 10) / 10,
      totalCpu: Math.round(g.totalCpu * 10) / 10,
    }))
    // Sort: worst trust first, then by RAM descending
    .sort((a, b) => {
      const t = TRUST_RANK[b.trust] - TRUST_RANK[a.trust];
      return t !== 0 ? t : b.totalRam - a.totalRam;
    });

  return { vendors, ungrouped };
}
