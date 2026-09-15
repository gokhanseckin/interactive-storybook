import OpenAI, { toFile } from 'openai';

import { buildAudioInstructions } from './prompts.js';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is required for the live speech check.');
}

const openai = new OpenAI({ apiKey });
const expectedPhrase = 'Rüzgârın sesini dinlemek istiyorum.';

const speech = await openai.audio.speech.create({
  model: 'gpt-4o-mini-tts',
  voice: 'marin',
  input: expectedPhrase,
  instructions: buildAudioInstructions({
    globalDirection: 'Sıcak ve anlaşılır bir Türkçe hikâye anlatımı kullan.',
    speaker: 'narrator',
    speakerProfile: 'Sakin, doğal ve merak uyandıran bir anlatıcı.',
  }),
  response_format: 'mp3',
});

const audio = Buffer.from(await speech.arrayBuffer());
if (audio.length < 1_000) throw new Error('The live TTS response was unexpectedly small.');

const transcription = await openai.audio.transcriptions.create({
  file: await toFile(audio, 'synthetic-choice.mp3', { type: 'audio/mpeg' }),
  model: 'gpt-4o-mini-transcribe',
  language: 'tr',
  prompt: expectedPhrase,
});

if (!transcription.text.trim()) throw new Error('The live transcription was empty.');

console.log(
  JSON.stringify(
    {
      ok: true,
      generatedAudioBytes: audio.length,
      transcription: transcription.text,
    },
    null,
    2,
  ),
);
