import Fastify from 'fastify';
import { DEFAULT_VOICE_ID, generateSpeech, SpeechProviderError, TtsRequestSchema } from './elevenlabs.js';

export function createApp({ apiKey, voice = DEFAULT_VOICE_ID, fetcher = fetch }: {
  apiKey?: string;
  voice?: string;
  fetcher?: typeof fetch;
} = {}) {
  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ ok: true, provider: 'elevenlabs', elevenLabsConfigured: Boolean(apiKey) }));
  app.post('/v1/tts', async (request, reply) => {
    const body = request.body;
    const parsed = TtsRequestSchema.safeParse(
      body && typeof body === 'object' && !Array.isArray(body) ? { voice, ...body } : body,
    );
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_REQUEST' });
    if (!apiKey) return reply.code(503).send({ code: 'ELEVENLABS_NOT_CONFIGURED' });
    try {
      const { audio } = await generateSpeech(parsed.data, apiKey, fetcher);
      return reply.header('Cache-Control', 'no-store').type('audio/mpeg').send(audio);
    } catch (error) {
      // Never return provider bodies or authentication details to clients.
      const status = error instanceof SpeechProviderError ? error.status : undefined;
      request.log.warn({ providerStatus: status }, 'ElevenLabs generation failed');
      return reply.code(status === 429 ? 429 : 502).send({ code: 'TTS_GENERATION_FAILED' });
    }
  });
  return app;
}
