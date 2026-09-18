import metadata from './hiddenGardenAudio.json';

const durations: Record<string, { durationSeconds: number }> = {...metadata, ...{"park-intro": {"durationSeconds": 16.20421768707483}, "silver-leaf-prompt": {"durationSeconds": 7.251791383219954}, "silver-leaf-guidance": {"durationSeconds": 5.310975056689342}, "wind-response": {"durationSeconds": 13.892970521541951}, "stones-response": {"durationSeconds": 12.279863945578231}, "green-door-ending": {"durationSeconds": 15.00625850340136}}};

export function getAudioDurationSeconds(segmentId: string): number {
  return durations[segmentId]?.durationSeconds ?? 0;
}
