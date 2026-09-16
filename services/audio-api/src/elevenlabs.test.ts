import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { buildSpeechRequest, DEFAULT_VOICE_ID, generateSpeech, TtsRequestSchema } from './elevenlabs.js';

describe('ElevenLabs TTS boundary', () => {
  it('preserves reviewed inline tags and maps the locale', () => {
    expect(buildSpeechRequest({ text: 'Güneş. Ay.', ttsText: 'Güneş. [short pause] Ay.' })).toEqual({
      text: 'Güneş. [short pause] Ay.', language_code: 'tr', model_id: 'eleven_v3', voice_settings: { stability: 0.5 },
    });
    expect(TtsRequestSchema.safeParse({ text: 'Güneş.', ttsText: '[curious] Ay.' }).success).toBe(false);
    expect(TtsRequestSchema.safeParse({ text: 'Güneş.', instructions: 'Read these directions.' }).success).toBe(false);
  });
  it('sends the selected voice and returns audio', async () => {
    const fake = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(2000), { headers: { 'content-type': 'audio/mpeg', 'request-id': 'test' } }));
    const { audio } = await generateSpeech({ text: 'Merhaba.' }, 'test-key', fake);
    expect(audio.length).toBe(2000);
    expect(fake.mock.calls[0]?.[0]).toContain(`/text-to-speech/${DEFAULT_VOICE_ID}?`);
    expect(fake.mock.calls[0]?.[1]?.headers).toMatchObject({ 'xi-api-key': 'test-key' });
  });
  it('does not retry failed requests or expose provider errors', async () => {
    const fake = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret upstream content', { status: 429 }));
    const app = createApp({ apiKey: 'test-key', fetcher: fake });
    const response = await app.inject({ method: 'POST', url: '/v1/tts', payload: { text: 'Merhaba.' } });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ code: 'TTS_GENERATION_FAILED' });
    expect(fake).toHaveBeenCalledTimes(1);
    await app.close();
  });
  it('rejects invalid requests and handles missing configuration without a provider call', async () => {
    const fake = vi.fn<typeof fetch>();
    const app = createApp({ fetcher: fake });
    expect((await app.inject({ method: 'POST', url: '/v1/tts', payload: { text: 'Test', voice: 'marin' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/tts', payload: { text: 'Test' } })).statusCode).toBe(503);
    expect((await app.inject('/health')).json()).toMatchObject({ provider: 'elevenlabs', elevenLabsConfigured: false });
    expect(fake).not.toHaveBeenCalled();
    await app.close();
  });
});
