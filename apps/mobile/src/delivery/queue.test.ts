import { describe, it, expect } from "vitest";
import { DownloadQueue, emptyInventory, type TransferAdapter } from "./queue";
import { type Manifest, type Asset } from "@story/contracts";
const asset = (n: number): Asset => ({
  id: String(n).padStart(64, "0"),
  sha256: String(n).padStart(64, "0"),
  bytes: 1024,
  duration: 1,
  type: "audio/mpeg",
});
function manifest(id: string, values = [1, 2, 3]): Manifest {
  return {
    releaseId: id,
    storyId: "story",
    locale: "tr-TR",
    schemaVersion: 1,
    playerVersion: 1,
    revision: 1,
    createdAt: "2026-09-17",
    story: {} as any,
    audio: Object.fromEntries(values.map((n) => [String(n), asset(n)])),
    artwork: [],
    choiceDependencies: {},
  };
}
function setup() {
  const files = new Set<string>(),
    calls: string[] = [],
    removed: string[] = [];
  let free = 1e9;
  const adapter: TransferAdapter = {
    save: async () => {},
    exists: async (a) => files.has(a.id),
    remove: async (id) => {
      files.delete(id);
      removed.push(id);
    },
    freeSpace: async () => free,
    download: async (a, m, progress, signal) => {
      calls.push(a.id);
      await new Promise((r) => setTimeout(r, 2));
      if (signal.aborted) throw new Error("aborted");
      progress(a.bytes);
      files.add(a.id);
      return "file:///" + a.id;
    },
  };
  return {
    queue: new DownloadQueue(adapter),
    files,
    calls,
    removed,
    setFree: (n: number) => (free = n),
    adapter,
  };
}
const settle = () => new Promise((r) => setTimeout(r, 60));
describe("durable prioritized downloads", () => {
  it("fetches only selected-book dependencies on constrained networks and deduplicates", async () => {
    const { queue, calls } = setup();
    const m = manifest("one");
    queue.select(m, asset(1).id, [asset(2).id]);
    queue.add(m);
    queue.add(manifest("unrelated", [4, 5]));
    await settle();
    expect(calls).toEqual([asset(2).id]);
    expect(queue.complete("one")).toBe(false);
    queue.policy(true);
    await settle();
    expect(calls).toEqual([asset(2).id, asset(3).id]);
    queue.streaming = null;
    await queue.pump();
    await settle();
    expect(queue.complete("one")).toBe(true);
    expect(calls).not.toContain(asset(4).id);
  });
  it("requires all branches and artwork before claiming an offline package", async () => {
    const { queue } = setup();
    const m = manifest("offline");
    m.artwork = [{ ...asset(4), type: "image/png", duration: 0 }];
    queue.add(m, true);
    await settle();
    expect(queue.complete("offline")).toBe(false);
    queue.policy(true);
    await settle();
    expect(queue.complete("offline")).toBe(true);
    expect(queue.progress("offline")).toEqual({ bytes: 4096, total: 4096 });
  });
  it("reconciles corrupt/missing files and interrupted work after restart", async () => {
    const { queue, adapter, files } = setup();
    queue.add(manifest("one"), true);
    queue.policy(true);
    await settle();
    files.delete(asset(2).id);
    const persisted = JSON.parse(JSON.stringify(queue.state));
    persisted.transfers[asset(3).id].state = "downloading";
    const restarted = new DownloadQueue(adapter, persisted);
    await restarted.reconcile();
    expect(restarted.state.transfers[asset(2).id].state).toBe("queued");
    expect(restarted.state.transfers[asset(3).id].state).toBe("queued");
    expect(restarted.complete("one")).toBe(false);
  });
  it("protects pinned and active books, shares assets and preserves an old package during failed updates", async () => {
    const { queue, removed, setFree } = setup();
    queue.add(manifest("old", [1, 2]), true);
    queue.policy(true);
    await settle();
    queue.add(manifest("cached", [2, 3]));
    queue.activeRelease = "cached";
    await queue.pump();
    await settle();
    await expect(queue.remove("cached")).rejects.toThrow("Stop");
    queue.activeRelease = null;
    await queue.remove("cached");
    expect(removed).not.toContain(asset(2).id);
    expect(queue.complete("old")).toBe(true);
    setFree(0);
    queue.add(manifest("new", [1, 4]), true);
    await settle();
    expect(queue.complete("new")).toBe(false);
    expect(queue.complete("old")).toBe(true);
    expect(queue.state.transfers[asset(4).id].error).toContain("storage");
    await queue.clearCache();
    expect(queue.complete("old")).toBe(true);
  });
  it("stops speculative downloads after Wi-Fi changes, preserves urgent dependencies", async () => {
    const { queue, calls } = setup();
    queue.policy(true);
    queue.select(manifest("one"), undefined, [asset(3).id]);
    queue.policy(false);
    await settle();
    expect(queue.state.transfers[asset(3).id].state).toBe("verified");
    expect(queue.complete("one")).toBe(false);
  });
  it("blocks choice readiness until both responses are verified", async () => {
    const { queue } = setup();
    const m = manifest("one");
    queue.select(m, asset(1).id, [asset(2).id, asset(3).id]);
    await queue.ensure(m, [asset(2).id, asset(3).id]);
    expect(await queue.local(asset(2))).toBeTruthy();
    expect(await queue.local(asset(3))).toBeTruthy();
    expect(await queue.local(asset(1))).toBeNull();
  });
});
