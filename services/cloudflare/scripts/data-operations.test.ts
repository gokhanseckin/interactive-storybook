import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorySchema, choiceDependencies } from "@story/contracts";
import { inspectMedia } from "../../content-api/src/inspect.ts";
import {
  applyCurrentMigration,
  exportCloudflareLocal,
  exportLegacy,
  openLocalData,
  restoreLocal,
  snapshotD1,
  verifyBundle,
} from "./data-operations-lib.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "story-data-operations-"));
  roots.push(root);
  const legacy = join(root, "legacy");
  const media = join(legacy, "media");
  await mkdir(media, { recursive: true });
  const mp3 = await readFile("services/content-api/fixtures/reminder.mp3");
  const asset = await inspectMedia(mp3, "audio/mpeg");
  await writeFile(join(media, asset.id), mp3);

  const story = StorySchema.parse({
    schemaVersion: 1,
    id: "story-1",
    title: "Portable story",
    language: "tr-TR",
    ageBand: "6-8",
    voice: {
      providerVoice: "voice",
      globalDirection: "Warm",
      speakerProfiles: { narrator: "Warm" },
    },
    episode: { number: 1, title: "Beginning" },
    entryNodeId: "start",
    nodes: {
      start: {
        id: "start",
        kind: "narration",
        segments: [{ id: "intro", speaker: "narrator", text: "Hello." }],
        nextNodeId: null,
      },
    },
  });
  const draft = {
    id: story.id,
    owner: "creator",
    revision: 1,
    story,
    card: {
      title: story.title,
      description: "Ready",
      ageBand: story.ageBand,
      cover: null,
    },
    visibility: "available",
    active: { "tr-TR": "release-1" },
    withdrawn: false,
    clips: { intro: { asset, fingerprint: "fingerprint" } },
    review: { revision: 1, actor: "publisher" },
    preview: { revision: 1, actor: "publisher" },
    state: "ready",
    editors: [],
  };
  const manifest = {
    schemaVersion: 1,
    playerVersion: 1,
    storyId: story.id,
    releaseId: "release-1",
    locale: story.language,
    revision: 1,
    story,
    audio: { intro: asset },
    artwork: [],
    choiceDependencies: choiceDependencies(story),
    createdAt: "2026-09-18T00:00:00.000Z",
  };

  const database = new DatabaseSync(join(legacy, "content.sqlite"));
  database.exec(
    await readFile("services/cloudflare/migrations/0001_platform.sql", "utf8"),
  );
  database
    .prepare("INSERT INTO users VALUES(?,?,?,?)")
    .run(
      "creator",
      "creator@example.test",
      "password-hash",
      JSON.stringify(["creator"]),
    );
  database
    .prepare("INSERT INTO users VALUES(?,?,?,?)")
    .run(
      "publisher",
      "publisher@example.test",
      "password-hash",
      JSON.stringify(["publisher"]),
    );
  database
    .prepare("INSERT INTO stories VALUES(?,?,?,?)")
    .run(story.id, "creator", 1, JSON.stringify(draft));
  const incompleteStory = structuredClone(story);
  incompleteStory.id = "story-incomplete";
  const incompleteDraft = {
    ...structuredClone(draft),
    id: incompleteStory.id,
    story: incompleteStory,
    card: {
      title: incompleteStory.title,
      description: "",
      ageBand: incompleteStory.ageBand,
      cover: null,
    },
    visibility: "hidden",
    active: {},
    clips: {},
    review: null,
    preview: null,
    state: "draft",
  };
  database
    .prepare("INSERT INTO stories VALUES(?,?,?,?)")
    .run(incompleteStory.id, "creator", 1, JSON.stringify(incompleteDraft));
  database
    .prepare("INSERT INTO assets VALUES(?,?,?)")
    .run(asset.id, JSON.stringify(asset), 1);
  database
    .prepare("INSERT INTO releases VALUES(?,?,?)")
    .run(manifest.releaseId, story.id, JSON.stringify(manifest));
  database
    .prepare("INSERT INTO published_releases VALUES(?)")
    .run(manifest.releaseId);
  for (const [id, state, fingerprint, key] of [
    ["job-queued", "queued", "fingerprint-a", "idempotency-a"],
    ["job-running", "running", "fingerprint-b", "idempotency-b"],
  ]) {
    const job = {
      id,
      storyId: story.id,
      segmentId: "intro",
      revision: 1,
      fingerprint,
      input: {},
      provider: "openai",
      state,
      attempts: state === "running" ? 1 : 0,
      providerRequestId: state === "running" ? "provider-request-1" : undefined,
      actor: "creator",
    };
    database
      .prepare("INSERT INTO jobs VALUES(?,?,?,?,?)")
      .run(id, story.id, key, state, JSON.stringify(job));
  }
  database.prepare("INSERT INTO publications VALUES(?,?,?,?,?)").run(
    "publication-1",
    story.id,
    "scheduled",
    1,
    JSON.stringify({
      releaseId: manifest.releaseId,
      actor: "publisher",
      key: "schedule-key",
    }),
  );
  database
    .prepare("INSERT INTO audit VALUES(?,?,?,?,?)")
    .run(
      "audit-1",
      "2026-09-18T00:00:00.000Z",
      "publisher",
      "release.activate",
      manifest.releaseId,
    );
  database
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run("session-secret", "creator", 9999999999999);
  database
    .prepare("INSERT INTO login_attempts VALUES(?,?,?)")
    .run("ip-hash", 2, 9999999999999);
  database.close();
  return { root, legacy, asset };
}

