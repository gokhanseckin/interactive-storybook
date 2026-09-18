import { describe, expect, it } from 'vitest';

import { sampleStory } from './sampleStory';
import {
  createInitialPlayerState,
  getCurrentSegment,
  reducePlayer,
} from './playerMachine';

describe('story player state machine', () => {
  it('moves from narration to the choice prompt and waits for the listener', () => {
    let state = createInitialPlayerState(sampleStory);
    state = reducePlayer(sampleStory, state, { type: 'PLAY' });
    state = reducePlayer(sampleStory, state, { type: 'AUDIO_FINISHED' });

    expect(state.nodeId).toBe('silver-leaf-choice');
    expect(state.trackKind).toBe('choicePrompt');
    expect(state.mode).toBe('playing');

    state = reducePlayer(sampleStory, state, { type: 'AUDIO_FINISHED' });
    expect(state.mode).toBe('awaitingChoice');
  });

  it('plays guidance once and keeps waiting without auto-selecting', () => {
    let state = createInitialPlayerState(sampleStory);
    state = {
      ...state,
      nodeId: 'silver-leaf-choice',
      trackKind: 'choicePrompt',
      mode: 'awaitingChoice',
    };

    state = reducePlayer(sampleStory, state, { type: 'GUIDANCE_TIMEOUT' });
    expect(state.trackKind).toBe('choiceGuidance');
    expect(state.mode).toBe('playing');

    state = reducePlayer(sampleStory, state, { type: 'AUDIO_FINISHED' });
    expect(state.mode).toBe('awaitingChoice');
    expect(state.guidancePlayed).toBe(true);
    expect(state.selectedOptionId).toBeNull();

    expect(
      reducePlayer(sampleStory, state, { type: 'GUIDANCE_TIMEOUT' }),
    ).toEqual(state);
  });

  it.each([
    ['listen-to-wind', 'wind-response'],
    ['inspect-stones', 'stones-response'],
  ])('plays %s and rejoins the shared path', (optionId, responseSegmentId) => {
    let state = createInitialPlayerState(sampleStory);
    state = {
      ...state,
      nodeId: 'silver-leaf-choice',
      trackKind: 'choicePrompt',
      mode: 'awaitingChoice',
    };
    state = reducePlayer(sampleStory, state, {
      type: 'SELECT_OPTION',
      optionId,
    });

    expect(getCurrentSegment(sampleStory, state)?.id).toBe(responseSegmentId);

    state = reducePlayer(sampleStory, state, { type: 'AUDIO_FINISHED' });
    expect(state.nodeId).toBe('green-door');
    expect(state.trackKind).toBe('narration');
    expect(state.selectedOptionIds).toContain(optionId);
  });

  it('restores progress paused so playback never starts unexpectedly', () => {
    const initial = createInitialPlayerState(sampleStory);
    const restored = reducePlayer(sampleStory, initial, {
      type: 'RESTORE',
      snapshot: { ...initial, mode: 'playing', positionSeconds: 8.25 },
    });

    expect(restored.mode).toBe('paused');
    expect(restored.positionSeconds).toBe(8.25);
  });

  it('seeks to a validated story segment and pauses at the requested position', () => {
    const initial = createInitialPlayerState(sampleStory);
    const sought = reducePlayer(
      sampleStory,
      { ...initial, mode: 'playing' },
      {
        type: 'SEEK',
        nodeId: 'green-door',
        segmentIndex: 0,
        trackKind: 'narration',
        selectedOptionId: null,
        positionSeconds: 4.5,
      },
    );

    expect(sought.nodeId).toBe('green-door');
    expect(sought.mode).toBe('paused');
    expect(sought.positionSeconds).toBe(4.5);
  });
});

it.each(['recordingChoice', 'resolvingChoice'] as const)(
  'tap overrides %s and late speech cannot overwrite it',
  (mode) => {
    const state = {
      ...createInitialPlayerState(sampleStory),
      nodeId: 'silver-leaf-choice',
      trackKind: 'choicePrompt' as const,
      mode,
    };
    const tapped = reducePlayer(sampleStory, state, {
      type: 'SELECT_OPTION',
      optionId: 'inspect-stones',
    });
    expect(tapped.selectedOptionId).toBe('inspect-stones');
    expect(
      reducePlayer(sampleStory, tapped, {
        type: 'SELECT_OPTION',
        optionId: 'listen-to-wind',
      }),
    ).toEqual(tapped);
    expect(
      reducePlayer(sampleStory, tapped, {
        type: 'VOICE_FAILED',
        message: 'late error',
      }),
    ).toEqual(tapped);
  },
);
it('restores a waiting choice with taps ready and rejects a missing saved node', () => {
  const initial = createInitialPlayerState(sampleStory);
  const restored = reducePlayer(sampleStory, initial, {
    type: 'RESTORE',
    snapshot: {
      ...initial,
      nodeId: 'silver-leaf-choice',
      trackKind: 'choicePrompt',
      mode: 'awaitingChoice',
    },
  });
  expect(restored.mode).toBe('awaitingChoice');
  expect(
    reducePlayer(sampleStory, initial, {
      type: 'RESTORE',
      snapshot: { ...initial, nodeId: 'missing' },
    }),
  ).toEqual(initial);
});
it('late speech failures cannot turn narration into a choice', () => {
  const state = createInitialPlayerState(sampleStory);
  expect(
    reducePlayer(sampleStory, state, {
      type: 'VOICE_FAILED',
      message: 'late error',
    }),
  ).toEqual(state);
});
