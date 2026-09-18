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

it("clearing a migrated release cannot resurrect legacy progress or leave a stale release pointer", async () => {
  const state = {
    ...createInitialPlayerState(sampleStory),
    positionSeconds: 17,
  };
  const context = { releaseId: "bundled-welcome-v1", locale: "tr-TR" };
  await saveProgress(state);
  await saveProgress(state, context);
  await clearProgress(sampleStory.id, context);
  expect(await loadProgress(sampleStory.id, context)).toBeNull();
  expect(await activeSession(sampleStory.id, "tr-TR")).toBeNull();
});
it("does not migrate Turkish legacy positions into a different locale", async () => {
  await saveProgress({
    ...createInitialPlayerState(sampleStory),
    positionSeconds: 17,
  });
  expect(
    await loadProgress(sampleStory.id, {
      releaseId: "bundled-welcome-v1",
      locale: "en-US",
    }),
  ).toBeNull();
  expect(await activeSession(sampleStory.id, "en-US")).toBeNull();
});
it("private preview never replaces a published release session", async () => {
  const state = {
    ...createInitialPlayerState(sampleStory),
    positionSeconds: 17,
  };
  await saveProgress(state, { releaseId: "published", locale: "tr-TR" });
  await saveProgress(state, {
    releaseId: "preview-private-1",
    locale: "tr-TR",
  });
  expect(await activeSession(sampleStory.id, "tr-TR")).toBe("published");
  expect([...memory.keys()].some((k) => k.includes("preview-"))).toBe(false);
});
it("persists only schema-approved state fields, never extra transcripts or recordings", async () => {
  const extended = {
    ...createInitialPlayerState(sampleStory),
    transcript: "private child words",
    recordingUri: "/private/child.wav",
  };
  await saveProgress(extended, { releaseId: "first", locale: "tr-TR" });
  const persisted = [...memory.values()].join("");
  expect(persisted).not.toContain("private child words");
  expect(persisted).not.toContain("child.wav");
});
it("rejects corrupt and dangling active pointers instead of switching to an arbitrary release", async () => {
  const key = `@masal-yolu/progress/active/${sampleStory.id}/tr-TR`;
  memory.set(
    key,
    JSON.stringify({ releaseId: { unsafe: true }, completed: false }),
  );
  expect(await activeSession(sampleStory.id, "tr-TR")).toBeNull();
  memory.set(key, JSON.stringify({ releaseId: "missing", completed: false }));
  expect(await activeSession(sampleStory.id, "tr-TR")).toBeNull();
});
it("serializes delayed progress and completion so an older write cannot revive a completed session", async () => {
  const storage = (await import("@react-native-async-storage/async-storage"))
    .default;
  let release!: () => void;
  const delay = new Promise<void>((r) => {
    release = r;
  });
  vi.mocked(storage.setItem).mockImplementationOnce(async (key, value) => {
    await delay;
    memory.set(key, value);
  });
  const state = {
    ...createInitialPlayerState(sampleStory),
    positionSeconds: 17,
  };
  const c = { releaseId: "first", locale: "tr-TR" };
  const older = saveProgress(state, c);
  const completed = saveProgress({ ...state, mode: "completed" }, c);
  await Promise.resolve();
  release();
  await Promise.all([older, completed]);
  expect((await loadProgress(sampleStory.id, c))?.mode).toBe("completed");
  expect(await activeSession(sampleStory.id, "tr-TR")).toBeNull();
});
it("clearing an older release preserves the currently active release", async () => {
  const state = {
    ...createInitialPlayerState(sampleStory),
    positionSeconds: 17,
  };
  await saveProgress(state, { releaseId: "old", locale: "tr-TR" });
  await saveProgress(state, { releaseId: "new", locale: "tr-TR" });
  await clearProgress(sampleStory.id, { releaseId: "old", locale: "tr-TR" });
  expect(await activeSession(sampleStory.id, "tr-TR")).toBe("new");
});
