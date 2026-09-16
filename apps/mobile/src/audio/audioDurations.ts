import metadata from './hiddenGardenAudio.json';

const durations: Record<string, { durationSeconds: number }> = metadata;

export function getAudioDurationSeconds(segmentId: string): number {
  return durations[segmentId]?.durationSeconds ?? 0;
}
