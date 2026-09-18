import type { AudioSource } from 'expo-audio';

const audioAssets: Record<string, AudioSource> = {
  intro: require('../../assets/audio/intro.wav'),
  choice: require('../../assets/audio/choice.wav'),
  guidance: require('../../assets/audio/guidance.wav'),
  wind: require('../../assets/audio/wind.wav'),
  stones: require('../../assets/audio/stones.wav'),
  ending: require('../../assets/audio/ending.wav'),
};

export function getAudioSource(audioKey: string): AudioSource {
  const source = audioAssets[audioKey];
  if (!source) throw new Error(`No audio asset registered for key: ${audioKey}`);
  return source;
}
