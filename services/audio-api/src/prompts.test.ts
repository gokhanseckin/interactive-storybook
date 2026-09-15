import { describe, expect, it } from 'vitest';

import { BASE_AUDIO_INSTRUCTIONS, buildAudioInstructions } from './prompts.js';

describe('audio instructions', () => {
  it('combines global, speaker, and optional segment directions', () => {
    const instructions = buildAudioInstructions({
      globalDirection: 'Sekiz-on yaş grubu için sıcak bir hikâye anlatımı kullan.',
      speaker: 'lara',
      speakerProfile: 'Hızlı, oyuncu ve neşeli.',
      direction: 'Enerjik ol ama bağırma.',
    });

    expect(instructions).toContain(BASE_AUDIO_INSTRUCTIONS);
    expect(instructions).toContain('Konuşmacı: lara.');
    expect(instructions).toContain('Hızlı, oyuncu ve neşeli.');
    expect(instructions).toContain('Enerjik ol ama bağırma.');
  });

  it('does not invent a segment direction when none is supplied', () => {
    const instructions = buildAudioInstructions({
      globalDirection: 'Sıcak bir hikâye anlatımı kullan.',
      speaker: 'narrator',
      speakerProfile: 'Sakin ve anlaşılır.',
    });

    expect(instructions).not.toContain('Bu kayda özgü yönlendirme:');
  });
});
