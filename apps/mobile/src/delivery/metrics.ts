import AsyncStorage from "@react-native-async-storage/async-storage";
type Metric =
  | "startupMs"
  | "bufferingMs"
  | "playbackFailures"
  | "downloadFailures"
  | "downloadedBytes"
  | "playedSeconds";
let pending = Promise.resolve();
// Aggregate operational counters only: no speech, transcripts, story/choice history or identifiers.
export function metric(name: Metric, value: number) {
  if (!Number.isFinite(value) || value < 0) return;
  pending = pending
    .catch(() => {})
    .then(async () => {
      const raw = await AsyncStorage.getItem("@story/metrics");
      const counters = JSON.parse(raw ?? "{}");
      const previous = counters[name] ?? { count: 0, total: 0, max: 0 };
      counters[name] = {
        count: previous.count + 1,
        total: previous.total + value,
        max: Math.max(previous.max, value),
      };
      await AsyncStorage.setItem("@story/metrics", JSON.stringify(counters));
    });
}
