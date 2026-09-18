import { it, expect } from "vitest";
import { type Asset, type Manifest } from "@story/contracts";
import { DownloadQueue, emptyInventory } from "../delivery/queue";
import { downloadState } from "./downloadState";
function setup() {
  const audio: Asset = {
    id: "a".repeat(64),
    sha256: "a".repeat(64),
    bytes: 10,
    duration: 1,
    type: "audio/mpeg",
  };
  const art: Asset = {
    ...audio,
    id: "b".repeat(64),
    sha256: "b".repeat(64),
    type: "image/png",
    duration: 0,
  };
  const inventory = emptyInventory();
  inventory.packages.r = {
    manifest: {
      releaseId: "r",
      audio: { clip: audio },
      artwork: [art],
    } as unknown as Manifest,
    pinned: true,
    paused: false,
    lastUsed: 0,
  };
  for (const a of [audio, art])
    inventory.transfers[a.id] = {
      asset: a,
      state: "verified",
      bytes: 10,
      attempts: 0,
      retryAt: 0,
      local: "file:///" + a.id,
    };
  const q = new DownloadQueue(
    {
      save: async () => {},
      exists: async () => false,
      remove: async () => {},
      freeSpace: async () => 1e9,
      download: async () => {
        throw new Error("unused");
      },
    },
    inventory,
  );
  return { q, audio, art };
}
it("never claims a full offline package from streamed bytes or missing artwork", () => {
  const { q, art } = setup();
  q.state.transfers[art.id].state = "downloading";
  expect(downloadState(q, "r")).toMatchObject({
    complete: false,
    label: "İndiriliyor — henüz çevrimdışı hazır değil",
  });
});
it("distinguishes pinned offline copies from complete automatic caches", () => {
  const { q } = setup();
  expect(downloadState(q, "r").label).toBe("İndirildi — çevrimdışı hazır");
  q.state.packages.r.pinned = false;
  expect(downloadState(q, "r").label).toBe(
    "Çevrimdışı önbellekte — kaldırılabilir",
  );
});
it("withdraws offline badge when the existing delivery API discovers a missing file", async () => {
  const { q, audio } = setup();
  await q.local(audio);
  expect(downloadState(q, "r").complete).toBe(false);
  expect(downloadState(q, "r").label).toContain("Wi-Fi bekleniyor");
});
it("shows paused and retry states without claiming offline availability", () => {
  const { q, audio } = setup();
  q.state.transfers[audio.id].state = "failed";
  expect(downloadState(q, "r")).toMatchObject({
    failed: true,
    complete: false,
  });
  q.state.packages.r.paused = true;
  expect(downloadState(q, "r").label).toContain("Duraklatıldı");
});
