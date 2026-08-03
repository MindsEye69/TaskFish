export interface MemoryAlertEpisodeState {
  active: boolean;
  ignored: boolean;
  snoozedUntil: number;
}

export const MEMORY_ALERT_SNOOZE_MS = 5 * 60 * 1000;

export const INITIAL_MEMORY_ALERT_EPISODE: MemoryAlertEpisodeState = {
  active: false,
  ignored: false,
  snoozedUntil: 0,
};

export function advanceMemoryAlertEpisode(
  current: MemoryAlertEpisodeState,
  options: { shouldRequireAck: boolean; recovered: boolean; now: number },
) {
  if (options.recovered) {
    return {
      state: INITIAL_MEMORY_ALERT_EPISODE,
      shouldShow: false,
      began: false,
      recovered: true,
    };
  }

  if (!options.shouldRequireAck) {
    return { state: current, shouldShow: false, began: false, recovered: false };
  }

  const began = !current.active;
  const state = began
    ? { active: true, ignored: false, snoozedUntil: 0 }
    : current;

  return {
    state,
    shouldShow: !state.ignored && options.now >= state.snoozedUntil,
    began,
    recovered: false,
  };
}

export function snoozeMemoryAlertEpisode(current: MemoryAlertEpisodeState, now: number): MemoryAlertEpisodeState {
  return {
    ...current,
    active: true,
    ignored: false,
    snoozedUntil: now + MEMORY_ALERT_SNOOZE_MS,
  };
}

export function ignoreMemoryAlertEpisode(current: MemoryAlertEpisodeState): MemoryAlertEpisodeState {
  return {
    ...current,
    active: true,
    ignored: true,
    snoozedUntil: 0,
  };
}
