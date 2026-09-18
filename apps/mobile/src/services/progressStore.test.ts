import { beforeEach, it, expect, vi } from "vitest";
const memory = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => memory.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      memory.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      memory.delete(k);
    }),
  },
}));
import {
  loadProgress,
  saveProgress,
  activeSession,
  clearProgress,
} from "./progressStore";
import { createInitialPlayerState } from "../domain/playerMachine";
import { sampleStory } from "../domain/sampleStory";
beforeEach(() => memory.clear());
it("migrates only an explicit known bundled release", async () => {
  const state = createInitialPlayerState(sampleStory);
  await saveProgress(state);
  expect(
    await loadProgress(sampleStory.id, {
      releaseId: "bundled-welcome-v1",
      locale: "tr-TR",
    }),
  ).toEqual(state);
  expect(
    await loadProgress(sampleStory.id, {
      releaseId: "new-release",
      locale: "tr-TR",
    }),
  ).toBeNull();
  expect(await activeSession(sampleStory.id, "tr-TR")).toBe(
    "bundled-welcome-v1",
  );
});
it("pins an unfinished session and isolates locale and release positions", async () => {
  const state = {
    ...createInitialPlayerState(sampleStory),
    positionSeconds: 17,
  };
  const c = { releaseId: "first", locale: "tr-TR" };
  await saveProgress(state, c);
  expect(await activeSession(sampleStory.id, "tr-TR")).toBe("first");
  expect(
    await loadProgress(sampleStory.id, { ...c, releaseId: "second" }),
  ).toBeNull();
  expect(
    await loadProgress(sampleStory.id, { ...c, locale: "en-US" }),
  ).toBeNull();
  await saveProgress({ ...state, mode: "completed" }, c);
  expect(await activeSession(sampleStory.id, "tr-TR")).toBeNull();
});
it("never persists transient speech messages and tolerates corrupt JSON", async () => {
  const c = { releaseId: "first", locale: "tr-TR" };
  await saveProgress(
    {
      ...createInitialPlayerState(sampleStory),
      mode: "recordingChoice",
      message: "transient",
    },
    c,
  );
  const saved = await loadProgress(sampleStory.id, c);
  expect(saved?.mode).toBe("awaitingChoice");
  expect(saved?.message).toBeNull();
  memory.set("@masal-yolu/progress/broken", "{");
  expect(await loadProgress("broken")).toBeNull();
});
