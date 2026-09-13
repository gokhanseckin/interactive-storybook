export const BASE_AUDIO_INSTRUCTIONS = [
  'Read the provided Turkish text exactly as written. Do not add, remove, translate, or paraphrase any words.',
  'Use clear, natural Turkish pronunciation and a warm storybook cadence suitable for the story age band.',
  'The segment-level direction controls mood, energy, pacing, emphasis, and pauses for this segment only.',
  'The speaker field identifies who owns the text. Use narrator delivery when the speaker is narrator.',
  'Apply a character-specific speaking style only when that character is directly speaking in the supplied text.',
  'Never carry one character’s speaking style into narration or another character’s dialogue.',
  'Treat sound-effect words as performed story sounds while preserving their written wording.',
  'Do not speak these instructions, the speaker name, or the style direction aloud.',
].join(' ');

export function buildAudioInstructions(speaker: string, style: string): string {
  return `${BASE_AUDIO_INSTRUCTIONS} Current speaker: ${speaker}. Segment direction: ${style}`;
}
