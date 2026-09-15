import { describe, expect, it } from 'vitest';

import { getAudioDurationSeconds } from '../audio/audioDurations';
import { hiddenGardenStory } from './hiddenGardenStory';
import {
  buildPlaybackSection,
  findPlaybackSectionTarget,
  getPlaybackSectionElapsed,
} from './playbackSection';
import { createInitialPlayerState, reducePlayer } from './playerMachine';

describe('playback section timeline', () => {
  it('has duration metadata for every generated story clip', () => {
    const segments = Object.values(hiddenGardenStory.nodes).flatMap((node) =>
      node.kind === 'narration'
        ? node.segments
        : [
            ...node.promptSegments,
            node.guidanceSegment,
            ...node.options.flatMap((option) => option.responseSegments),
          ],
    );

    expect(segments).toHaveLength(86);
    expect(
      segments.filter(({ id }) => getAudioDurationSeconds(id) <= 0),
    ).toEqual([]);
  });

  it('presents all intro clips as one 3:41 timeline', () => {
    const state = createInitialPlayerState(hiddenGardenStory);
    const section = buildPlaybackSection(
      hiddenGardenStory,
      state,
      getAudioDurationSeconds,
    );

    expect(section?.label).toBe('1. seçime kadar');
    expect(section?.items).toHaveLength(43);
    expect(section?.durationSeconds).toBeCloseTo(221.16, 3);
  });

  it('maps a section time to the matching clip and local offset', () => {
    const state = createInitialPlayerState(hiddenGardenStory);
    const section = buildPlaybackSection(
      hiddenGardenStory,
      state,
      getAudioDurationSeconds,
    );
    if (!section) throw new Error('Expected the intro playback section.');

    const target = findPlaybackSectionTarget(section, 210);

    expect(target?.item.segment.id).not.toBe('intro-01');
    expect(target?.positionSeconds).toBeGreaterThanOrEqual(0);
    expect(target?.positionSeconds).toBeLessThanOrEqual(
      target?.item.durationSeconds ?? 0,
    );
  });

  it('combines the selected response and shared passage up to choice two', () => {
    const initial = createInitialPlayerState(hiddenGardenStory);
    const atChoice = {
      ...initial,
      nodeId: 'hidden-path-choice',
      trackKind: 'choicePrompt' as const,
      mode: 'awaitingChoice' as const,
    };
    const selected = reducePlayer(hiddenGardenStory, atChoice, {
      type: 'SELECT_OPTION',
      optionId: 'follow-path-now',
    });
    const section = buildPlaybackSection(
      hiddenGardenStory,
      selected,
      getAudioDurationSeconds,
    );

    expect(section?.label).toBe('2. seçime kadar');
    expect(section?.items[0]?.segment.id).toBe('choice-01-a-01');
    expect(section?.items.at(-1)?.segment.id).toBe('shared-26');
  });

  it('reports the aggregate elapsed time for the active clip', () => {
    const initial = createInitialPlayerState(hiddenGardenStory);
    const state = { ...initial, segmentIndex: 1, positionSeconds: 2 };
    const section = buildPlaybackSection(
      hiddenGardenStory,
      state,
      getAudioDurationSeconds,
    );
    if (!section) throw new Error('Expected the intro playback section.');

    expect(getPlaybackSectionElapsed(section, state, 2)).toBeCloseTo(11.648, 3);
  });
});
