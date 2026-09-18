import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import { Media } from "./media.ts";
import { Platform } from "./platform.ts";
import { createApp } from "./app.ts";
import { passwordHash, type Actor } from "./auth.ts";
import { Worker } from "./worker.ts";
import { StorySchema, segments, assets } from "@story/contracts";
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
const other: Actor = {
  id: "other",
  email: "other@test.test",
  roles: ["creator"],
};
const fixture = () =>
  StorySchema.parse({
    schemaVersion: 1,
    id: "temporary",
    title: "A complete story",
    language: "tr-TR",
    ageBand: "6-8",
    voice: {
      providerVoice: "BwhlzGpUiZ9uHtfvCl1H",
      globalDirection: "Warm",
      speakerProfiles: { narrator: "Warm" },
    },
    episode: { number: 1, title: "The beginning" },
    entryNodeId: "start",
    nodes: {
      start: {
        id: "start",
        kind: "narration",
        segments: [{ id: "intro", speaker: "narrator", text: "Hello." }],
        nextNodeId: "choice",
      },
      choice: {
        id: "choice",
        kind: "choice",
        promptSegments: [
          { id: "prompt", speaker: "narrator", text: "Which way?" },
        ],
        guidanceSegment: {
          id: "guide",
          speaker: "narrator",
          text: "Tap either choice.",
        },
        options: [
          {
            id: "a",
            label: "Left",
            voiceHints: ["left"],
            responseSegments: [
              { id: "a", speaker: "narrator", text: "Left it is." },
            ],
          },
          {
            id: "b",
            label: "Right",
            voiceHints: ["right"],
            responseSegments: [
              { id: "b", speaker: "narrator", text: "Right it is." },
            ],
          },
        ],
        nextNodeId: "end",
      },
      end: {
        id: "end",
        kind: "narration",
        segments: [{ id: "end", speaker: "narrator", text: "The end." }],
        nextNodeId: null,
      },
    },
  });
