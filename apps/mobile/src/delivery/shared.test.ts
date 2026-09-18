import { describe, it, expect, vi, beforeEach } from "vitest";
const queue = {
  local: vi.fn(),
  select: vi.fn(),
  ensure: vi.fn(),
  streaming: null,
};
const shared = vi.fn(),
  delivery = vi.fn();
vi.mock("./native", () => ({
  downloads: async () => queue,
  sharedPlaybackEnabled: true,
  sharedPlayback: (...args: unknown[]) => shared(...args),
}));
vi.mock("./client", () => ({
  delivery: (...args: unknown[]) => delivery(...args),
}));
vi.mock("../audio/audioAssets", () => ({ getAudioSource: vi.fn() }));
import { source } from "./source";
import { StorySchema, ManifestSchema } from "@story/contracts";
const story = StorySchema.parse({
  schemaVersion: 1,
  id: "story",
  title: "Story",
  language: "tr-TR",
  ageBand: "6-8",
  voice: {
    providerVoice: "BwhlzGpUiZ9uHtfvCl1H",
    globalDirection: "Warm",
    speakerProfiles: { narrator: "Warm" },
  },
  episode: { number: 1, title: "Start" },
  entryNodeId: "start",
  nodes: {
    start: {
      id: "start",
      kind: "narration",
      segments: [{ id: "intro", speaker: "narrator", text: "Hello" }],
      nextNodeId: null,
    },
  },
});
const asset = {
  id: "a".repeat(64),
  sha256: "a".repeat(64),
  bytes: 1000,
  duration: 1,
  type: "audio/mpeg",
};
const manifest = ManifestSchema.parse({
  schemaVersion: 1,
  playerVersion: 1,
  storyId: "story",
  releaseId: "release",
  locale: "tr-TR",
  revision: 1,
  createdAt: new Date().toISOString(),
  story,
  audio: { intro: asset },
  artwork: [],
  choiceDependencies: {},
});
beforeEach(() => {
  vi.clearAllMocks();
  queue.local.mockResolvedValue(null);
  shared.mockResolvedValue("http://127.0.0.1:1234/capability/asset.mp3");
});
describe("shared native playback", () => {
  it("uses a single durable native transfer for streaming and package downloads", async () => {
    const result = await source(story, "intro", "start", {
      manifest,
      releaseId: "release",
      locale: "tr-TR",
    });
    expect(result).toEqual({
      uri: "http://127.0.0.1:1234/capability/asset.mp3",
    });
    expect(shared).toHaveBeenCalledOnce();
    expect(delivery).not.toHaveBeenCalled();
    expect(queue.select).toHaveBeenLastCalledWith(manifest, undefined, [
      asset.id,
    ]);
  });
  it("reuses a verified local file without issuing a delivery ticket", async () => {
    queue.local.mockResolvedValue("file:///verified.mp3");
    expect(
      await source(story, "intro", "start", {
        manifest,
        releaseId: "release",
        locale: "tr-TR",
      }),
    ).toEqual({ uri: "file:///verified.mp3" });
    expect(shared).not.toHaveBeenCalled();
    expect(delivery).not.toHaveBeenCalled();
  });
  it("does not silently fall back to a duplicate network stream when the shared transfer fails", async () => {
    shared.mockRejectedValue(new Error("Storage full"));
    await expect(
      source(story, "intro", "start", {
        manifest,
        releaseId: "release",
        locale: "tr-TR",
      }),
    ).rejects.toThrow("Storage full");
    expect(delivery).not.toHaveBeenCalled();
  });
});