describe("Cloudflare local data operations", () => {
  it("migrates legacy data, restores safely, and can replay a verified local backup", async () => {
    const { root, legacy, asset } = await fixture();
    const legacyBundle = join(root, "legacy-bundle");
    const restored = join(root, "restored");
    await exportLegacy(legacy, legacyBundle);
    const verified = await verifyBundle(legacyBundle);
    expect(verified.manifest.excluded).toEqual({
      sessions: 1,
      loginAttempts: 0,
    });
    expect(verified.manifest.objects.map((object) => object.id)).toEqual([
      asset.id,
    ]);

    const report = await restoreLocal(legacyBundle, restored);
    expect(report).toMatchObject({
      sessionsRevoked: 1,
      heldJobs: 1,
      uncertainJobs: 1,
      heldPublications: 1,
    });
    await expect(restoreLocal(legacyBundle, restored)).rejects.toThrow(
      "Target already exists",
    );

    const local = await openLocalData(restored);
    try {
      const snapshot = await snapshotD1(local.db);
      expect(snapshot.excluded).toEqual({ sessions: 0, loginAttempts: 0 });
      expect(
        snapshot.snapshot.jobs.map((row) => [row.id, row.key, row.state]),
      ).toEqual([
        ["job-queued", "idempotency-a", "held-after-restore"],
        ["job-running", "idempotency-b", "uncertain"],
      ]);
      expect(snapshot.snapshot.publications[0]).toMatchObject({
        id: "publication-1",
        state: "held-after-restore",
      });
      expect(snapshot.snapshot.published_releases).toEqual([
        { id: "release-1" },
      ]);
      const head = await local.bucket.head(asset.id);
      expect(head?.size).toBe(asset.bytes);
      expect(Buffer.from(head!.checksums.sha256!).toString("hex")).toBe(
        asset.sha256,
      );
      await expect(
        local.db
          .prepare("UPDATE releases SET data='{}' WHERE id='release-1'")
          .run(),
      ).rejects.toThrow("immutable release");
    } finally {
      await local.mf.dispose();
    }

    const cloudflareBundle = join(root, "cloudflare-bundle");
    const replayTarget = join(root, "replay-target");
    await exportCloudflareLocal(restored, cloudflareBundle);
    await restoreLocal(cloudflareBundle, replayTarget);
    const replay = await openLocalData(replayTarget);
    try {
      const snapshot = await snapshotD1(replay.db);
      expect(snapshot.snapshot.jobs.map((row) => row.key)).toEqual([
        "idempotency-a",
        "idempotency-b",
      ]);
      expect(snapshot.snapshot.publications[0].state).toBe(
        "held-after-restore",
      );
      expect(snapshot.excluded.sessions).toBe(0);
    } finally {
      await replay.mf.dispose();
    }
  }, 30_000);

  it("rejects incomplete bundles and never creates the requested target", async () => {
    const { root, legacy } = await fixture();
    const bundle = join(root, "bundle");
    const incomplete = join(root, "incomplete");
    const target = join(root, "must-not-exist");
    await exportLegacy(legacy, bundle);
    await cp(bundle, incomplete, { recursive: true });
    await rm(join(incomplete, "COMPLETE"));
    await expect(restoreLocal(incomplete, target)).rejects.toThrow();
    await expect(readFile(join(target, "RESTORE.json"))).rejects.toThrow();
  });

  it("creates an empty isolated local target with the current immutable schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-empty-local-"));
    roots.push(root);
    const persistence = join(root, "state");
    const local = await openLocalData(persistence);
    try {
      await applyCurrentMigration(local.db);
      const snapshot = await snapshotD1(local.db);
      expect(snapshot.snapshot.releases).toEqual([]);
    } finally {
      await local.mf.dispose();
    }
  });
});
