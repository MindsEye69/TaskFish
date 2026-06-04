import assert from "node:assert/strict";
import test from "node:test";
import safety from "../dist/electron-main/eventFixSafety.js";

const {
  cleanCommand,
  commandAsInstruction,
  isCopyableTerminalCommand,
  warningForStep,
} = safety;

test("keeps real read-only terminal commands copyable", () => {
  assert.equal(cleanCommand("Get-WinEvent -LogName System -MaxEvents 20"), "Get-WinEvent -LogName System -MaxEvents 20");
  assert.equal(isCopyableTerminalCommand("DISM /Online /Cleanup-Image /ScanHealth"), true);
});

test("preserves commas in valid PowerShell commands", () => {
  assert.equal(
    cleanCommand("Select-Object Name,CPU,WorkingSet"),
    "Select-Object Name,CPU,WorkingSet",
  );
  assert.equal(
    cleanCommand("Get-WinEvent -LogName System | Select-Object TimeCreated,Message"),
    "Get-WinEvent -LogName System | Select-Object TimeCreated,Message",
  );
  assert.equal(
    cleanCommand('Stop-Service -Name "foo","bar"'),
    'Stop-Service -Name "foo","bar"',
  );
  assert.equal(
    cleanCommand("Stop-Service -Name wuauserv"),
    "Stop-Service -Name wuauserv",
  );
});

test("strips prose suffixes after commas but leaves PS commas intact", () => {
  assert.equal(
    cleanCommand("Get-Service -Name wuauserv, then restart"),
    "Get-Service -Name wuauserv",
  );
  assert.equal(
    cleanCommand("Get-WinEvent -LogName System -MaxEvents 50 | Select-Object Id,LevelDisplayName,Message"),
    "Get-WinEvent -LogName System -MaxEvents 50 | Select-Object Id,LevelDisplayName,Message",
  );
});

test("rejects GUI and navigation advice as copyable commands", () => {
  assert.equal(cleanCommand("Open Task Manager and end the app"), undefined);
  assert.equal(cleanCommand("eventvwr"), undefined);
  assert.equal(cleanCommand("Start-Process eventvwr"), undefined);
  assert.match(commandAsInstruction("Open Windows Update and click Retry"), /Open Windows Update/);
});

test("rejects mixed command blocks when any line is GUI advice", () => {
  assert.equal(cleanCommand("Get-WinEvent -LogName System -MaxEvents 20\nOpen Event Viewer"), undefined);
});

test("keeps warnings for system-modifying repair steps", () => {
  assert.match(
    warningForStep({ instruction: "Restart the service", command: "Restart-Service wuauserv" }),
    /Stopping or restarting/
  );
  assert.match(
    warningForStep({ instruction: "Update registry value", command: "reg add HKLM\\Software\\TaskFish /v X /d Y" }),
    /Back up the registry/
  );
});
