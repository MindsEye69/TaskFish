import type { TrustLevel, Category } from "./types";

const TRUSTED = new Set([
  // --- Core Windows kernel & session ---
  "system", "registry", "smss", "csrss", "wininit", "winlogon", "services",
  "lsass", "lsaiso", "lsm", "svchost", "fontdrvhost", "dwm", "conhost", "taskhostw",
  "runtimebroker", "sihost", "ctfmon", "audiodg", "spoolsv", "searchindexer",
  "searchhost", "searchprotocolhost", "wudfhost", "dllhost", "msiexec", "werfault",
  "ntoskrnl", "explorer", "userinit", "applicationframehost", "shellexperiencehost",
  "startmenuexperiencehost", "msmpeng", "nissrv", "securityhealthservice",
  "securityhealthhost", "securityhealthsystray",
  "smartscreen", "tiworker", "wmiprvse", "wmiapsrv", "memory compression",
  "taskmgr", "cmd", "powershell", "pwsh", "mmc", "dism", "wlanext",
  "lockapp", "logonui",
  // --- Windows 11 shell / device services ---
  "crossdeviceservice", "widgetservice", "textinputhost", "shellhost", "aggregatorhost",
  "backgroundtaskhost", "gamebar", "gamebarft", "xboxgameoverlay",
  "tabtip", "tabtipauto", "microsoftimeinputhost", "inputapp",
  "windowsterminal", "wt",
  // --- Security & update ---
  "uhssvc", "wbengine", "compattelrunner", "srtasks", "wuauclt",
  "msdtc", "ngen", "ngentask", "dxstat", "pcasvc",
  "camsvc", "ipfsvc", "storagesync", "disktrack",
  // --- WSL / Hyper-V ---
  "wslhost", "wsl", "vmmem", "vmmemwsl", "wslg", "lxss", "p9rdr",
  // --- Network / system services ---
  "wmpnetwk", "wsappx", "wmpnetwk",
  // --- AMD (system-level) ---
  "amdow", "amdow64", "amdrsserv",
]);

const VERIFIED = new Set([
  // --- Browsers ---
  "chrome", "msedge", "msedgewebview2", "firefox", "opera", "brave",
  // --- IDEs / dev tools ---
  "code", "devenv", "rider", "idea64", "pycharm64", "webstorm64", "cursor", "windsurf",
  // --- Gaming ---
  "steam", "steamwebhelper", "steamservice", "gameoverlayui",
  "epicgameslauncher", "eosoverlay", "epicwebhelper",
  "galaxyclient", "battle.net",
  // --- Communication ---
  "discord", "discordptb", "discordcanary",
  "slack", "teams", "ms-teams", "zoom", "caphost", "skype",
  // --- Media ---
  "spotify", "vlc", "mpv", "wmplayer", "obs64", "streamlabs",
  // --- Utilities ---
  "winrar", "7zfm", "notepad++", "notepad",
  // --- NVIDIA ---
  "nvcontainer", "nvdisplay.container", "nvtelemetrycontainer", "nvshare",
  "nvwmi64", "nvvsvc", "nvspcaps64",
  // --- Razer ---
  "razerappengine", "razercentralservice", "razernghub", "razersdk", "razersynapse3",
  "razerhid", "razersynapse",
  // --- Cloud / storage ---
  "onedrive", "dropbox", "googledrivefs", "googledrivesync",
  // --- Adobe ---
  "acrobat", "acrord32", "photoshop", "illustrator", "premiere", "afterfx", "lightroom",
  "creativecloud", "ccxprocess", "adobeupdateservice", "adobedesktop",
  // --- Microsoft Office / Apps ---
  "winword", "excel", "powerpnt", "outlook", "onenote", "msoasb",
  // --- Android / mobile dev ---
  "androidstudio64", "studio64",
  // --- Google tools ---
  "antigravity", "googlecrashhandler", "googleupdate",
  // --- AI ---
  "ollama",
  // --- Source control ---
  "githubdesktop", "git", "node", "python", "java",
]);

export function getTrust(name: string): TrustLevel {
  if (!name) return "unknown";
  const lower = name.toLowerCase().replace(/\.exe$/i, "");
  if (TRUSTED.has(lower)) return "trusted";
  if (VERIFIED.has(lower) || [...VERIFIED].some((v) => lower.startsWith(v))) return "verified";
  if (/^[a-z]{3,12}(svc|host|srv|mgr|agent|service|helper|daemon|worker)$/i.test(lower))
    return "background";
  return "unknown";
}

export function getCategory(trust: TrustLevel): Category {
  if (!trust) return "unknown";
  if (trust === "trusted") return "system";
  if (trust === "verified") return "user";
  if (trust === "background") return "background";
  return "unknown";
}
