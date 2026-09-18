import type { AudioSource } from "expo-audio";

/** Pause during preparation; SDK 57 iOS replace requires a non-null source. */
export async function preparePlaybackSource(
  player: { pause(): void; replace(source: AudioSource): void },
  resolve: () => Promise<AudioSource>,
  signal: AbortSignal,
): Promise<boolean> {
  player.pause();
  const audio = await resolve();
  if (signal.aborted) return false;
  if (audio === null) throw new Error("Bu ses henüz hazır değil. Tekrar dene.");
  player.replace(audio);
  return true;
}
