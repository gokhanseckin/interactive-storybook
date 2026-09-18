import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
const mocks = vi.hoisted(() => ({
  root: vi.fn(),
  files: new Map<string, Uint8Array>(),
  free: vi.fn(),
  ticket: vi.fn(),
  recover: vi.fn(),
  pause: vi.fn(),
  forget: vi.fn(),
  enqueue: vi.fn(),
  playbackUrl: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));
vi.mock("react-native", () => ({ AppState: {} }));
vi.mock("expo-network", () => ({}));
vi.mock("expo-file-system/legacy", () => ({
  getFreeDiskStorageAsync: mocks.free,
  getInfoAsync: async (path: string) => ({
    exists: mocks.files.has(path),
    size: mocks.files.get(path)?.length,
  }),
  deleteAsync: async (path: string) => {
    mocks.files.delete(path);
  },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(private path: string) {}
    open() {
      let offset = 0;
      return {
        readBytes: (n: number) => {
          const b = mocks.files.get(this.path)!.slice(offset, offset + n);
          offset += b.length;
          return b;
        },
        close() {},
      };
    }
  },
}));
vi.mock("../../modules/story-storage", () => ({
  default: {
    root: mocks.root,
    recover: mocks.recover,
    pause: mocks.pause,
    forget: mocks.forget,
    enqueue: mocks.enqueue,
    playbackUrl: mocks.playbackUrl,
  },
}));
vi.mock("./client", () => ({ delivery: mocks.ticket }));
import { downloads, sharedPlayback, sharedPlaybackEnabled } from "./native";
import type { Asset, Manifest } from "@story/contracts";
const bytes = new Uint8Array([1, 2, 3, 4]);
const id = bytesToHex(sha256(bytes));
const asset: Asset = {
  id,
  sha256: id,
  bytes: bytes.length,
  duration: 1,
  type: "audio/mpeg",
};
const manifest = {} as Manifest;
const path = `file:///media/${id}.mp3`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.root.mockResolvedValue("file:///media/");
  mocks.recover.mockResolvedValue(null);
  mocks.files.clear();
  mocks.free.mockResolvedValue(1e9);
  mocks.ticket.mockResolvedValue({ url: "https://origin.test/media" });
  mocks.playbackUrl.mockResolvedValue("http://127.0.0.1/capability");
});
describe("shared native preparation", () => {
  it("retries native initialization after a rejected singleton promise", async () => {
    mocks.root.mockRejectedValue(new Error("Temporary native failure"));
    await expect(downloads()).rejects.toThrow("Temporary native failure");
    await expect(downloads()).rejects.toThrow("Temporary native failure");
    expect(mocks.root).toHaveBeenCalledTimes(2);
  });
  it("remains opt-in by default", () => {
    expect(sharedPlaybackEnabled).toBe(false);
  });
  it("adopts a completed file offline even with no spare disk", async () => {
    mocks.files.set(path, bytes);
    mocks.free.mockResolvedValue(0);
    expect(await sharedPlayback(asset, manifest)).toBe(path);
    expect(mocks.ticket).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("removes a same-size corrupt final file before starting its replacement", async () => {
    mocks.files.set(path, new Uint8Array([4, 3, 2, 1]));
    mocks.enqueue.mockImplementationOnce(async () => {
      expect(mocks.files.has(path)).toBe(false);
    });
    expect(await sharedPlayback(asset, manifest)).toBe(
      "http://127.0.0.1/capability",
    );
    expect(mocks.pause).toHaveBeenCalledWith(id);
    expect(mocks.forget).toHaveBeenCalledWith(id);
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id, progressive: true, urgent: true }),
    );
  });
  it("promotes a complete durable prefix without requesting an online ticket", async () => {
    mocks.recover.mockResolvedValue(path);
    mocks.free.mockResolvedValue(0);
    expect(await sharedPlayback(asset, manifest)).toBe(path);
    expect(mocks.ticket).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("starts a missing-file replacement", async () => {
    await sharedPlayback(asset, manifest);
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.ticket).toHaveBeenCalledOnce();
  });
  it("rejects storage pressure before issuing a ticket or starting a writer", async () => {
    mocks.free.mockResolvedValue(0);
    await expect(sharedPlayback(asset, manifest)).rejects.toThrow(
      "Not enough storage",
    );
    expect(mocks.ticket).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
