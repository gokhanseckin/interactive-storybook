import { randomUUID, createHash } from "node:crypto";
import {
  StorySchema,
  CardSchema,
  ManifestSchema,
  segments,
  choiceDependencies,
  assets,
  type Story,
  type Card,
  type Asset,
  type Manifest,
} from "@story/contracts";
import type { Store } from "./store.ts";
import type { Media } from "./media.ts";
import { HttpError, requireRole, type Actor } from "./auth.ts";
export type Draft = {
  id: string;
  owner: string;
  revision: number;
  story: Story;
  card: Card;
  visibility: "hidden" | "coming-soon" | "available";
  active: Record<string, string>;
  withdrawn: boolean;
  clips: Record<string, { asset: Asset; fingerprint: string }>;
  review: null | { revision: number; actor: string };
  preview: null | { revision: number; actor: string };
  state: "draft" | "in-review" | "ready";
  editors: string[];
};
export type Generation = {
  id: string;
  storyId: string;
  segmentId: string;
  revision: number;
  fingerprint: string;
  input: unknown;
  provider: string;
  state: string;
  attempts: number;
  baseAsset?: string;
  providerRequestId?: string | null;
  error?: string;
  asset?: Asset;
  actor: string;
};
export class Platform {
  constructor(
    public store: Store,
    public media: Media,
  ) {}
  get(id: string): Draft {
    const row = this.store.one("SELECT data FROM stories WHERE id=?", id);
    if (!row) throw new HttpError(404, "Story not found");
    return JSON.parse(row.data);
  }
  access(actor: Actor, d: Draft, write = false) {
    requireRole(actor, "creator");
    if (
      d.owner !== actor.id &&
      !d.editors.includes(actor.id) &&
      !actor.roles.includes("admin")
    )
      throw new HttpError(403, "Story access denied");
  }
  read(actor: Actor, d: Draft) {
    if (actor.roles.some((r) => r === "publisher" || r === "admin")) return;
    this.access(actor, d);
  }
  save(d: Draft) {
    this.store.run(
      "UPDATE stories SET revision=?,data=? WHERE id=?",
      d.revision,
      JSON.stringify(d),
      d.id,
    );
  }
  create(actor: Actor, input: unknown, importedId?: string) {
    requireRole(actor, "creator");
    const story = StorySchema.parse(input);
    const id = importedId ?? randomUUID();
    story.id = id;
    const d: Draft = {
      id,
      owner: actor.id,
      revision: 1,
      story,
      card: {
        title: story.title,
        description: "",
        ageBand: story.ageBand,
        cover: null,
      },
      visibility: "hidden",
      active: {},
      withdrawn: false,
      clips: {},
      review: null,
      preview: null,
      state: "draft",
      editors: [],
    };
    this.store.transaction(() => {
      this.store.run(
        "INSERT INTO stories VALUES(?,?,?,?)",
        id,
        actor.id,
        1,
        JSON.stringify(d),
      );
      this.store.audit(actor.id, "draft.create", id);
    });
    return d;
  }
  mutate(actor: Actor, id: string, revision: number, fn: (d: Draft) => void) {
    return this.store.transaction(() => {
      const d = this.get(id);
      this.access(actor, d, true);
      if (d.revision !== revision)
        throw new HttpError(409, "Revision changed. Reload before saving.");
      fn(d);
      d.revision++;
      d.review = null;
      d.preview = null;
      d.state = "draft";
      this.save(d);
      this.store.audit(actor.id, "draft.edit", id);
      return d;
    });
  }
  fingerprint(story: Story, segmentId: string) {
    const s = segments(story).find((s) => s.id === segmentId);
    if (!s) throw new HttpError(404, "Clip not found");
    return createHash("sha256")
      .update(
        JSON.stringify({ s, voice: story.voice, language: story.language }),
      )
      .digest("hex");
  }
  attach(
    actor: Actor,
    id: string,
    revision: number,
    segmentId: string,
    asset: Asset,
  ) {
    return this.mutate(actor, id, revision, (d) => {
      d.clips[segmentId] = {
        asset,
        fingerprint: this.fingerprint(d.story, segmentId),
      };
    });
  }
  readiness(d: Draft) {
    const errors: string[] = [];
    const card = CardSchema.safeParse(d.card);
    if (!card.success)
      errors.push(
        ...card.error.issues.map(
          (i) => `card.${i.path.join(".")}: ${i.message}`,
        ),
      );
    for (const s of segments(d.story)) {
      const c = d.clips[s.id];
      if (!c) errors.push(`audio.${s.id}: Missing MP3`);
      else if (c.fingerprint !== this.fingerprint(d.story, s.id))
        errors.push(`audio.${s.id}: Audio is stale`);
    }
    return errors;
  }
  manifest(d: Draft, releaseId: string): Manifest {
    const errors = this.readiness(d);
    if (errors.length) throw new HttpError(409, errors.join("\n"));
    const cover = d.card.cover
      ? this.store.one("SELECT data FROM assets WHERE id=?", d.card.cover)
      : null;
    if (d.card.cover && !cover) throw new HttpError(409, "Cover is missing");
    return buildManifest(d, releaseId, cover ? JSON.parse(cover.data) : null);
  }