let root: string,
  store: Store,
  p: Platform,
  app: ReturnType<typeof createApp>,
  mp3: Buffer;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "story-test-"));
  store = new Store(join(root, "test.sqlite"));
  p = new Platform(store, new Media(join(root, "media")));
  for (const a of [creator, publisher, other])
    store.run(
      "INSERT INTO users VALUES(?,?,?,?)",
      a.id,
      a.email,
      passwordHash("test-password-long"),
      JSON.stringify(a.roles),
    );
  app = createApp(p, { secret: "test-secret-at-least-32-characters-long" });
  mp3 = await readFile(new URL("../fixtures/reminder.mp3", import.meta.url));
});
afterEach(async () => {
  await app.close();
  store.db.close();
  await rm(root, { recursive: true, force: true });
});
async function login(a = creator) {
  const r = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: { email: a.email, password: "test-password-long" },
  });
  expect(r.statusCode).toBe(200);
  return { cookie: String(r.headers["set-cookie"]).split(";")[0] };
}
async function ready() {
  let d = p.create(creator, fixture());
  d = p.mutate(creator, d.id, d.revision, (v) => {
    v.card.description = "An adventure.";
  });
  const asset = await p.media.put(mp3, "audio/mpeg");
  store.run(
    "INSERT INTO assets VALUES(?,?,?)",
    asset.id,
    JSON.stringify(asset),
    Date.now(),
  );
  for (const s of segments(d.story))
    d = p.attach(creator, d.id, d.revision, s.id, asset);
  d.preview = { revision: d.revision, actor: publisher.id };
  p.save(d);
  p.review(publisher, d.id, d.revision);
  return p.get(d.id);
}
describe("Story Studio vertical flow", () => {
  it("private draft → upload → preview → review → publish → range playback", async () => {
    const auth = await login();
    const created = await app.inject({
      method: "POST",
      url: "/api/stories",
      headers: auth,
      payload: { story: fixture() },
    });
    expect(created.statusCode).toBe(200);
    let d = created.json();
    expect((await app.inject("/api/catalog")).json()).toEqual([]);
    d = (
      await app.inject({
        method: "PUT",
        url: "/api/stories/" + d.id,
        headers: auth,
        payload: {
          revision: d.revision,
          card: { ...d.card, description: "An adventure." },
        },
      })
    ).json();
    for (const s of segments(d.story)) {
      const r = await app.inject({
        method: "POST",
        url: `/api/stories/${d.id}/assets?revision=${d.revision}&segmentId=${s.id}`,
        headers: { ...auth, "content-type": "audio/mpeg" },
        payload: mp3,
      });
      expect(r.statusCode).toBe(200);
      d = r.json();
    }
    const pub = await login(publisher);
    const preview = await app.inject({
      method: "POST",
      url: `/api/stories/${d.id}/preview`,
      headers: pub,
      payload: { revision: d.revision },
    });
    expect(preview.statusCode).toBe(200);
    expect(Object.keys(preview.json().audio)).toHaveLength(6);
    expect(preview.json().choiceDependencies.choice).toEqual([
      "prompt",
      "guide",
      "a",
      "b",
      "end",
    ]);
    await app.inject({
      method: "POST",
      url: `/api/stories/${d.id}/previewed`,
      headers: pub,
      payload: { revision: d.revision },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/stories/${d.id}/review`,
          headers: pub,
          payload: { revision: d.revision },
        })
      ).statusCode,
    ).toBe(200);
    const release = (
      await app.inject({
        method: "POST",
        url: `/api/stories/${d.id}/releases`,
        headers: pub,
        payload: { revision: d.revision },
      })
    ).json();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/releases/${release.releaseId}/activate`,
          headers: pub,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    const catalog = (await app.inject("/api/catalog")).json();
    expect(catalog[0].id).toBe(d.id);
    const asset = release.audio.intro;
    const ticket = (
      await app.inject({
        method: "POST",
        url: "/api/delivery",
        payload: { releaseId: release.releaseId, assetId: asset.id },
      })
    ).json();
    const url = new URL(ticket.url);
    const range = await app.inject({
      url: url.pathname + url.search,
      headers: { range: "bytes=10-99" },
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload).toEqual(mp3.subarray(10, 100));
    expect(range.headers["content-length"]).toBe("90");
    expect(range.headers["accept-ranges"]).toBe("bytes");
    expect(
      (
        await app.inject({
          url: url.pathname + url.search,
          headers: { range: "bytes=99999999-" },
        })
      ).statusCode,
    ).toBe(416);
    const changed = new URL(ticket.url);
    changed.searchParams.set("expires", "1");
    expect(
      (await app.inject(changed.pathname + changed.search)).statusCode,
    ).toBe(403);
  });
  it("enforces authentication, ownership, roles, origin and revision conflicts", async () => {
    const d = p.create(creator, fixture());
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/stories/" + d.id,
          payload: { revision: 1, story: d.story },
        })
      ).statusCode,
    ).toBe(401);
    const outsider = await login(other);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/stories/" + d.id,
          headers: outsider,
          payload: { revision: 1, story: d.story },
        })
      ).statusCode,
    ).toBe(403);
    const auth = await login();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/stories/${d.id}/review`,
          headers: auth,
          payload: { revision: 1 },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/stories/" + d.id,
          headers: { ...auth, origin: "https://evil.test" },
          payload: { revision: 1 },
        })
      ).statusCode,
    ).toBe(403);
    p.mutate(creator, d.id, 1, (v) => {
      v.story.title = "New title";
    });
    expect(() => p.mutate(creator, d.id, 1, () => {})).toThrow(
      "Revision changed",
    );
  });
  it("keeps visibility independent, validates readiness, retains immutable releases on rollback", async () => {
    const d = await ready();
    const m = await p.candidate(publisher, d.id, d.revision);
    await p.activate(publisher, m.releaseId);
    const edit = p.mutate(creator, d.id, d.revision, (v) => {
      v.story.nodes.start.kind === "narration" &&
        (v.story.nodes.start.segments[0].text = "Changed");
    });
    expect(p.readiness(edit)).toContain("audio.intro: Audio is stale");
    expect(edit.active["tr-TR"]).toBe(m.releaseId);
    expect(p.release(m.releaseId).story.nodes.start).toEqual(
      m.story.nodes.start,
    );
    expect(() =>
      store.run("UPDATE releases SET data=? WHERE id=?", "{}", m.releaseId),
    ).toThrow();
    const pub = await login(publisher);
    await app.inject({
      method: "POST",
      url: `/api/stories/${d.id}/visibility`,
      headers: pub,
      payload: { visibility: "coming-soon" },
    });
    expect(p.get(d.id).state).toBe("draft");
    await p.activate(publisher, m.releaseId);
    expect(p.get(d.id).active["tr-TR"]).toBe(m.releaseId);
    await writeFile(p.media.path(m.audio.intro.id), "corrupt");
    await expect(p.activate(publisher, m.releaseId)).rejects.toThrow("corrupt");
    expect(p.get(d.id).active["tr-TR"]).toBe(m.releaseId);
  });
  it("deduplicates jobs, leaves late outputs stale and never retries uncertain billing", async () => {
    const d = p.create(creator, fixture());
    expect(() =>
      p.enqueue(creator, d.id, 1, "intro", "elevenlabs", "click", false),
    ).toThrow();
    const job = p.enqueue(
      creator,
      d.id,
      1,
      "intro",
      "elevenlabs",
      "click",
      true,
    );
    expect(
      p.enqueue(creator, d.id, 1, "intro", "elevenlabs", "click", true).id,
    ).toBe(job.id);
    let calls = 0;
    const worker = new Worker(p, async () => {
      calls++;
      p.mutate(creator, d.id, 1, (v) => {
        if (v.story.nodes.start.kind === "narration")
          v.story.nodes.start.segments[0].text = "New";
      });
      return { audio: mp3 };
    });
    await worker.tick();
    expect(calls).toBe(1);
    expect(store.one("SELECT state FROM jobs WHERE id=?", job.id).state).toBe(
      "stale",
    );
    expect(p.get(d.id).clips.intro).toBeUndefined();
    const latest = p.get(d.id);
    const second = p.enqueue(
      creator,
      d.id,
      latest.revision,
      "intro",
      "elevenlabs",
      "next",
      true,
    );
    store.run("UPDATE jobs SET state='running' WHERE id=?", second.id);
    worker.recover();
    expect(
      store.one("SELECT state FROM jobs WHERE id=?", second.id).state,
    ).toBe("uncertain");
    await worker.tick();
    expect(calls).toBe(1);
  });
  it("executes and cancels schedules idempotently and reports missing assets", async () => {
    const d = await ready(),
      m = await p.candidate(publisher, d.id, d.revision),
      pub = await login(publisher);
    const payload = {
      at: new Date(Date.now() + 60000).toISOString(),
      timeZone: "Europe/Istanbul",
      key: "schedule",
    };
    const a = (
      await app.inject({
        method: "POST",
        url: `/api/releases/${m.releaseId}/schedule`,
        headers: pub,
        payload,
      })
    ).json();
    const b = (
      await app.inject({
        method: "POST",
        url: `/api/releases/${m.releaseId}/schedule`,
        headers: pub,
        payload,
      })
    ).json();
    expect(a.id).toBe(b.id);
    await app.inject({
      method: "POST",
      url: `/api/publications/${a.id}/cancel`,
      headers: pub,
      payload: {},
    });
    store.run("UPDATE publications SET due=0 WHERE id=?", a.id);
    const worker = new Worker(p);
    await worker.tick();
    expect(p.get(d.id).active).toEqual({});
    store.run("UPDATE publications SET state='scheduled' WHERE id=?", a.id);
    await worker.tick();
    await worker.tick();
    expect(p.get(d.id).active["tr-TR"]).toBe(m.releaseId);
    expect(
      store.one("SELECT state FROM publications WHERE id=?", a.id).state,
    ).toBe("published");
  });
});

it("never exposes an unpublished frozen candidate and rejects a truncated MP3", async () => {
  const d = await ready(),
    m = await p.candidate(publisher, d.id, d.revision);
  expect((await app.inject("/api/releases/" + m.releaseId)).statusCode).toBe(
    404,
  );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/delivery",
        payload: { releaseId: m.releaseId, assetId: m.audio.intro.id },
      })
    ).statusCode,
  ).toBe(404);
  await expect(
    p.media.put(mp3.subarray(0, mp3.length - 12), "audio/mpeg"),
  ).rejects.toThrow("Truncated MP3");
});
it("keeps a published release accessible when hidden and denies new delivery when withdrawn", async () => {
  const d = await ready(),
    m = await p.candidate(publisher, d.id, d.revision);
  await p.activate(publisher, m.releaseId);
  const headers = await login(publisher);
  await app.inject({
    method: "POST",
    url: `/api/stories/${d.id}/visibility`,
    headers,
    payload: { visibility: "hidden" },
  });
  expect((await app.inject("/api/catalog")).json()).toEqual([]);
  expect((await app.inject("/api/releases/" + m.releaseId)).statusCode).toBe(
    200,
  );
  await app.inject({
    method: "POST",
    url: `/api/stories/${d.id}/visibility`,
    headers,
    payload: { visibility: "hidden", withdrawn: true },
  });
  expect((await app.inject("/api/releases/" + m.releaseId)).statusCode).toBe(
    403,
  );
  expect(p.release(m.releaseId).releaseId).toBe(m.releaseId);
});

it("revokes mobile bearer sessions at logout and keeps publisher editing scoped", async () => {
  const result = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: {
      email: creator.email,
      password: "test-password-long",
      mobile: true,
    },
  });
  const headers = { authorization: `Bearer ${result.json().token}` };
  expect((await app.inject({ url: "/api/me", headers })).statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/logout",
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect((await app.inject({ url: "/api/me", headers })).statusCode).toBe(401);
  const d = p.create(creator, fixture());
  const combined: Actor = { ...other, roles: ["creator", "publisher"] };
  expect(() => p.read(combined, d)).not.toThrow();
  expect(() => p.mutate(combined, d.id, d.revision, () => {})).toThrow(
    "Story access denied",
  );
  const job = p.enqueue(
    creator,
    d.id,
    1,
    "intro",
    "elevenlabs",
    "revoked",
    true,
  );
  store.run("UPDATE users SET roles='[]' WHERE id=?", creator.id);
  let calls = 0;
  await new Worker(p, async () => {
    calls++;
    return { audio: mp3 };
  }).tick();
  expect(calls).toBe(0);
  expect(store.one("SELECT state FROM jobs WHERE id=?", job.id).state).toBe(
    "cancelled",
  );
});

it("activates due releases while a provider request is still running", async () => {
  const d = await ready(),
    m = await p.candidate(publisher, d.id, d.revision);
  const draft = p.create(creator, fixture());
  p.enqueue(creator, draft.id, 1, "intro", "elevenlabs", "slow-provider", true);
  let finish!: (value: { audio: Buffer }) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const worker = new Worker(p, () => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const generating = worker.tick();
  await entered;
  store.run(
    "INSERT INTO publications VALUES(?,?,?,?,?)",
    "while-generating",
    d.id,
    "scheduled",
    0,
    JSON.stringify({
      releaseId: m.releaseId,
      actor: publisher.id,
      timeZone: "UTC",
    }),
  );
  await worker.tick();
  expect(p.get(d.id).active["tr-TR"]).toBe(m.releaseId);
  finish({ audio: mp3 });
  await generating;
});
