import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import OpenAI, { toFile } from 'openai';
import { z } from 'zod';

import { resolveChoiceFromTranscript } from './choiceResolver.js';
import { buildAudioInstructions } from './prompts.js';

const TtsRequestSchema = z.object({
  text: z.string().min(1).max(4096),
  speaker: z.string().min(1).max(80),
  style: z.string().min(1).max(500),
  voice: z.string().min(1).default('marin'),
});

const ChoiceCandidatesSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      voiceHints: z.array(z.string().min(1)).min(1),
    }),
  )
  .length(2);

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;
const app = Fastify({ logger: true, bodyLimit: 2_500_000 });

await app.register(multipart, {
  attachFieldsToBody: 'keyValues',
  limits: { files: 1, fileSize: 2_000_000, fields: 2 },
});

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

app.post('/v1/choices/resolve', async (request, reply) => {
  if (!openai) {
    return reply.code(503).send({ code: 'OPENAI_NOT_CONFIGURED' });
  }

  const body = request.body as { audio?: Buffer; options?: string } | undefined;
  if (!body?.audio || !Buffer.isBuffer(body.audio) || typeof body.options !== 'string') {
    return reply.code(400).send({ code: 'INVALID_MULTIPART_REQUEST' });
  }

  let rawCandidates: unknown;
  try {
    rawCandidates = JSON.parse(body.options);
  } catch {
    return reply.code(400).send({ code: 'INVALID_OPTIONS' });
  }

  const candidates = ChoiceCandidatesSchema.safeParse(rawCandidates);
  if (!candidates.success) {
    return reply.code(400).send({ code: 'INVALID_OPTIONS' });
  }

  const transcription = await openai.audio.transcriptions.create({
    file: await toFile(body.audio, 'choice.m4a', { type: 'audio/mp4' }),
    model: 'gpt-4o-mini-transcribe',
    language: 'tr',
    prompt: `Konuşmacı şu iki seçenekten birini söylüyor: ${candidates.data.map(({ label }) => label).join(' / ')}`,
  });
  const optionId = resolveChoiceFromTranscript(transcription.text, candidates.data);

  if (!optionId) {
    return reply
      .header('Cache-Control', 'no-store')
      .code(422)
      .send({ code: 'CHOICE_NOT_RECOGNIZED' });
  }

  return reply.header('Cache-Control', 'no-store').send({ optionId });
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

await app.listen({ port, host });
