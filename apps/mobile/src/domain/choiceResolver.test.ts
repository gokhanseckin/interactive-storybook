import { describe, expect, it } from 'vitest';

import { normalizeForMatching, resolveChoiceFromTranscripts } from './choiceResolver';

const turkishCandidates = [
  {
    id: 'listen-to-wind',
    label: 'Rüzgârın sesini dinlemek istiyorum.',
    voiceHints: ['rüzgâr', 'rüzgar', 'dinlemek', 'sesi dinle', 'rüzgârı dinleyelim'],
  },
  {
    id: 'inspect-stones',
    label: 'Yerdeki taşları incelemek istiyorum.',
    voiceHints: ['taş', 'taşlar', 'incelemek', 'yere bak', 'taşlara bakalım'],
  },
];

const englishCandidates = [
  {
    id: 'pond',
    label: 'Mila throws the stone into the pond.',
    voiceHints: ['pond', 'water', 'throw it', 'throw it into the water', 'put it in the water'],
  },
  {
    id: 'ground',
    label: 'Mila drops the stone on the ground.',
    voiceHints: ['ground', 'floor', 'drop it', 'leave it there', 'put it on the ground'],
  },
];

describe('local choice resolver', () => {
  it('normalizes Unicode and locale-specific Turkish characters', () => {
    expect(normalizeForMatching('RÜZGÂR, taşları!', 'tr-TR')).toBe('ruzgar taslari');
  });

  it.each([
    [['Rüzgârı dinleyelim.'], 'listen-to-wind'],
    [['Ben taşlara bakmak istiyorum.'], 'inspect-stones'],
    [['anlaşılmadı', 'taşlara bakalım'], 'inspect-stones'],
  ])('maps local Turkish alternatives to %s', (transcripts, expected) => {
    expect(resolveChoiceFromTranscripts(transcripts, turkishCandidates, 'tr-TR')).toBe(expected);
  });

  it('maps a semantic paraphrase when its distinguishing words are authored as hints', () => {
    expect(
      resolveChoiceFromTranscripts(['I throw it to the water'], englishCandidates, 'en-US'),
    ).toBe('pond');
  });

  it.each([
    ['I do not know'],
    ['Mila and the stone'],
    ['put it on the ground or in the water'],
  ])('abstains instead of guessing for “%s”', (transcript) => {
    expect(resolveChoiceFromTranscripts([transcript], englishCandidates, 'en-US')).toBeNull();
  });
});
