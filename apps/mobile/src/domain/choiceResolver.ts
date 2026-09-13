import type { ChoiceOption } from './storySchema';

type ChoiceCandidate = Pick<ChoiceOption, 'id' | 'label' | 'voiceHints'>;

const stopWords = new Set([
  'a',
  'an',
  'and',
  'bir',
  'bu',
  'da',
  'de',
  'i',
  'icin',
  'ile',
  'istiyorum',
  'it',
  'or',
  'the',
  'to',
  've',
  'want',
  'ya',
]);

export function normalizeForMatching(value: string, locale: string): string {
  let lowered: string;
  try {
    lowered = value.toLocaleLowerCase(locale);
  } catch {
    lowered = value.toLowerCase();
  }

  return lowered
    .replaceAll('ı', 'i')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulTokens(value: string, locale: string): string[] {
  return normalizeForMatching(value, locale)
    .split(' ')
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function tokensMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const shorterLength = Math.min(left.length, right.length);
  if (shorterLength < 4) return false;

  const sharedPrefixLength = shorterLength >= 7 ? 5 : 4;
  return left.slice(0, sharedPrefixLength) === right.slice(0, sharedPrefixLength);
}

function includesWholePhrase(transcript: string, phrase: string): boolean {
  return ` ${transcript} `.includes(` ${phrase} `);
}

function scorePhrase(transcript: string, transcriptTokens: string[], phrase: string, locale: string) {
  const normalizedPhrase = normalizeForMatching(phrase, locale);
  if (!normalizedPhrase) return 0;

  const phraseTokens = meaningfulTokens(phrase, locale);
  if (includesWholePhrase(transcript, normalizedPhrase)) return 10 + phraseTokens.length;
  if (phraseTokens.length === 0) return 0;

  const matchedTokens = phraseTokens.filter((phraseToken) =>
    transcriptTokens.some((transcriptToken) => tokensMatch(phraseToken, transcriptToken)),
  ).length;

  return matchedTokens === phraseTokens.length ? 5 + matchedTokens : matchedTokens;
}

function scoreCandidate(transcript: string, candidate: ChoiceCandidate, locale: string): number {
  const normalizedTranscript = normalizeForMatching(transcript, locale);
  const transcriptTokens = meaningfulTokens(transcript, locale);
  return Math.max(
    0,
    ...[candidate.label, ...candidate.voiceHints].map((phrase) =>
      scorePhrase(normalizedTranscript, transcriptTokens, phrase, locale),
    ),
  );
}

export function resolveChoiceFromTranscripts(
  transcripts: string[],
  candidates: ChoiceCandidate[],
  locale: string,
): string | null {
  const usableTranscripts = transcripts.filter((transcript) => transcript.trim().length > 0);
  if (usableTranscripts.length === 0) return null;

  const scored = candidates
    .map((candidate) => ({
      id: candidate.id,
      score: Math.max(
        ...usableTranscripts.map((transcript) => scoreCandidate(transcript, candidate, locale)),
      ),
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < 6) return null;
  if (runnerUp && runnerUp.score >= 6) return null;
  if (runnerUp && best.score - runnerUp.score < 2) return null;
  return best.id;
}
