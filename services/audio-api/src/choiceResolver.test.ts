import { describe, expect, it } from 'vitest';

import { normalizeTurkish, resolveChoiceFromTranscript } from './choiceResolver.js';

const candidates = [
  {
    id: 'listen-to-wind',
    label: 'Rüzgârın sesini dinlemek istiyorum.',
    voiceHints: ['rüzgâr', 'rüzgar', 'sesi dinle'],
  },
  {
    id: 'inspect-stones',
    label: 'Yerdeki taşları incelemek istiyorum.',
    voiceHints: ['taş', 'taşlar', 'yere bak'],
  },
];

describe('choice resolver', () => {
  it('normalizes Turkish characters', () => {
    expect(normalizeTurkish('RÜZGÂR, taşları!')).toBe('ruzgar taslari');
  });

  it.each([
    ['Rüzgârı dinleyelim.', 'listen-to-wind'],
    ['Ben taşlara bakmak istiyorum.', 'inspect-stones'],
  ])('maps “%s” to the expected option', (transcript, optionId) => {
    expect(resolveChoiceFromTranscript(transcript, candidates)).toBe(optionId);
  });

  it('does not guess when speech is ambiguous', () => {
    expect(resolveChoiceFromTranscript('Bilmiyorum, ikisi de olabilir.', candidates)).toBeNull();
  });
});
