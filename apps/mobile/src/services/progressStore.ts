import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { PlayerState } from '../domain/playerMachine';

const STORAGE_PREFIX = '@masal-yolu/progress/';

const PlayerStateSchema = z.object({
  storyId: z.string(),
  nodeId: z.string(),
  segmentIndex: z.number().int().nonnegative(),
  trackKind: z.enum([
    'narration',
    'choicePrompt',
    'choiceGuidance',
    'choiceResponse',
  ]),
  mode: z.enum([
    'paused',
    'playing',
    'awaitingChoice',
    'recordingChoice',
    'resolvingChoice',
    'completed',
  ]),
  positionSeconds: z.number().nonnegative(),
  selectedOptionId: z.string().nullable(),
  selectedOptionIds: z.array(z.string()),
  guidancePlayed: z.boolean(),
  message: z.string().nullable(),
});

function storageKey(storyId: string) {
  return `${STORAGE_PREFIX}${storyId}`;
}

export async function loadProgress(storyId: string): Promise<PlayerState | null> {
  const stored = await AsyncStorage.getItem(storageKey(storyId));
  if (!stored) return null;

  const parsed = PlayerStateSchema.safeParse(JSON.parse(stored));
  if (!parsed.success || parsed.data.storyId !== storyId) {
    await AsyncStorage.removeItem(storageKey(storyId));
    return null;
  }

  return parsed.data;
}

export async function saveProgress(state: PlayerState): Promise<void> {
  const safeState: PlayerState = {
    ...state,
    message: null,
    mode:
      state.mode === 'recordingChoice' || state.mode === 'resolvingChoice'
        ? 'awaitingChoice'
        : state.mode,
  };
  await AsyncStorage.setItem(storageKey(state.storyId), JSON.stringify(safeState));
}

export async function clearProgress(storyId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(storyId));
}
