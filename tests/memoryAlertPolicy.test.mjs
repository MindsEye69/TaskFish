import assert from "node:assert/strict";
import test from "node:test";
import policy from "../dist/src/lib/memoryAlertPolicy.js";

const {
  INITIAL_MEMORY_ALERT_EPISODE,
  MEMORY_ALERT_SNOOZE_MS,
  advanceMemoryAlertEpisode,
  ignoreMemoryAlertEpisode,
  snoozeMemoryAlertEpisode,
} = policy;

test("Memory Guardian snooze suppresses the current alert for five minutes", () => {
  const now = 1_000_000;
  const first = advanceMemoryAlertEpisode(INITIAL_MEMORY_ALERT_EPISODE, {
    shouldRequireAck: true,
    recovered: false,
    now,
  });
  const snoozed = snoozeMemoryAlertEpisode(first.state, now);

  assert.equal(first.shouldShow, true);
  assert.equal(advanceMemoryAlertEpisode(snoozed, {
    shouldRequireAck: true,
    recovered: false,
    now: now + MEMORY_ALERT_SNOOZE_MS - 1,
  }).shouldShow, false);
  assert.equal(advanceMemoryAlertEpisode(snoozed, {
    shouldRequireAck: true,
    recovered: false,
    now: now + MEMORY_ALERT_SNOOZE_MS,
  }).shouldShow, true);
});

test("Memory Guardian ignore lasts for one episode and re-arms after recovery", () => {
  const first = advanceMemoryAlertEpisode(INITIAL_MEMORY_ALERT_EPISODE, {
    shouldRequireAck: true,
    recovered: false,
    now: 100,
  });
  const ignored = ignoreMemoryAlertEpisode(first.state);

  assert.equal(advanceMemoryAlertEpisode(ignored, {
    shouldRequireAck: true,
    recovered: false,
    now: 200,
  }).shouldShow, false);

  const recovered = advanceMemoryAlertEpisode(ignored, {
    shouldRequireAck: false,
    recovered: true,
    now: 300,
  });
  assert.deepEqual(recovered.state, INITIAL_MEMORY_ALERT_EPISODE);

  assert.equal(advanceMemoryAlertEpisode(recovered.state, {
    shouldRequireAck: true,
    recovered: false,
    now: 400,
  }).shouldShow, true);
});
