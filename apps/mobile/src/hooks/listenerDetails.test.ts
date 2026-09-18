import { it, expect, vi } from "vitest";
import type { Manifest } from "@story/contracts";
import { listeningManifest } from "./listenerDetails";
const m = { storyId: "story", releaseId: "old", locale: "tr-TR" } as Manifest;
it("loads the pinned release while latest is unavailable offline", async () => {
  const api = {
    activeSession: vi.fn(async () => "old"),
    manifest: vi.fn(async (id) => {
      if (id !== "old") throw new Error("offline");
      return m;
    }),
  };
  expect(await listeningManifest("story", "tr-TR", "new", api)).toBe(m);
  expect(api.manifest).toHaveBeenCalledExactlyOnceWith("old");
});
it("uses latest only after the existing session is completed", async () => {
  const latest = { ...m, releaseId: "new" };
  expect(
    await listeningManifest("story", "tr-TR", "new", {
      activeSession: async () => null,
      manifest: async () => latest,
    }),
  ).toBe(latest);
});
it("does not silently migrate progress when its immutable manifest is unavailable", async () => {
  const api = {
    activeSession: async () => "old",
    manifest: vi.fn(async () => {
      throw new Error("offline");
    }),
  };
  await expect(listeningManifest("story", "tr-TR", "new", api)).rejects.toThrow(
    "offline",
  );
  expect(api.manifest).toHaveBeenCalledExactlyOnceWith("old");
});
it.each([{ storyId: "other" }, { locale: "en-US" }, { releaseId: "new" }])(
  "rejects a mismatched manifest %j",
  async (mismatch) => {
    await expect(
      listeningManifest("story", "tr-TR", "new", {
        activeSession: async () => "old",
        manifest: async () => ({ ...m, ...mismatch }),
      }),
    ).rejects.toThrow("does not match");
  },
);
