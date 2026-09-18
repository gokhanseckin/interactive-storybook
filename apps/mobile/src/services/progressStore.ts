import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import type { PlayerState } from "../domain/playerMachine";

const STORAGE_PREFIX = "@masal-yolu/progress/";

const PlayerStateSchema = z.object({
  storyId: z.string(),
  nodeId: z.string(),
  segmentIndex: z.number().int().nonnegative(),
  trackKind: z.enum([
    "narration",
    "choicePrompt",
    "choiceGuidance",
    "choiceResponse",
  ]),
  mode: z.enum([
    "paused",
    "playing",
    "awaitingChoice",
    "recordingChoice",
    "resolvingChoice",
    "completed",
  ]),
  positionSeconds: z.number().nonnegative(),
  selectedOptionId: z.string().nullable(),
  selectedOptionIds: z.array(z.string()),
  selectedOptionsByChoiceId: z.record(z.string(), z.string()).default({}),
  guidancePlayed: z.boolean(),
  message: z.string().nullable(),
});

export const LEGACY_RELEASES: Record<string, string> = {
  "ruzgari-sakladigi-ucurtma": "bundled-welcome-v1",
  "calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1":
    "bundled-garden-elevenlabs-v1",
};
type ReleaseContext = { releaseId: string; locale: string };
function storageKey(storyId: string, context?: ReleaseContext) {
  return context
    ? `${STORAGE_PREFIX}v2/${storyId}/${context.releaseId}/${context.locale}`
    : `${STORAGE_PREFIX}${storyId}`;
}
export async function activeSession(
  storyId: string,
  locale: string,
): Promise<string | null> {
  const raw = await AsyncStorage.getItem(
    `${STORAGE_PREFIX}active/${storyId}/${locale}`,
  );
  if (!raw && LEGACY_RELEASES[storyId]) {
    const legacy = await loadProgress(storyId);
    if (legacy && legacy.mode !== "completed") return LEGACY_RELEASES[storyId];
  }
  try {
    const value = JSON.parse(raw ?? "null");
    return value?.completed ? null : (value?.releaseId ?? null);
  } catch {
    return null;
  }
}

export async function loadProgress(
  storyId: string,
  context?: ReleaseContext,
): Promise<PlayerState | null> {
  let stored = await AsyncStorage.getItem(storageKey(storyId, context));
  if (!stored && context && LEGACY_RELEASES[storyId] === context.releaseId)
    stored = await AsyncStorage.getItem(storageKey(storyId));
  if (!stored) return null;

  let data: unknown;
  try {
    data = JSON.parse(stored);
  } catch {
    return null;
  }
  const parsed = PlayerStateSchema.safeParse(data);
  if (!parsed.success || parsed.data.storyId !== storyId) {
    await AsyncStorage.removeItem(storageKey(storyId, context));
    return null;
  }

  return parsed.data;
}

export async function saveProgress(
  state: PlayerState,
  context?: ReleaseContext,
): Promise<void> {
  const safeState: PlayerState = {
    ...state,
    message: null,
    mode:
      state.mode === "recordingChoice" || state.mode === "resolvingChoice"
        ? "awaitingChoice"
        : state.mode,
  };
  await AsyncStorage.setItem(
    storageKey(state.storyId, context),
    JSON.stringify(safeState),
  );
  if (context)
    await AsyncStorage.setItem(
      `${STORAGE_PREFIX}active/${state.storyId}/${context.locale}`,
      JSON.stringify({
        releaseId: context.releaseId,
        completed: state.mode === "completed",
      }),
    );
}

export async function clearProgress(
  storyId: string,
  context?: ReleaseContext,
): Promise<void> {
  await AsyncStorage.removeItem(storageKey(storyId, context));
}
