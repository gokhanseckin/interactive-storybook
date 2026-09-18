import Fastify, { type FastifyRequest } from "fastify";
import {
  randomBytes,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { readFile, readdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { StorySchema, CardSchema, assets } from "@story/contracts";
import { Platform } from "./platform.ts";
import {
  passwordMatches,
  tokenHash,
  HttpError,
  requireRole,
  type Actor,
} from "./auth.ts";
export function createApp(
  platform: Platform,
  {
    secret,
    origin = "http://localhost:4400",
    secure = false,
  }: { secret: string; origin?: string; secure?: boolean },
) {
  if (secret.length < 32)
    throw new Error("SESSION_SECRET must be at least 32 characters");
  const app = Fastify({ bodyLimit: 100 * 1024 * 1024, logger: false });
  const db = platform.store;
  app.addContentTypeParser(
    ["audio/mpeg", "image/png", "image/jpeg"],
    { parseAs: "buffer" },
    (_r, b, done) => done(null, b),
  );
  app.setErrorHandler((e, _req, reply) => {
    const err = e as Error & { statusCode?: number };
    if (e instanceof z.ZodError)
      return reply.code(400).send({
        error: e.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n"),
      });
    return reply
      .code(err.statusCode ?? 500)
      .send({ error: err.statusCode ? err.message : "Request failed" });
  });
  const failures = new Map<string, { count: number; until: number }>();
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== origin
    )
      throw new HttpError(403, "Origin denied");
  });
  function actor(req: FastifyRequest): Actor {
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("studio="))
      ?.slice(7);
    const token = bearer || cookie;
    if (!token) throw new HttpError(401, "Sign in required");
    const row = db.one(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
      tokenHash(token),
      Date.now(),
    );
    if (!row) throw new HttpError(401, "Session expired");
    return { id: row.id, email: row.email, roles: JSON.parse(row.roles) };
  }
  const id = (req: FastifyRequest) => (req.params as any).id as string;
  const body = (req: FastifyRequest) =>
    z.record(z.string(), z.unknown()).parse(req.body);
  const revision = (b: Record<string, unknown>) =>
    z.number().int().positive().parse(b.revision);
  const signature = (scope: string, asset: string, expires: number) =>
    createHmac("sha256", secret)
      .update(`${scope}:${asset}:${expires}`)
      .digest("hex");
  function ticket(scope: string, asset: string) {
    const expires = Date.now() + 15 * 60 * 1000;
    return {
      url: `${origin}/media/${asset}?scope=${encodeURIComponent(scope)}&expires=${expires}&signature=${signature(scope, asset, expires)}`,
      expires,
    };
  }
  app.post("/api/login", async (req, reply) => {
    const b = z
      .object({
        email: z.string().email(),
        password: z.string().min(1).max(1024),
        mobile: z.boolean().optional(),
      })
      .parse(req.body);
    const key = req.ip;
    const failure = failures.get(key);
    if (failure && failure.until > Date.now() && failure.count >= 8)
      throw new HttpError(429, "Try again later");
    const row = db.one(
      "SELECT * FROM users WHERE email=?",
      b.email.toLowerCase(),
    );
    if (!row || !passwordMatches(b.password, row.password)) {
      failures.set(key, {
        count: failure && failure.until > Date.now() ? failure.count + 1 : 1,
        until: Date.now() + 60000,
      });
      throw new HttpError(401, "Invalid email or password");
    }
    failures.delete(key);
    const token = randomBytes(32).toString("hex");
    db.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      tokenHash(token),
      row.id,
      Date.now() + 8 * 3600000,
    );
    reply.header(
      "Set-Cookie",
      `studio=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? "; Secure" : ""}`,
    );
    return {
      user: { id: row.id, email: row.email, roles: JSON.parse(row.roles) },
      ...(b.mobile ? { token } : {}),
    };
  });
  app.post("/api/logout", async (req, reply) => {
    actor(req);
    const cookie =
      req.headers.authorization?.replace(/^Bearer /, "") ??
      req.headers.cookie?.match(/(?:^|; )studio=([^;]+)/)?.[1];
    if (cookie) db.run("DELETE FROM sessions WHERE token=?", tokenHash(cookie));
    reply.header(
      "Set-Cookie",
      "studio=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return { ok: true };
  });
  app.get("/api/users", async (req) => {
    requireRole(actor(req), "admin");
    return db
      .all("SELECT id,email,roles FROM users")
      .map((u) => ({ ...u, roles: JSON.parse(u.roles) }));
  });
  app.put("/api/users/:id/roles", async (req) => {
    const a = actor(req);
    requireRole(a, "admin");
    const b = z
      .object({ roles: z.array(z.enum(["creator", "publisher", "admin"])) })
      .parse(req.body);
    if (a.id === id(req) && !b.roles.includes("admin"))
      throw new HttpError(409, "Cannot remove your own admin role");
    db.transaction(() => {
      db.run(
        "UPDATE users SET roles=? WHERE id=?",
        JSON.stringify(b.roles),
        id(req),
      );
      db.run("DELETE FROM sessions WHERE user_id=?", id(req));
      db.audit(a.id, "user.roles", id(req));
    });
    return { ok: true };
  });
  app.get("/api/me", async (req) => actor(req));
  app.get("/api/stories", async (req) => {
    const a = actor(req);
    return db
      .all("SELECT data FROM stories")
      .map((r) => JSON.parse(r.data))
      .filter(
        (d) =>
          a.roles.some((r) => r === "publisher" || r === "admin") ||
          (a.roles.includes("creator") &&
            (d.owner === a.id || d.editors.includes(a.id))),
      );
  });
  app.post("/api/stories", async (req) =>
    platform.create(actor(req), body(req).story),
  );
  app.get("/api/stories/:id", async (req) => {
    const a = actor(req),
      d = platform.get(id(req));
    platform.read(a, d);
    return {
      ...d,
      errors: platform.readiness(d),
      jobs: db
        .all("SELECT data FROM jobs WHERE story_id=?", d.id)
        .map((r) => JSON.parse(r.data)),
      releases: db
        .all("SELECT data FROM releases WHERE story_id=?", d.id)
        .map((r) => JSON.parse(r.data)),
      publications: db.all(
        "SELECT id,state,due,data FROM publications WHERE story_id=?",
        d.id,
      ),
    };
  });
  app.put("/api/stories/:id", async (req) => {
    const b = body(req);
    return platform.mutate(actor(req), id(req), revision(b), (d) => {
      if (b.story) {
        const s = StorySchema.parse(b.story);
        if (s.id !== d.id)
          throw new HttpError(400, "Stable story ID cannot change");
        d.story = s;
      }
      if (b.card) d.card = CardSchema.parse(b.card);
    });
  });
  app.post("/api/stories/:id/access", async (req) => {
    const a = actor(req);
    requireRole(a, "admin");
    const b = z.object({ editors: z.array(z.string()) }).parse(req.body);
    const d = platform.get(id(req));
    for (const userId of b.editors)
      if (!db.one("SELECT id FROM users WHERE id=?", userId))
        throw new HttpError(400, "Unknown user");
    d.editors = b.editors;
    platform.save(d);
    db.audit(a.id, "story.access", d.id);
    return d;
  });
  app.post("/api/stories/:id/visibility", async (req) => {
    const a = actor(req);
    requireRole(a, "publisher");
    const b = z
      .object({
        visibility: z.enum(["hidden", "coming-soon", "available"]),
        withdrawn: z.boolean().optional(),
      })
      .parse(req.body);
    return db.transaction(() => {
      const d = platform.get(id(req));
      if (b.visibility !== "hidden") CardSchema.parse(d.card);
      if (b.visibility === "available" && !Object.keys(d.active).length)
        throw new HttpError(409, "Publish a complete release first");
      d.visibility = b.visibility;
      if (b.withdrawn !== undefined) d.withdrawn = b.withdrawn;
      platform.save(d);
      db.audit(
        a.id,
        `catalog.${b.visibility}${d.withdrawn ? ".withdrawn" : ""}`,
        d.id,
      );
      return d;
    });
  });
  app.post("/api/stories/:id/assets", async (req) => {
    const a = actor(req),
      d = platform.get(id(req));
    platform.access(a, d, true);
    const q = z
      .object({
        revision: z.coerce.number().int().positive(),
        segmentId: z.string().optional(),
      })
      .parse(req.query);
    if (q.revision !== d.revision) throw new HttpError(409, "Revision changed");
    if (!Buffer.isBuffer(req.body))
      throw new HttpError(400, "Send binary media");
    const type = req.headers["content-type"]!;
    if (q.segmentId && type !== "audio/mpeg")
      throw new HttpError(400, "Clip must be MP3");
    if (!q.segmentId && type === "audio/mpeg")
      throw new HttpError(400, "Select a clip");
    const asset = await platform.media.put(req.body, type);
    db.run(
      "INSERT OR IGNORE INTO assets VALUES(?,?,?)",
      asset.id,
      JSON.stringify(asset),
      Date.now(),
    );
    return q.segmentId
      ? platform.attach(a, d.id, q.revision, q.segmentId, asset)
      : platform.mutate(a, d.id, q.revision, (v) => {
          v.card.cover = asset.id;
        });
  });
  app.post("/api/stories/:id/preview", async (req) => {
    const a = actor(req),
      b = body(req);
    return platform.preview(a, id(req), revision(b));
  });
  app.post("/api/stories/:id/previewed", async (req) => {
    const a = actor(req),
      b = body(req);
    await platform.preview(a, id(req), revision(b));
    return db.transaction(() => {
      const d = platform.get(id(req));
      if (d.revision !== revision(b))
        throw new HttpError(409, "Revision changed");
      d.preview = { revision: d.revision, actor: a.id };
      d.state = "in-review";
      platform.save(d);
      db.audit(a.id, "draft.previewed", d.id);
      return d;
    });
  });
  app.post("/api/stories/:id/review", async (req) =>
    platform.review(actor(req), id(req), revision(body(req))),
  );
  app.post("/api/stories/:id/releases", async (req) =>
    platform.candidate(actor(req), id(req), revision(body(req))),
  );
  app.post("/api/releases/:id/activate", async (req) =>
    platform.activate(actor(req), id(req)),
  );
  app.post("/api/releases/:id/schedule", async (req) => {
    const a = actor(req);
    requireRole(a, "publisher");
    const b = z
      .object({
        at: z.string().datetime({ offset: true }),
        timeZone: z.string(),
        key: z.string().min(1).max(100),
      })
      .parse(req.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: b.timeZone });
    } catch {
      throw new HttpError(400, "Invalid time zone");
    }
    const due = Date.parse(b.at);
    if (due <= Date.now())
      throw new HttpError(400, "Schedule must be in the future");
    const m = platform.release(id(req));
    const publicationId = tokenHash(`${m.releaseId}:${b.key}`);
    db.run(
      "INSERT OR IGNORE INTO publications VALUES(?,?,?,?,?)",
      publicationId,
      m.storyId,
      "scheduled",
      due,
      JSON.stringify({
        releaseId: m.releaseId,
        actor: a.id,
        timeZone: b.timeZone,
      }),
    );
    db.audit(a.id, "publication.schedule", publicationId);
    return db.one("SELECT * FROM publications WHERE id=?", publicationId);
  });
  app.post("/api/publications/:id/cancel", async (req) => {
    const a = actor(req);
    requireRole(a, "publisher");
    db.run(
      "UPDATE publications SET state='cancelled' WHERE id=? AND state='scheduled'",
      id(req),
    );
    db.audit(a.id, "publication.cancel", id(req));
    return { ok: true };
  });
  app.post("/api/stories/:id/jobs", async (req) => {
    const b = z
      .object({
        revision: z.number().int(),
        segmentId: z.string(),
        provider: z.enum(["elevenlabs", "openai"]),
        key: z.string().min(1).max(100),
        authorizePaidGeneration: z.boolean(),
      })
      .parse(req.body);
    return platform.enqueue(
      actor(req),
      id(req),
      b.revision,
      b.segmentId,
      b.provider,
      b.key,
      b.authorizePaidGeneration,
    );
  });
  app.get("/api/catalog", async () =>
    db
      .all("SELECT data FROM stories")
      .map((r) => JSON.parse(r.data))
      .filter((d) => d.visibility !== "hidden" && !d.withdrawn)
      .map((d) => ({
        id: d.id,
        card: d.card,
        visibility: d.visibility,
        releases: d.visibility === "available" ? d.active : {},
      })),
  );
  app.get("/api/releases/:id", async (req) => {
    if (!db.one("SELECT id FROM published_releases WHERE id=?", id(req)))
      throw new HttpError(404, "Release not published");
    const m = platform.release(id(req));
    if (platform.get(m.storyId).withdrawn)
      throw new HttpError(403, "New online playback is withdrawn");
    return m;
  });
  app.post("/api/delivery", async (req) => {
    const b = z
      .object({ releaseId: z.string(), assetId: z.string() })
      .parse(req.body);
    if (!db.one("SELECT id FROM published_releases WHERE id=?", b.releaseId))
      throw new HttpError(404, "Release not published");
    const m = platform.release(b.releaseId);
    if (
      platform.get(m.storyId).withdrawn ||
      !assets(m).some((a) => a.id === b.assetId)
    )
      throw new HttpError(403, "Media access denied");
    return ticket(m.releaseId, b.assetId);
  });
  app.post("/api/stories/:id/clip-delivery", async (req) => {
    const a = actor(req),
      b = z
        .object({ segmentId: z.string(), revision: z.number().int() })
        .parse(req.body);
    const d = platform.get(id(req));
    platform.read(a, d);
    if (d.revision !== b.revision) throw new HttpError(409, "Revision changed");
    const clip = d.clips[b.segmentId];
    if (!clip) throw new HttpError(404, "Audio missing");
    return ticket(`preview:${d.id}:${d.revision}`, clip.asset.id);
  });
  app.post("/api/stories/:id/delivery", async (req) => {
    const a = actor(req),
      b = z
        .object({ assetId: z.string(), revision: z.number().int() })
        .parse(req.body);
    const m = await platform.preview(a, id(req), b.revision);
    if (!assets(m).some((x) => x.id === b.assetId))
      throw new HttpError(403, "Media access denied");
    return ticket(`preview:${id(req)}:${b.revision}`, b.assetId);
  });
  app.get("/api/covers/:id", async (req, reply) => {
    const assetId = id(req);
    const visible = db
      .all("SELECT data FROM stories")
      .map((r) => JSON.parse(r.data))
      .some(
        (d) =>
          d.visibility !== "hidden" && !d.withdrawn && d.card.cover === assetId,
      );
    if (!visible) throw new HttpError(404, "Cover unavailable");
    const row = db.one("SELECT data FROM assets WHERE id=?", assetId);
    if (!row) throw new HttpError(404, "Cover unavailable");
    reply.type(JSON.parse(row.data).type);
    return createReadStream(platform.media.path(assetId));
  });
  app.get("/media/:id", async (req, reply) => {
    const q = z
      .object({
        scope: z.string(),
        expires: z.coerce.number(),
        signature: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(req.query);
    const expected = signature(q.scope, id(req), q.expires);
    if (
      q.expires < Date.now() ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(q.signature))
    )
      throw new HttpError(403, "Delivery URL expired");
    if (!q.scope.startsWith("preview:")) {
      if (platform.get(platform.release(q.scope).storyId).withdrawn)
        throw new HttpError(403, "Media withdrawn");
    } else {
      const [, storyId, revision] = q.scope.split(":");
      if (platform.get(storyId).revision !== Number(revision))
        throw new HttpError(403, "Preview changed");
    }
    const row = db.one("SELECT data FROM assets WHERE id=?", id(req));
    if (!row) throw new HttpError(404, "Media missing");
    const asset = JSON.parse(row.data),
      etag = `"${asset.id}"`;
    reply
      .header("Accept-Ranges", "bytes")
      .header("ETag", etag)
      .header("Cache-Control", "private, max-age=0")
      .type(asset.type);
    let start = 0,
      end = asset.bytes - 1;
    const range = req.headers.range;
    if (
      range &&
      (!req.headers["if-range"] || req.headers["if-range"] === etag)
    ) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return reply
          .code(416)
          .header("Content-Range", `bytes */${asset.bytes}`)
          .send();
      if (!match[1]) start = Math.max(0, asset.bytes - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (start > end || start >= asset.bytes)
        return reply
          .code(416)
          .header("Content-Range", `bytes */${asset.bytes}`)
          .send();
      reply
        .code(206)
        .header("Content-Range", `bytes ${start}-${end}/${asset.bytes}`);
    }
    reply.header("Content-Length", end - start + 1);
    return createReadStream(platform.media.path(asset.id), { start, end });
  });
  app.get("/api/audit", async (req) => {
    requireRole(actor(req), "admin");
    return db.all("SELECT * FROM audit ORDER BY at DESC LIMIT 500");
  });
  app.post("/api/maintenance/orphans", async (req) => {
    requireRole(actor(req), "admin");
    const keep = new Set<string>();
    for (const row of db.all("SELECT data FROM stories")) {
      const d = JSON.parse(row.data);
      if (d.card.cover) keep.add(d.card.cover);
      Object.values(d.clips).forEach((c: any) => keep.add(c.asset.id));
    }
    for (const row of db.all("SELECT data FROM releases"))
      assets(JSON.parse(row.data)).forEach((a) => keep.add(a.id));
    let removed = 0;
    for (const row of db.all(
      "SELECT id FROM assets WHERE created<?",
      Date.now() - 86400000,
    )) {
      if (!keep.has(row.id)) {
        await unlink(platform.media.path(row.id)).catch(() => {});
        db.run("DELETE FROM assets WHERE id=?", row.id);
        removed++;
      }
    }
    return { removed };
  });
  const staticRoot = fileURLToPath(
    new URL("../../../apps/studio/public/", import.meta.url),
  );
  for (const [route, file, type] of [
    ["/", "index.html", "text/html"],
    ["/studio.js", "studio.js", "text/javascript"],
    ["/studio.css", "studio.css", "text/css"],
  ])
    app.get(route, async (_req, reply) =>
      reply
        .header(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' blob: data:; object-src 'none'; frame-ancestors 'none'",
        )
        .type(type)
        .send(await readFile(`${staticRoot}${file}`)),
    );
  return app;
}
