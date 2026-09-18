import { randomUUID } from "node:crypto";
import {
  assets,
  StorySchema,
  type Manifest,
  type Asset,
} from "@story/contracts";
import {
  Platform,
  buildManifest,
  type Draft,
  type Generation,
} from "../../content-api/src/platform.ts";
import {
  HttpError,
  requireRole,
  type Actor,
} from "../../content-api/src/auth.ts";
import type { R2Media } from "./media.ts";

// Reuse the existing domain validation/authorization; storage-dependent methods stay here.
const domain = Platform.prototype;
export class StateConflict extends HttpError {
  constructor() {
    super(409, "State or permissions changed. Reload before retrying.");
  }
}
type Row = { id: string; data: string; state?: string; due?: number };
export class Repository {
  constructor(
    public db: D1Database,
    public media: R2Media,
  ) {}
  sql(query: string, ...params: unknown[]) {
    return this.db.prepare(query).bind(...params);
  }
  async rows(query: string, ...params: unknown[]) {
    return (await this.sql(query, ...params).all<Row>()).results;
  }
  async get(id: string): Promise<Draft> {
    const r = await this.sql(
      "SELECT data FROM stories WHERE id=?",
      id,
    ).first<Row>();
    if (!r) throw new HttpError(404, "Story not found");
    return JSON.parse(r.data);
  }
  async release(id: string): Promise<Manifest> {
    const r = await this.sql(
      "SELECT data FROM releases WHERE id=?",
      id,
    ).first<Row>();
    if (!r) throw new HttpError(404, "Release not found");
    return JSON.parse(r.data);
  }
  access = domain.access;
  read = domain.read;
  fingerprint = domain.fingerprint;
  readiness = domain.readiness;
  audit(actor: string, action: string, subject: string) {
    return this.sql(
      "INSERT INTO audit VALUES(?,?,?,?,?)",
      randomUUID(),
      new Date().toISOString(),
      actor,
      action,
      subject,
    );
  }
  guard(predicate: string, ...params: unknown[]) {
    return this.sql(
      `INSERT INTO transaction_guards VALUES(?,CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`,
      randomUUID(),
      ...params,
    );
  }
  actorGuard(a: Actor) {
    // Reject revocation racing an authenticated request. Never trust roles in the request body.
    return this.guard(
      "EXISTS(SELECT 1 FROM users WHERE id=? AND roles=?)",
      a.id,
      JSON.stringify(a.roles),
    );
  }
  draftGuard(d: Draft) {
    // Compare the full stored value: revision alone misses visibility, access and review changes.
    return this.guard(
      "EXISTS(SELECT 1 FROM stories WHERE id=? AND data=?)",
      d.id,
      JSON.stringify(d),
    );
  }
  save(d: Draft) {
    return this.sql(
      "UPDATE stories SET revision=?,data=? WHERE id=?",
      d.revision,
      JSON.stringify(d),
      d.id,
    );
  }
  async commit(statements: D1PreparedStatement[]) {
    try {
      await this.db.batch([
        ...statements,
        this.sql("DELETE FROM transaction_guards"),
      ]);
    } catch (e) {
      if (String(e).includes("CHECK constraint failed"))
        throw new StateConflict();
      throw e;
    }
  }
  async create(a: Actor, input: unknown) {
    requireRole(a, "creator");
    const story = StorySchema.parse(input),
      id = randomUUID();
    story.id = id;
    const d: Draft = {
      id,
      owner: a.id,
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
    await this.commit([
      this.actorGuard(a),
      this.sql(
        "INSERT INTO stories VALUES(?,?,?,?)",
        id,
        a.id,
        1,
        JSON.stringify(d),
      ),
      this.audit(a.id, "draft.create", id),
    ]);
    return d;
  }
  async change(
    a: Actor,
    id: string,
    revision: number | undefined,
    action: string,
    fn: (d: Draft) => void,
    edit = false,
  ) {
    const original = await this.get(id),
      d = structuredClone(original);
    if (edit) this.access(a, d, true);
    if (revision !== undefined && d.revision !== revision)
      throw new HttpError(409, "Revision changed");
    fn(d);
    if (edit) {
      d.revision++;
      d.preview = null;
      d.review = null;
      d.state = "draft";
    }
    await this.commit([
      this.actorGuard(a),
      this.draftGuard(original),
      this.save(d),
      this.audit(a.id, action, id),
    ]);
    return d;
  }
  async manifest(d: Draft, id: string) {
    const cover = d.card.cover
      ? await this.sql(
          "SELECT data FROM assets WHERE id=?",
          d.card.cover,
        ).first<Row>()
      : null;
    const errors = this.readiness(d);
    if (errors.length) throw new HttpError(409, errors.join("\n"));
    if (d.card.cover && !cover) throw new HttpError(409, "Cover is missing");
    return buildManifest(d, id, cover ? JSON.parse(cover.data) : null);
  }
  async verify(m: Manifest) {
    for (const a of assets(m)) await this.media.verify(a);
  }
  async preview(a: Actor, id: string, revision: number) {
    const d = await this.get(id);
    this.read(a, d);
    if (d.revision !== revision) throw new HttpError(409, "Revision changed");
    const m = await this.manifest(d, `preview-${id}-${revision}`);
    await this.verify(m);
    return m;
  }
  async candidate(a: Actor, id: string, revision: number) {
    requireRole(a, "publisher");
    const d = await this.get(id);
    if (d.revision !== revision || d.review?.revision !== revision)
      throw new HttpError(409, "Review this exact revision first");
    const m = await this.manifest(d, randomUUID());
    await this.verify(m);
    await this.commit([
      this.actorGuard(a),
      this.draftGuard(d),
      this.sql(
        "INSERT OR IGNORE INTO releases VALUES(?,?,?)",
        m.releaseId,
        id,
        JSON.stringify(m),
      ),
      this.sql(
        "INSERT INTO audit SELECT ?,?,?,?,id FROM releases WHERE id=?",
        randomUUID(),
        new Date().toISOString(),
        a.id,
        "release.freeze",
        m.releaseId,
      ),
    ]);
    const row = await this.sql(
      "SELECT data FROM releases WHERE story_id=? AND json_extract(data,'$.revision')=?",
      id,
      revision,
    ).first<Row>();
    return JSON.parse(row!.data) as Manifest;
  }
  async activate(a: Actor, releaseId: string, publication?: Row) {
    requireRole(a, "publisher");
    const m = await this.release(releaseId);
    await this.verify(m);
    const original = await this.get(m.storyId),
      d = structuredClone(original);
    d.active[m.locale] = m.releaseId;
    d.visibility = "available";
    d.withdrawn = false;
    await this.commit([
      this.actorGuard(a),
      this.draftGuard(original),
      ...(publication
        ? [
            this.guard(
              "EXISTS(SELECT 1 FROM publications WHERE id=? AND state='scheduled' AND due<=?)",
              publication.id,
              Date.now(),
            ),
          ]
        : []),
      this.sql(
        "INSERT OR IGNORE INTO published_releases VALUES(?)",
        m.releaseId,
      ),
      this.save(d),
      ...(publication
        ? [
            this.sql(
              "UPDATE publications SET state='published' WHERE id=?",
              publication.id,
            ),
          ]
        : []),
      this.audit(
        a.id,
        publication ? "publication.published" : "release.activate",
        m.releaseId,
      ),
    ]);
    return d;
  }
  async enqueue(
    a: Actor,
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
    const d = await this.get(id);
    this.access(a, d, true);
    if (d.revision !== revision) throw new HttpError(409, "Revision changed");
    const fingerprint = this.fingerprint(d.story, segmentId),
      unique = `${id}:${segmentId}:${fingerprint}:${provider}:${key}`;
    const input = (await import("@story/contracts"))
      .segments(d.story)
      .find((s) => s.id === segmentId);
    const job: Generation = {
      id: randomUUID(),
      storyId: id,
      segmentId,
      revision,
      fingerprint,
      input: {
        segment: input,
        voice: d.story.voice,
        language: d.story.language,
      },
      provider,
      state: "queued",
      attempts: 0,
      baseAsset: d.clips[segmentId]?.asset.id,
      actor: a.id,
    };
    await this.commit([
      this.actorGuard(a),
      this.draftGuard(d),
      this.sql(
        "INSERT OR IGNORE INTO jobs VALUES(?,?,?,?,?)",
        job.id,
        id,
        unique,
        job.state,
        JSON.stringify(job),
      ),
      this.sql(
        "INSERT INTO audit SELECT ?,?,?,?,id FROM jobs WHERE id=?",
        randomUUID(),
        new Date().toISOString(),
        a.id,
        "generation.authorized",
        job.id,
      ),
    ]);
    const row = await this.sql(
      "SELECT data FROM jobs WHERE key=? OR (story_id=? AND state IN ('queued','running') AND json_extract(data,'$.segmentId')=? AND json_extract(data,'$.fingerprint')=?) ORDER BY key=? DESC LIMIT 1",
      unique,
      id,
      segmentId,
      fingerprint,
      unique,
    ).first<Row>();
    return JSON.parse(row!.data) as Generation;
  }
  async user(id: string): Promise<Actor> {
    const row = await this.sql(
      "SELECT id,email,roles FROM users WHERE id=?",
      id,
    ).first<{ id: string; email: string; roles: string }>();
    if (!row) throw new HttpError(403, "Account unavailable");
    return { ...row, roles: JSON.parse(row.roles) };
  }
  async publishDue() {
    for (const p of await this.rows(
      "SELECT * FROM publications WHERE state='scheduled' AND due<=? ORDER BY due LIMIT 25",
      Date.now(),
    )) {
      const data = JSON.parse(p.data);
      try {
        await this.activate(await this.user(data.actor), data.releaseId, p);
      } catch (e) {
        // A CAS conflict can be a concurrent edit/cancel/activation: leave it for the next cron.
        if (e instanceof StateConflict) continue;
        await this.sql(
          "UPDATE publications SET state='failed' WHERE id=? AND state='scheduled'",
          p.id,
        ).run();
      }
    }
  }
  async recordAsset(asset: Asset) {
    await this.sql(
      "INSERT OR IGNORE INTO assets VALUES(?,?,?)",
      asset.id,
      JSON.stringify(asset),
      Date.now(),
    ).run();
  }
}
