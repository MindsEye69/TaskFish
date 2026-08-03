import assert from "node:assert/strict";
import test from "node:test";
import policy from "../dist/electron-main/gameModePolicy.js";
import profiles from "../dist/src/lib/profiles.js";

const { prepareGameModeTargets } = policy;
const { DEFAULT_PROFILES } = profiles;

test("Game Mode accepts only unique, non-protected process targets", () => {
  const result = prepareGameModeTargets([
    { pid: 10, name: "chrome.exe" },
    { pid: 10, name: "chrome.exe" },
    { pid: 20, name: "svchost.exe" },
    { pid: -1, name: "discord.exe" },
    { pid: 30, name: "Discord.exe" },
  ]);

  assert.deepEqual(result.accepted, [
    { pid: 10, name: "chrome.exe" },
    { pid: 30, name: "Discord.exe" },
  ]);
  assert.equal(result.skipped, 3);
});

test("Gaming profile tags candidates for a session instead of permanently limiting them", () => {
  const gaming = DEFAULT_PROFILES.find(profile => profile.id === "gaming");

  assert.equal(gaming?.rules.chrome.action, "ALLOW");
  assert.equal(gaming?.rules.chrome.gameMode, true);
  assert.equal(gaming?.rules.discord.action, "ALLOW");
  assert.equal(gaming?.rules.discord.gameMode, true);
});
