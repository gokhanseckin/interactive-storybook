import type { AudioSegment, ChoiceNode, Story } from './storySchema';

export type TrackKind =
  | 'narration'
  | 'choicePrompt'
  | 'choiceGuidance'
  | 'choiceResponse';

export type PlayerMode =
  | 'paused'
  | 'playing'
  | 'awaitingChoice'
  | 'recordingChoice'
  | 'resolvingChoice'
  | 'completed';

export type PlayerState = {
  storyId: string;
  nodeId: string;
  segmentIndex: number;
  trackKind: TrackKind;
  mode: PlayerMode;
  positionSeconds: number;
  selectedOptionId: string | null;
  selectedOptionIds: string[];
  guidancePlayed: boolean;
  message: string | null;
};

export type PlayerEvent =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'PROGRESS'; positionSeconds: number }
  | {
      type: 'SEEK';
      nodeId: string;
      segmentIndex: number;
      trackKind: TrackKind;
      selectedOptionId: string | null;
      positionSeconds: number;
    }
  | { type: 'AUDIO_FINISHED' }
  | { type: 'GUIDANCE_TIMEOUT' }
  | { type: 'START_RECORDING' }
  | { type: 'START_RESOLVING' }
  | { type: 'VOICE_FAILED'; message: string }
  | { type: 'SELECT_OPTION'; optionId: string }
  | { type: 'RESTART' }
  | { type: 'RESTORE'; snapshot: PlayerState };

export function createInitialPlayerState(story: Story): PlayerState {
  return {
    storyId: story.id,
    nodeId: story.entryNodeId,
    segmentIndex: 0,
    trackKind: 'narration',
    mode: 'paused',
    positionSeconds: 0,
    selectedOptionId: null,
    selectedOptionIds: [],
    guidancePlayed: false,
    message: null,
  };
}

export function getChoiceNode(story: Story, state: PlayerState): ChoiceNode | null {
  const node = story.nodes[state.nodeId];
  return node?.kind === 'choice' ? node : null;
}

export function getCurrentSegment(
  story: Story,
  state: PlayerState,
): AudioSegment | null {
  const node = story.nodes[state.nodeId];
  if (!node || state.mode === 'completed') return null;

  if (node.kind === 'narration') {
    return node.segments[state.segmentIndex] ?? null;
  }

  if (state.trackKind === 'choicePrompt') {
    return node.promptSegments[state.segmentIndex] ?? null;
  }

  if (state.trackKind === 'choiceGuidance') {
    return node.guidanceSegment;
  }

  if (state.trackKind === 'choiceResponse' && state.selectedOptionId) {
    const option = node.options.find(({ id }) => id === state.selectedOptionId);
    return option?.responseSegments[state.segmentIndex] ?? null;
  }

  return null;
}

function enterNode(story: Story, nodeId: string): PlayerState {
  const node = story.nodes[nodeId];
  if (!node) throw new Error(`Unknown story node: ${nodeId}`);

  return {
    ...createInitialPlayerState(story),
    nodeId,
    trackKind: node.kind === 'choice' ? 'choicePrompt' : 'narration',
    mode: 'playing',
  };
}

function finishNarration(story: Story, state: PlayerState): PlayerState {
  const node = story.nodes[state.nodeId];
  if (!node || node.kind !== 'narration') return state;

  if (state.segmentIndex + 1 < node.segments.length) {
    return { ...state, segmentIndex: state.segmentIndex + 1, positionSeconds: 0 };
  }

  if (!node.nextNodeId) {
    return { ...state, mode: 'completed', positionSeconds: 0 };
  }

  return {
    ...enterNode(story, node.nextNodeId),
    selectedOptionIds: state.selectedOptionIds,
  };
}

