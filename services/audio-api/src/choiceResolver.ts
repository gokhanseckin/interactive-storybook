export type ChoiceCandidate = {
  id: string;
  label: string;
  voiceHints: string[];
};

const stopWords = new Set([
  'bir',
  'bu',
  'da',
  'de',
  'için',
  'ile',
  'istiyorum',
  've',
  'ya',
]);

export function normalizeTurkish(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ğ', 'g')
    .replaceAll('ç', 'c')
    .replaceAll('ö', 'o')
    .replaceAll('ü', 'u')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    normalizeTurkish(value)
      .split(' ')
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function scoreCandidate(transcript: string, candidate: ChoiceCandidate): number {
  const normalizedTranscript = normalizeTurkish(transcript);
  const transcriptTokens = meaningfulTokens(transcript);
  const phrases = [candidate.label, ...candidate.voiceHints].map(normalizeTurkish);
  const exactPhraseScore = phrases.some(
    (phrase) => phrase.length >= 4 && normalizedTranscript.includes(phrase),
  )
    ? 5
    : 0;
  const candidateTokens = meaningfulTokens(phrases.join(' '));
  const tokenMatches = [...candidateTokens].filter((token) => transcriptTokens.has(token)).length;
  return exactPhraseScore + tokenMatches;
}

export function resolveChoiceFromTranscript(
  transcript: string,
  candidates: ChoiceCandidate[],
): string | null {
  const scored = candidates
    .map((candidate) => ({ id: candidate.id, score: scoreCandidate(transcript, candidate) }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < 1 || best.score === runnerUp?.score) return null;
  return best.id;
}
