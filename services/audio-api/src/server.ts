import Fastify from 'fastify';
import OpenAI from 'openai';
import { z } from 'zod';

import { buildAudioInstructions } from './prompts.js';

const TtsRequestSchema = z.object({
  text: z.string().min(1).max(4096),
  speaker: z.string().min(1).max(80),
  style: z.string().min(1).max(500),
  voice: z.string().min(1).default('marin'),
});

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;
const app = Fastify({ logger: true });

app.get('/health', async () => ({
  ok: true,
  openAiConfigured: Boolean(openai),
}));

app.post('/v1/tts', async (request, reply) => {
  if (!openai) {
    return reply.code(503).send({ code: 'OPENAI_NOT_CONFIGURED' });
  }

  const parsed = TtsRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ code: 'INVALID_REQUEST' });
  }

  const speech = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: parsed.data.voice,
    input: parsed.data.text,
    instructions: buildAudioInstructions(parsed.data.speaker, parsed.data.style),
    response_format: 'mp3',
  });

  const audio = Buffer.from(await speech.arrayBuffer());
  return reply
    .header('Cache-Control', 'no-store')
    .header('Content-Type', 'audio/mpeg')
    .send(audio);
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

await app.listen({ port, host });