  async preview(actor: Actor, id: string, revision: number) {
    const d = this.get(id);
    this.read(actor, d);
    if (d.revision !== revision) throw new HttpError(409, "Revision changed");
    const m = this.manifest(d, `preview-${id}-${revision}`);
    await Promise.all(assets(m).map((a) => this.media.verify(a)));
    return m;
  }
  review(actor: Actor, id: string, revision: number) {
    requireRole(actor, "publisher");
    return this.store.transaction(() => {
      const d = this.get(id);
      if (d.revision !== revision || d.preview?.revision !== revision)
        throw new HttpError(409, "Preview this exact revision first");
      if (this.readiness(d).length) throw new HttpError(409, "Draft not ready");
      d.review = { revision, actor: actor.id };
      d.state = "ready";
      this.save(d);
      this.store.audit(actor.id, "draft.review", id);
      return d;
    });
  }
  async candidate(actor: Actor, id: string, revision: number) {
    requireRole(actor, "publisher");
    const d = this.get(id);
    if (d.revision !== revision || d.review?.revision !== revision)
      throw new HttpError(409, "Review this exact revision first");
    const m = this.manifest(d, randomUUID());
    await Promise.all(assets(m).map((a) => this.media.verify(a)));
    return this.store.transaction(() => {
      if (this.get(id).revision !== revision)
        throw new HttpError(409, "Revision changed");
      const existing = this.store
        .all("SELECT data FROM releases WHERE story_id=?", id)
        .map((r) => JSON.parse(r.data) as Manifest)
        .find((r) => r.revision === revision);
      if (existing) return existing;
      this.store.run(
        "INSERT INTO releases VALUES(?,?,?)",
        m.releaseId,
        id,
        JSON.stringify(m),
      );
      this.store.audit(actor.id, "release.freeze", m.releaseId);
      return m;
    });
  }
  release(id: string): Manifest {
    const r = this.store.one("SELECT data FROM releases WHERE id=?", id);
    if (!r) throw new HttpError(404, "Release not found");
    return ManifestSchema.parse(JSON.parse(r.data));
  }
  async activate(actor: Actor, releaseId: string) {
    requireRole(actor, "publisher");
    const m = this.release(releaseId);
    await Promise.all(assets(m).map((a) => this.media.verify(a)));
    return this.store.transaction(() => {
      const d = this.get(m.storyId);
      this.store.run(
        "INSERT OR IGNORE INTO published_releases VALUES(?)",
        m.releaseId,
      );
      d.active[m.locale] = m.releaseId;
      d.visibility = "available";
      d.withdrawn = false;
      this.save(d);
      this.store.audit(actor.id, "release.activate", m.releaseId);
      return d;
    });
  }
  enqueue(
    actor: Actor,
    id: string,
    revision: number,
    segmentId: string,
    provider: string,
    key: string,
    authorized: boolean,
  ) {
    if (!authorized)
      throw new HttpError(
        400,
        "Explicit paid generation authorization required",
      );
    const d = this.get(id);
    this.access(actor, d, true);
    if (d.revision !== revision) throw new HttpError(409, "Revision changed");
    const fingerprint = this.fingerprint(d.story, segmentId);
    const active = this.store
      .all(
        "SELECT data FROM jobs WHERE story_id=? AND state IN ('queued','running')",
        id,
      )
      .map((r) => JSON.parse(r.data))
      .find((j) => j.segmentId === segmentId && j.fingerprint === fingerprint);
    if (active) return active;
    const unique = `${id}:${segmentId}:${fingerprint}:${provider}:${key}`;
    const prior = this.store.one("SELECT data FROM jobs WHERE key=?", unique);
    if (prior) return JSON.parse(prior.data);
    const job: Generation = {
      id: randomUUID(),
      storyId: id,
      segmentId,
      revision,
      fingerprint,
      input: {
        segment: segments(d.story).find((s) => s.id === segmentId),
        voice: d.story.voice,
        language: d.story.language,
      },
      provider,
      state: "queued",
      attempts: 0,
      baseAsset: d.clips[segmentId]?.asset.id,
      actor: actor.id,
    };
    this.store.transaction(() => {
      this.store.run(
        "INSERT INTO jobs VALUES(?,?,?,?,?)",
        job.id,
        id,
        unique,
        "queued",
        JSON.stringify(job),
      );
      this.store.audit(actor.id, "generation.authorized", job.id);
    });
    return job;
  }
}

export function buildManifest(
  d: Draft,
  releaseId: string,
  cover: Asset | null,
): Manifest {
  return ManifestSchema.parse({
    schemaVersion: 1,
    playerVersion: 1,
    storyId: d.id,
    releaseId,
    locale: d.story.language,
    revision: d.revision,
    story: d.story,
    audio: Object.fromEntries(
      segments(d.story).map((s) => [s.id, d.clips[s.id].asset]),
    ),
    artwork: cover ? [cover] : [],
    choiceDependencies: choiceDependencies(d.story),
    createdAt: new Date().toISOString(),
  });
}
