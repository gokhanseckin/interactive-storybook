import { z } from 'zod';

export const DEFAULT_VOICE_ID = 'BwhlzGpUiZ9uHtfvCl1H';
export const MODEL_ID = 'eleven_v3';
export const OUTPUT_FORMAT = 'mp3_44100_128';

// Editorial directions remain separate. Only reviewed inline tags enter ttsText.
export const TtsRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  ttsText: z.string().min(1).max(5000).optional(),
  language: z.string().regex(/^[a-z]{2}(?:-[A-Za-z0-9]{2,8})*$/).default('tr-TR'),
  voice: z.string().regex(/^[A-Za-z0-9]{20}$/).default(DEFAULT_VOICE_ID),
  stability: z.union([z.literal(0), z.literal(0.5), z.literal(1)]).default(0.5),
}).strict().superRefine((value, context) => {
  if (value.ttsText && stripAudioTags(value.ttsText) !== value.text) {
    context.addIssue({ code: 'custom', path: ['ttsText'], message: 'Inline tags must preserve the exact spoken text.' });
  }
});

export function stripAudioTags(text: string): string {
  return text.replace(/\[[^\]\r\n]+\] ?/g, '');
}

export type TtsRequest = z.input<typeof TtsRequestSchema>;

export function buildSpeechRequest(input: TtsRequest) {
  const request = TtsRequestSchema.parse(input);
  return {
    text: request.ttsText ?? request.text,
    model_id: MODEL_ID,
    language_code: request.language.split('-')[0]!,
    voice_settings: { stability: request.stability },
  };
}

export class SpeechProviderError extends Error {
  constructor(public readonly status: number) {
    super(`ElevenLabs speech request failed (${status}).`);
  }
}

export async function generateSpeech(input: TtsRequest, apiKey: string, fetcher: typeof fetch = fetch) {
  const parsed = TtsRequestSchema.parse(input);
  const body = buildSpeechRequest(parsed);
  // No automatic retries: an interrupted request may already have used credits.
  const response = await fetcher(
    `https://api.elevenlabs.io/v1/text-to-speech/${parsed.voice}?output_format=${OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    },
  );
  if (!response.ok) throw new SpeechProviderError(response.status);
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 1000 || !response.headers.get('content-type')?.startsWith('audio/')) {
    throw new Error('ElevenLabs returned an invalid audio response.');
  }
  return { audio, requestId: response.headers.get('request-id'), body };
}
