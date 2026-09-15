import { describe, expect, it } from 'vitest';

import { resolveChoiceFromTranscripts } from './choiceResolver';
import { hiddenGardenStory } from './hiddenGardenStory';
import { createInitialPlayerState, reducePlayer } from './playerMachine';

function finishNode(nodeId: string, state: ReturnType<typeof createInitialPlayerState>) {
  let current = state;
  while (current.nodeId === nodeId && current.mode !== 'completed') {
    current = reducePlayer(hiddenGardenStory, current, { type: 'AUDIO_FINISHED' });
  }
  return current;
}

describe('hidden garden vertical slice', () => {
  it('contains one intro, one two-way choice, and one shared passage', () => {
    expect(hiddenGardenStory.language).toBe('tr-TR');
    expect(hiddenGardenStory.ageBand).toBe('8-10');
    expect(
      Object.values(hiddenGardenStory.nodes).filter((node) => node.kind === 'choice'),
    ).toHaveLength(1);

    const choice = hiddenGardenStory.nodes['hidden-path-choice'];
    expect(choice?.kind).toBe('choice');
    if (choice?.kind !== 'choice') throw new Error('Expected the first choice node.');
    expect(choice.options).toHaveLength(2);
    expect(choice.nextNodeId).toBe('road-to-second-choice');

    const ending = hiddenGardenStory.nodes['road-to-second-choice'];
    expect(ending?.kind).toBe('narration');
    if (ending?.kind !== 'narration') throw new Error('Expected the shared passage.');
    expect(ending.nextNodeId).toBeNull();
    expect(ending.segments.at(-1)?.text).toBe('Birini seçin.');

    const allSegments = Object.values(hiddenGardenStory.nodes).flatMap((node) =>
      node.kind === 'narration'
        ? node.segments
        : [
            ...node.promptSegments,
            node.guidanceSegment,
            ...node.options.flatMap((option) => option.responseSegments),
          ],
    );
    expect(new Set(allSegments.map(({ id }) => id)).size).toBe(allSegments.length);
    expect(allSegments.every(({ speaker }) => hiddenGardenStory.voice.speakerProfiles[speaker])).toBe(
      true,
    );
  });

  it.each(['follow-path-now', 'inspect-entrance-first'])(
    'rejoins the shared passage after choosing %s',
    (optionId) => {
      let state = createInitialPlayerState(hiddenGardenStory);
      state = reducePlayer(hiddenGardenStory, state, { type: 'PLAY' });
      state = finishNode('lost-ball-intro', state);
      state = reducePlayer(hiddenGardenStory, state, { type: 'AUDIO_FINISHED' });
      state = reducePlayer(hiddenGardenStory, state, { type: 'SELECT_OPTION', optionId });
      state = finishNode('hidden-path-choice', state);

      expect(state.nodeId).toBe('road-to-second-choice');
      expect(state.selectedOptionIds).toEqual([optionId]);

      state = finishNode('road-to-second-choice', state);
      expect(state.mode).toBe('completed');
    },
  );

  it('matches natural Turkish phrases to either first choice', () => {
    const node = hiddenGardenStory.nodes['hidden-path-choice'];
    if (node?.kind !== 'choice') throw new Error('Expected the first choice node.');

    expect(resolveChoiceFromTranscripts(['Hemen ilerleyelim.'], node.options, 'tr-TR')).toBe(
      'follow-path-now',
    );
    expect(
      resolveChoiceFromTranscripts(['Önce etrafa bakalım.'], node.options, 'tr-TR'),
    ).toBe('inspect-entrance-first');
  });
});
