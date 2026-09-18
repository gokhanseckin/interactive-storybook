import { Buffer } from "node:buffer";
import { beforeAll, afterAll, it, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { Repository } from "./repository.ts";
import { R2Media } from "./media.ts";
import { runGeneration } from "./generation.ts";
import {
  passwordHash,
  tokenHash,
  type Actor,
} from "../../content-api/src/auth.ts";
import { segments, StorySchema } from "@story/contracts";

const creator: Actor = {
  id: "creator",
  email: "creator@test.test",
  roles: ["creator"],
};
const publisher: Actor = {
  id: "publisher",
  email: "publisher@test.test",
  roles: ["publisher"],
};
let mf: Miniflare, repo: Repository, mp3: Buffer;
const fixture = () =>
  StorySchema.parse({
    schemaVersion: 1,
    id: "temporary",
    title: "Cloud story",
    language: "tr-TR",
    ageBand: "6-8",
    voice: {
      providerVoice: "BwhlzGpUiZ9uHtfvCl1H",
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
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "story-test",
          modules: true,
          scriptPath: "services/cloudflare/dist/index.js",
          compatibilityDate: "2026-09-18",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "test" },
          r2Buckets: ["MEDIA"],
          workflows: {
            GENERATION: {
              name: "test-generation",
              className: "NarrationWorkflow",
            },
          },
          bindings: {
            SESSION_SECRET: "test-secret-at-least-32-characters-long",
            ENVIRONMENT: "local",
            ORIGIN: "http://localhost",
            ENABLE_PAID_GENERATION: "false",
          },
        },
      ],
    }),
  );
  const db = await mf.getD1Database("DB"),
    bucket = await mf.getR2Bucket("MEDIA");
  const schema = await readFile(
    "services/cloudflare/migrations/0001_platform.sql",
    "utf8",
  );
  // Split migrations outside trigger bodies, retaining complete SQL trigger statements.
  const statements = schema
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"));
  await db.batch(statements.map((sql) => db.prepare(sql)));
  repo = new Repository(
    db as D1Database,
    new R2Media(bucket as unknown as R2Bucket),
  );
  for (const a of [creator, publisher])
    await db
      .prepare("INSERT INTO users VALUES(?,?,?,?)")
      .bind(
        a.id,
        a.email,
        passwordHash("test-password-long"),
        JSON.stringify(a.roles),
      )
      .run();
  mp3 = await readFile("services/content-api/fixtures/reminder.mp3");
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
async function ready() {
  let d = await repo.create(creator, fixture());
  const asset = await repo.media.put(mp3, "audio/mpeg");
  await repo.recordAsset(asset);
  d = await repo.change(
    creator,
    d.id,
    d.revision,
    "upload",
    (v) => {
      for (const s of segments(v.story))
        v.clips[s.id] = { asset, fingerprint: repo.fingerprint(v.story, s.id) };
      v.card.description = "A complete verified story.";
    },
    true,
  );
  await repo.change(publisher, d.id, d.revision, "review", (v) => {
    v.preview = { revision: v.revision, actor: publisher.id };
    v.review = { revision: v.revision, actor: publisher.id };
    v.state = "ready";
  });
  return repo.candidate(publisher, d.id, d.revision);
}
it("publishes immutable, retained releases with authenticated ranged R2 delivery", async () => {
  const m = await ready();
  expect(
    (await mf.dispatchFetch(`http://localhost/api/releases/${m.releaseId}`))
      .status,
  ).toBe(404);
  await repo.activate(publisher, m.releaseId);
  const manifest = await mf.dispatchFetch(
    `http://localhost/api/releases/${m.releaseId}`,
  );
  expect(manifest.status).toBe(200);
  const asset = Object.values(m.audio)[0];
  const response = await mf.dispatchFetch("http://localhost/api/delivery", {
    method: "POST",
    body: JSON.stringify({ releaseId: m.releaseId, assetId: asset.id }),
  });
  const ticket = (await response.json()) as { url: string };
  const range = await mf.dispatchFetch(ticket.url, {
    headers: { Range: "bytes=10-99" },
  });
  expect(range.status).toBe(206);
  expect(Buffer.from(await range.arrayBuffer())).toEqual(mp3.subarray(10, 100));
  expect(range.headers.get("Content-Length")).toBe("90");
  const head = await mf.dispatchFetch(ticket.url, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("Content-Length")).toBe(String(mp3.length));
  expect(
    (await mf.dispatchFetch(ticket.url, { headers: { Range: "bytes=-0" } }))
      .status,
  ).toBe(416);
  const ifRange = await mf.dispatchFetch(ticket.url, {
    headers: { Range: "bytes=10-99", "If-Range": '"old"' },
  });
  expect(ifRange.status).toBe(200);
  await ifRange.arrayBuffer();
  await expect(
    repo.sql("UPDATE releases SET data=? WHERE id=?", "{}", m.releaseId).run(),
  ).rejects.toThrow("immutable");
  await expect(
    repo.sql("DELETE FROM releases WHERE id=?", m.releaseId).run(),
  ).rejects.toThrow("retain");
  await repo.change(publisher, m.storyId, undefined, "withdraw", (d) => {
    d.withdrawn = true;
  });
  expect((await mf.dispatchFetch(ticket.url)).status).toBe(403);
});
it("rolls back stale writes and their audit entries as a single D1 transaction", async () => {
  const d = await repo.create(creator, fixture());
  await repo.change(
    creator,
    d.id,
    d.revision,
    "edit",
    (v) => {
      v.story.title = "New";
    },
    true,
  );
  const stale = structuredClone(d);
  stale.story.title = "Lost update";
  await expect(
    repo.commit([
      repo.draftGuard(d),
      repo.save(stale),
      repo.audit(creator.id, "must-not-commit", d.id),
    ]),
  ).rejects.toThrow("changed");
  expect((await repo.get(d.id)).story.title).toBe("New");
  expect(
    await repo
      .sql("SELECT id FROM audit WHERE action='must-not-commit'")
      .first(),
  ).toBeNull();
});
it("cancellation and role revocation cannot activate a scheduled release", async () => {
  const m = await ready(),
    id = crypto.randomUUID(),
    data = JSON.stringify({ releaseId: m.releaseId, actor: publisher.id });
  await repo
    .sql(
      "INSERT INTO publications VALUES(?,?,?,?,?)",
      id,
      m.storyId,
      "cancelled",
      0,
      data,
    )
    .run();
  await expect(
    repo.activate(publisher, m.releaseId, { id, data }),
  ).rejects.toThrow("changed");
  expect((await repo.get(m.storyId)).active).toEqual({});
  await repo
    .sql("UPDATE publications SET state='scheduled' WHERE id=?", id)
    .run();
  await repo.sql("UPDATE users SET roles='[]' WHERE id=?", publisher.id).run();
  await repo.publishDue();
  expect(
    (
      await repo
        .sql("SELECT state FROM publications WHERE id=?", id)
        .first<{ state: string }>()
    )?.state,
  ).toBe("failed");
  expect((await repo.get(m.storyId)).active).toEqual({});
  await repo
    .sql(
      "UPDATE users SET roles=? WHERE id=?",
      JSON.stringify(publisher.roles),
      publisher.id,
    )
    .run();
});
it("concurrent authorization and replay do not repeat a paid request", async () => {
  const d = await repo.create(creator, fixture());
  const jobs = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      repo.enqueue(
        creator,
        d.id,
        d.revision,
        "intro",
        "elevenlabs",
        String(i),
        true,
      ),
    ),
  );
  expect(new Set(jobs.map((j) => j.id)).size).toBe(1);
  let calls = 0;
  const generate = async () => {
    calls++;
    return { audio: mp3 };
  };
  await Promise.all(jobs.map((j) => runGeneration(repo, j.id, generate, true)));
  expect(calls).toBe(1);
  expect((await repo.get(d.id)).clips.intro).toBeDefined();
  await runGeneration(repo, jobs[0].id, generate, true);
  expect(calls).toBe(1);
});
it("keeps ambiguous billing fenced and rejects unauthorized or disabled generation", async () => {
  const d = await repo.create(creator, fixture());
  await expect(
    repo.enqueue(creator, d.id, d.revision, "intro", "openai", "denied", false),
  ).rejects.toThrow("authorization");
  const j = await repo.enqueue(
    creator,
    d.id,
    d.revision,
    "intro",
    "openai",
    "one",
    true,
  );
  let calls = 0;
  const generate = async () => {
    calls++;
    throw new Error("lost response");
  };
  expect(await runGeneration(repo, j.id, generate, false)).toBe("disabled");
  expect(calls).toBe(0);
  expect(await runGeneration(repo, j.id, generate, true)).toBe("uncertain");
  await runGeneration(repo, j.id, generate, true);
  expect(calls).toBe(1);
});
it("late generation cannot overwrite edited text or an attached replacement", async () => {
  const d = await repo.create(creator, fixture()),
    j = await repo.enqueue(
      creator,
      d.id,
      d.revision,
      "intro",
      "openai",
      "late",
      true,
    );
  expect(
    await runGeneration(
      repo,
      j.id,
      async () => {
        await repo.change(
          creator,
          d.id,
          d.revision,
          "edit",
          (v) => {
            v.story.title = "New";
            v.story.nodes.start.kind === "narration" &&
              (v.story.nodes.start.segments[0].text = "Changed");
          },
          true,
        );
        return { audio: mp3 };
      },
      true,
    ),
  ).toBe("stale");
  expect((await repo.get(d.id)).clips.intro).toBeUndefined();
});
it("serves Studio API authorization, CSRF, login and fail-closed paid generation", async () => {
  expect((await mf.dispatchFetch("http://localhost/api/stories")).status).toBe(
    401,
  );
  const denied = await mf.dispatchFetch("http://localhost/api/login", {
    method: "POST",
    headers: { Origin: "https://evil.test" },
    body: "{}",
  });
  expect(denied.status).toBe(403);
  const login = await mf.dispatchFetch("http://localhost/api/login", {
    method: "POST",
    body: JSON.stringify({
      email: creator.email,
      password: "test-password-long",
      mobile: true,
    }),
  });
  expect(login.status).toBe(200);
  const b = (await login.json()) as { token: string };
  const cookieOnly = await mf.dispatchFetch("http://localhost/api/logout", {
    method: "POST",
    headers: { Cookie: `studio=${b.token}` },
  });
  expect(cookieOnly.status).toBe(403);
  const d = await repo.create(creator, fixture());
  const response = await mf.dispatchFetch(
    `http://localhost/api/stories/${d.id}/jobs`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${b.token}` },
      body: JSON.stringify({
        revision: 1,
        segmentId: "intro",
        provider: "openai",
        key: "x",
        authorizePaidGeneration: true,
      }),
    },
  );
  expect(response.status).toBe(403);
  const missing = await mf.dispatchFetch("http://localhost/api/not-real");
  expect(missing.status).toBe(404);
});

it("runs the existing Studio authoring contract through the Worker HTTP routes", async () => {
  for (const a of [creator, publisher])
    await repo
      .sql(
        "INSERT OR REPLACE INTO sessions VALUES(?,?,?)",
        tokenHash(a.id + "-session"),
        a.id,
        Date.now() + 60000,
      )
      .run();
  const call = async (
    path: string,
    a: Actor,
    body?: unknown,
    method = "POST",
  ) => {
    const response = await mf.dispatchFetch("http://localhost" + path, {
      method,
      headers: {
        Authorization: `Bearer ${a.id}-session`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result as Record<string, any>;
  };
  let d = await call("/api/stories", creator, { story: fixture() });
  const denied = await mf.dispatchFetch(
    `http://localhost/api/stories/${d.id}/review`,
    {
      method: "POST",
      headers: { Authorization: "Bearer creator-session" },
      body: JSON.stringify({ revision: 1 }),
    },
  );
  expect(denied.status).toBe(403);
  d = await call(
    `/api/stories/${d.id}`,
    creator,
    {
      revision: d.revision,
      card: { ...d.card, description: "Verified through Worker HTTP." },
    },
    "PUT",
  );
  const upload = await mf.dispatchFetch(
    `http://localhost/api/stories/${d.id}/assets?revision=${d.revision}&segmentId=intro`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer creator-session",
        "Content-Type": "audio/mpeg",
      },
      body: mp3,
    },
  );
  d = (await upload.json()) as Record<string, any>;
  expect(upload.status, JSON.stringify(d)).toBe(200);
  const clip = await call(`/api/stories/${d.id}/clip-delivery`, creator, {
    revision: d.revision,
    segmentId: "intro",
  });
  const previewAudio = await mf.dispatchFetch(clip.url);
  expect(previewAudio.status).toBe(200);
  await previewAudio.arrayBuffer();
  await call(`/api/stories/${d.id}/previewed`, publisher, {
    revision: d.revision,
  });
  await call(`/api/stories/${d.id}/review`, publisher, {
    revision: d.revision,
  });
  const release = await call(`/api/stories/${d.id}/releases`, publisher, {
    revision: d.revision,
  });
  await call(`/api/releases/${release.releaseId}/activate`, publisher, {});
  const catalog = await mf.dispatchFetch("http://localhost/api/catalog");
  expect(JSON.stringify(await catalog.json())).toContain(d.id);
});
it("rejects expired URLs and corrupt uploads without changing the active release", async () => {
  const m = await ready();
  await repo.activate(publisher, m.releaseId);
  await expect(
    repo.media.put(mp3.subarray(0, mp3.length - 20), "audio/mpeg"),
  ).rejects.toThrow();
  const asset = Object.values(m.audio)[0];
  const ticket = (await (
    await mf.dispatchFetch("http://localhost/api/delivery", {
      method: "POST",
      body: JSON.stringify({ releaseId: m.releaseId, assetId: asset.id }),
    })
  ).json()) as { url: string };
  const expired = new URL(ticket.url);
  expired.searchParams.set("expires", "0");
  expect((await mf.dispatchFetch(expired)).status).toBe(403);
  expect((await repo.get(m.storyId)).active[m.locale]).toBe(m.releaseId);
});
it("streams and fully validates uploads larger than the former 10 MiB buffer", async () => {
  const tagSize =
      10 +
      ((mp3[6] << 21) | (mp3[7] << 14) | (mp3[8] << 7) | mp3[9]) +
      (mp3[5] & 16 ? 10 : 0),
    frames = mp3.subarray(tagSize),
    copies = Math.ceil((11 * 1024 * 1024) / frames.length),
    large = Buffer.concat(Array.from({ length: copies }, () => frames)),
    before = performance.now(),
    asset = await repo.media.ingest(
      new Request("http://localhost/upload", {
        method: "POST",
        headers: { "Content-Type": "audio/mpeg" },
        body: large,
      }),
      "audio/mpeg",
    ),
    elapsed = performance.now() - before;
  expect(asset.bytes).toBe(large.length);
  expect(asset.bytes).toBeGreaterThan(10 * 1024 * 1024);
  expect(asset.duration).toBeGreaterThan(0);
  expect(elapsed).toBeLessThan(30000);
  expect(
    (await repo.media.bucket.list({ prefix: "_ingest/" })).objects,
  ).toEqual([]);
  await repo.media.bucket.delete(asset.id);
}, 30000);
it("executes a real local Workflow with generation disabled and no provider request", async () => {
  const bindings = await mf.getBindings<{
    GENERATION: Workflow<{ jobId: string }>;
  }>();
  const instance = await bindings.GENERATION.create({
    id: crypto.randomUUID(),
    params: { jobId: "disabled-probe" },
  });
  let state = await instance.status();
  for (let i = 0; i < 100 && state.status !== "complete"; i++) {
    await new Promise((r) => setTimeout(r, 25));
    state = await instance.status();
  }
  expect(state.status).toBe("complete");
  expect(state.output).toBe("disabled");
});

it("marks a scheduled release failed if its verified media is no longer available", async () => {
  const m = await ready(),
    id = crypto.randomUUID(),
    asset = Object.values(m.audio)[0];
  await repo
    .sql(
      "INSERT INTO publications VALUES(?,?,?,?,?)",
      id,
      m.storyId,
      "scheduled",
      0,
      JSON.stringify({ releaseId: m.releaseId, actor: publisher.id }),
    )
    .run();
  await repo.media.bucket.delete(asset.id);
  try {
    await repo.publishDue();
    expect(
      (
        await repo
          .sql("SELECT state FROM publications WHERE id=?", id)
          .first<{ state: string }>()
      )?.state,
    ).toBe("failed");
    expect((await repo.get(m.storyId)).active).toEqual({});
  } finally {
    await repo.media.put(mp3, "audio/mpeg");
  }
});
