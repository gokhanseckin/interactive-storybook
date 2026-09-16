import { DEFAULT_VOICE_ID, generateSpeech } from './elevenlabs.js';

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required for the live TTS check.');
const { audio } = await generateSpeech({
  text: 'Rüzgârın sesini dinlemek istiyorum.',
  voice: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
}, apiKey);
console.log(JSON.stringify({ ok: true, provider: 'elevenlabs', generatedAudioBytes: audio.length }));