function finishChoiceTrack(story: Story, state: PlayerState): PlayerState {
  const node = getChoiceNode(story, state);
  if (!node) return state;

  if (state.trackKind === 'choicePrompt') {
    if (state.segmentIndex + 1 < node.promptSegments.length) {
      return { ...state, segmentIndex: state.segmentIndex + 1, positionSeconds: 0 };
    }
    return { ...state, mode: 'awaitingChoice', positionSeconds: 0 };
  }

  if (state.trackKind === 'choiceGuidance') {
    return {
      ...state,
      trackKind: 'choicePrompt',
      mode: 'awaitingChoice',
      positionSeconds: 0,
      guidancePlayed: true,
    };
  }

  if (state.trackKind === 'choiceResponse' && state.selectedOptionId) {
    const option = node.options.find(({ id }) => id === state.selectedOptionId);
    if (option && state.segmentIndex + 1 < option.responseSegments.length) {
      return { ...state, segmentIndex: state.segmentIndex + 1, positionSeconds: 0 };
    }

    return {
      ...enterNode(story, node.nextNodeId),
      selectedOptionIds: state.selectedOptionIds,
    };
  }

  return state;
}

export function reducePlayer(
  story: Story,
  state: PlayerState,
  event: PlayerEvent,
): PlayerState {
  switch (event.type) {
    case 'PLAY':
      return state.mode === 'paused' ? { ...state, mode: 'playing', message: null } : state;
    case 'PAUSE':
      return state.mode === 'playing' ? { ...state, mode: 'paused' } : state;
    case 'PROGRESS':
      return { ...state, positionSeconds: Math.max(0, event.positionSeconds) };
    case 'SEEK': {
      const target = {
        ...state,
        nodeId: event.nodeId,
        segmentIndex: event.segmentIndex,
        trackKind: event.trackKind,
        selectedOptionId: event.selectedOptionId,
        positionSeconds: Math.max(0, event.positionSeconds),
        mode: 'paused' as const,
        message: null,
      };
      return getCurrentSegment(story, target) ? target : state;
    }
    case 'AUDIO_FINISHED':
      return state.trackKind === 'narration'
        ? finishNarration(story, state)
        : finishChoiceTrack(story, state);
    case 'GUIDANCE_TIMEOUT':
      return state.mode === 'awaitingChoice' && !state.guidancePlayed
        ? {
            ...state,
            trackKind: 'choiceGuidance',
            mode: 'playing',
            segmentIndex: 0,
            positionSeconds: 0,
          }
        : state;
    case 'START_RECORDING':
      return state.mode === 'awaitingChoice'
        ? { ...state, mode: 'recordingChoice', message: null }
        : state;
    case 'START_RESOLVING':
      return state.mode === 'recordingChoice'
        ? { ...state, mode: 'resolvingChoice' }
        : state;
    case 'VOICE_FAILED':
      return {
        ...state,
        mode: 'awaitingChoice',
        message: event.message,
      };
    case 'SELECT_OPTION': {
      const choice = getChoiceNode(story, state);
      const optionExists = choice?.options.some(({ id }) => id === event.optionId);
      if (!choice || !optionExists) return state;

      return {
        ...state,
        trackKind: 'choiceResponse',
        mode: 'playing',
        segmentIndex: 0,
        positionSeconds: 0,
        selectedOptionId: event.optionId,
        selectedOptionIds: [...state.selectedOptionIds, event.optionId],
        message: null,
      };
    }
    case 'RESTART':
      return createInitialPlayerState(story);
    case 'RESTORE':
      return event.snapshot.storyId === story.id
        ? { ...event.snapshot, mode: 'paused', message: null }
        : createInitialPlayerState(story);
  }
}

export function hasMeaningfulProgress(story: Story, state: PlayerState): boolean {
  const initial = createInitialPlayerState(story);
  return (
    state.nodeId !== initial.nodeId ||
    state.segmentIndex !== 0 ||
    state.positionSeconds >= 1 ||
    state.selectedOptionIds.length > 0 ||
    state.mode === 'completed'
  );
}
