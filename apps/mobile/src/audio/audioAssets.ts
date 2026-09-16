import type { AudioSource } from 'expo-audio';

const audioAssets: Record<string, AudioSource> = {
  intro: require('../../assets/audio/intro.wav'),
  choice: require('../../assets/audio/choice.wav'),
  guidance: require('../../assets/audio/guidance.wav'),
  wind: require('../../assets/audio/wind.wav'),
  stones: require('../../assets/audio/stones.wav'),
  ending: require('../../assets/audio/ending.wav'),
  'calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/01-section-one': require('../../assets/audio/calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/01-section-one.mp3'),
  'calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/02-decision-question': require('../../assets/audio/calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/02-decision-question.mp3'),
  'calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/03-option-a': require('../../assets/audio/calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/03-option-a.mp3'),
  'calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/04-option-b': require('../../assets/audio/calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/04-option-b.mp3'),
  'calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/05-section-two': require('../../assets/audio/calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/05-section-two.mp3'),
  'calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/06-optional-reminder': require('../../assets/audio/calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/06-optional-reminder.mp3'),
};

export function getAudioSource(audioKey: string): AudioSource {
  const source = audioAssets[audioKey];
  if (!source) throw new Error(`No audio asset registered for key: ${audioKey}`);
  return source;
}
