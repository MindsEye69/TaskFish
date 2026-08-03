import assert from "node:assert/strict";
import test from "node:test";
import watchdog from "../dist/electron-main/watchdogPolicy.js";

const {
  decideWatchdogAction,
  findWatchdogRule,
  normalizeWatchdogSettings,
  shouldRecordWatchdogTrainingObservation,
  watchdogRuleKey,
} = watchdog;

test("WatchDog suspends only unknown processes in Guard mode", () => {
  const settings = normalizeWatchdogSettings({ mode: "guard", rules: [] });

  assert.equal(decideWatchdogAction({ mode: settings.mode, name: "new-tool.exe", trust: "unknown", settings }), "suspend");
  assert.equal(decideWatchdogAction({ mode: settings.mode, name: "explorer.exe", trust: "unknown", settings }), "ignore");
  assert.equal(decideWatchdogAction({ mode: settings.mode, name: "openconsole.exe", trust: "unknown", settings }), "ignore");
  assert.equal(decideWatchdogAction({ mode: settings.mode, name: "csc.exe", trust: "unknown", settings }), "ignore");
  assert.equal(decideWatchdogAction({ mode: settings.mode, name: "chrome.exe", trust: "verified", settings }), "ignore");
});

test("WatchDog uses executable paths for allow and block rules", () => {
  const approvedPath = "C:\\Tools\\approved.exe";
  const blockedPath = "C:\\Temp\\blocked.exe";
  const settings = normalizeWatchdogSettings({
    mode: "guard",
    rules: [
      { name: "approved.exe", executablePath: approvedPath, action: "allow", updatedAt: 1 },
      { name: "blocked.exe", executablePath: blockedPath, action: "block", updatedAt: 2 },
    ],
  });

  assert.equal(findWatchdogRule(settings, "approved.exe", approvedPath)?.key, watchdogRuleKey("approved.exe", approvedPath));
  assert.equal(decideWatchdogAction({ mode: "guard", name: "approved.exe", trust: "unknown", executablePath: approvedPath, settings }), "ignore");
  assert.equal(decideWatchdogAction({ mode: "guard", name: "blocked.exe", trust: "unknown", executablePath: blockedPath, settings }), "block");
  assert.equal(decideWatchdogAction({ mode: "guard", name: "approved.exe", trust: "unknown", executablePath: "C:\\Temp\\approved.exe", settings }), "suspend");
});

test("Training mode audits unknown processes without suspending them", () => {
  const settings = normalizeWatchdogSettings({ mode: "training", rules: [] });
  assert.equal(decideWatchdogAction({ mode: "training", name: "candidate.exe", trust: "unknown", settings }), "notify");
});

test("Training observations are recorded once per executable identity", () => {
  const observed = new Set();
  const firstPath = "C:\\Tools\\candidate.exe";
  const secondPath = "C:\\Other\\candidate.exe";

  assert.equal(shouldRecordWatchdogTrainingObservation(observed, "candidate.exe", firstPath), true);
  observed.add(watchdogRuleKey("candidate.exe", firstPath));
  assert.equal(shouldRecordWatchdogTrainingObservation(observed, "candidate.exe", firstPath), false);
  assert.equal(shouldRecordWatchdogTrainingObservation(observed, "candidate.exe", secondPath), true);
});
