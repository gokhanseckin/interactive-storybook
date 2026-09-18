import { it, expect, vi } from "vitest";
import { preparePlaybackSource } from "./preparePlaybackSource";
it("starts a bundled offline asset with a native player that rejects null replacement", async () => {
  const player = {
    pause: vi.fn(),
    replace: vi.fn((audio: unknown) => {
      if (audio === null) throw new Error("iOS AudioSource is non-optional");
    }),
  };
  expect(
    await preparePlaybackSource(
      player,
      async () => 17,
      new AbortController().signal,
    ),
  ).toBe(true);
  expect(player.pause).toHaveBeenCalledOnce();
  expect(player.replace).toHaveBeenCalledExactlyOnceWith(17);
});
it("cannot replace the current clip with a late source after navigation", async () => {
  let resolve!: (value: { uri: string }) => void;
  const source = new Promise<{ uri: string }>((r) => {
    resolve = r;
  });
  const player = { pause: vi.fn(), replace: vi.fn() };
  const abort = new AbortController();
  const preparing = preparePlaybackSource(player, () => source, abort.signal);
  abort.abort();
  resolve({ uri: "file:///old.mp3" });
  expect(await preparing).toBe(false);
  expect(player.replace).not.toHaveBeenCalled();
});
it("turns invalid sources and native replacement exceptions into catchable preparation errors", async () => {
  const player = {
    pause: vi.fn(),
    replace: vi.fn(() => {
      throw new Error("native failure");
    }),
  };
  await expect(
    preparePlaybackSource(
      player,
      async () => null,
      new AbortController().signal,
    ),
  ).rejects.toThrow("hazır");
  expect(player.replace).not.toHaveBeenCalled();
  await expect(
    preparePlaybackSource(
      player,
      async () => ({ uri: "file:///clip.mp3" }),
      new AbortController().signal,
    ),
  ).rejects.toThrow("native failure");
});
