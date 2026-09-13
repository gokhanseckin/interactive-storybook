import { describe, expect, it } from 'vitest';

import { BASE_AUDIO_INSTRUCTIONS, buildAudioInstructions } from './prompts.js';

describe('audio instructions', () => {
  it('keeps the shared contract and adds only the current segment context', () => {
    const instructions = buildAudioInstructions('narrator', 'Warm and unhurried.');

    expect(instructions).toContain(BASE_AUDIO_INSTRUCTIONS);
    expect(instructions).toContain('Current speaker: narrator.');
    expect(instructions).toContain('Segment direction: Warm and unhurried.');
  });
});
