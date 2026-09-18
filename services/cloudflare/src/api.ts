import { Buffer } from "node:buffer";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assets, CardSchema, StorySchema, type Asset } from "@story/contracts";
import {
  HttpError,
  passwordMatches,
  requireRole,
  tokenHash,
  type Actor,
} from "../../content-api/src/auth.ts";
import { Repository } from "./repository.ts";
import { boundedBody, R2Media } from "./media.ts";
import type { Env } from "./env.ts";

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (!path.startsWith("/api/") && !path.startsWith("/media/"))
    return env.ASSETS.fetch(request);
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers });
  try {
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
      throw new HttpError(503, "Server secret not configured");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      request.headers.has("Origin") &&
      request.headers.get("Origin") !== env.ORIGIN
    )
      throw new HttpError(403, "Origin denied");
    const repo = new Repository(env.DB, new R2Media(env.MEDIA));
    const token =
      request.headers.get("Authorization")?.replace(/^Bearer /, "") ||
      request.headers.get("Cookie")?.match(/(?:^|;\s*)studio=([^;]+)/)?.[1];
    const actor = async (): Promise<Actor> => {
      if (!token) throw new HttpError(401, "Sign in required");
      const row = await repo
        .sql(
          "SELECT u.id,u.email,u.roles FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
          tokenHash(token),
          Date.now(),
        )
        .first<{ id: string; email: string; roles: string }>();
      if (!row) throw new HttpError(401, "Session expired");
      return { ...row, roles: JSON.parse(row.roles) };
    };
    const body = async () =>
      z
        .record(z.string(), z.unknown())
        .parse(
          JSON.parse((await boundedBody(request, 1024 * 1024)).toString()),
        );
    const revision = (b: Record<string, unknown>) =>
      z.number().int().positive().parse(b.revision);
    const signature = (scope: string, id: string, expires: number) =>
      createHmac("sha256", env.SESSION_SECRET)
        .update(`${scope}:${id}:${expires}`)
        .digest("hex");
    const ticket = (scope: string, id: string) => {
      const expires = Date.now() + 15 * 60000;
      return {
        url: `${env.ORIGIN}/media/${id}?scope=${encodeURIComponent(scope)}&expires=${expires}&signature=${signature(scope, id, expires)}`,
        expires,
      };
    };
    const publicRelease = async (id: string) => {
      if (
        !(await repo
          .sql("SELECT id FROM published_releases WHERE id=?", id)
          .first())
      )
        throw new HttpError(404, "Release not published");
      const m = await repo.release(id);
      if ((await repo.get(m.storyId)).withdrawn)
        throw new HttpError(403, "New online playback is withdrawn");
      return m;
    };
    if (path === "/api/login" && method === "POST") {
      const b = z
        .object({
          email: z.string().email(),
          password: z.string().min(1).max(1024),
          mobile: z.boolean().optional(),
        })
        .parse(await body());
      // Durable per-IP limiter. Hash IP; do not log it or any child activity.
      const key = tokenHash(request.headers.get("CF-Connecting-IP") ?? "local");
      const now = Date.now();
      const attempt = await repo
        .sql(
          "INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN until>? THEN count+1 ELSE 1 END,until=CASE WHEN until>? THEN until ELSE ? END RETURNING count",
          key,
          now + 60000,
          now,
          now,
          now + 60000,
        )
        .first<{ count: number }>();
      if (attempt!.count > 8) throw new HttpError(429, "Try again later");
      const row = await repo
        .sql("SELECT * FROM users WHERE email=?", b.email.toLowerCase())
        .first<{
          id: string;
          email: string;
          roles: string;
          password: string;
        }>();
      if (!row || !passwordMatches(b.password, row.password))
        throw new HttpError(401, "Invalid email or password");
      const fresh = randomBytes(32).toString("hex");
      await repo.commit([
        repo.guard(
          "EXISTS(SELECT 1 FROM users WHERE id=? AND password=? AND roles=?)",
          row.id,
          row.password,
          row.roles,
        ),
        repo.sql(
          "INSERT INTO sessions VALUES(?,?,?)",
          tokenHash(fresh),
          row.id,
          now + 8 * 3600000,
        ),
      ]);
      headers.set(
        "Set-Cookie",
        `studio=${fresh}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${env.ENVIRONMENT === "local" ? "" : "; Secure"}`,
      );
      return json({
        user: { id: row.id, email: row.email, roles: JSON.parse(row.roles) },
        ...(b.mobile ? { token: fresh } : {}),
      });
    }
    if (path === "/api/logout" && method === "POST") {
      await actor();
      await repo
        .sql("DELETE FROM sessions WHERE token=?", tokenHash(token!))
        .run();
      headers.set(
        "Set-Cookie",
        "studio=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
      return json({ ok: true });
    }
    if (path === "/api/me" && method === "GET") return json(await actor());
    if (path === "/api/catalog" && method === "GET")
      return json(
        (
          await repo.rows(
            "SELECT data FROM stories WHERE json_extract(data,'$.visibility')!='hidden' AND json_extract(data,'$.withdrawn')=0",
          )
        ).map((r) => {
          const d = JSON.parse(r.data);
          return {
            id: d.id,
            card: d.card,
            visibility: d.visibility,
            releases: d.visibility === "available" ? d.active : {},
          };
        }),
      );
    if (path === "/api/stories") {
      const a = await actor();
      if (method === "POST")
        return json(await repo.create(a, (await body()).story));
      if (method === "GET")
        return json(
          (await repo.rows("SELECT data FROM stories"))
            .map((r) => JSON.parse(r.data))
            .filter((d) => {
              try {
                repo.read(a, d);
                return true;
              } catch {
                return false;
              }
            }),
        );
    }
    const storyMatch = /^\/api\/stories\/([^/]+)(?:\/([^/]+))?$/.exec(path);
    if (storyMatch) {
      const [, id, action] = storyMatch,
        a = await actor();
      if (method === "GET" && !action) {
        const d = await repo.get(id);
        repo.read(a, d);
        return json({
          ...d,
          errors: repo.readiness(d),
          jobs: (
            await repo.rows("SELECT data FROM jobs WHERE story_id=?", id)
          ).map((r) => JSON.parse(r.data)),
          releases: (
            await repo.rows("SELECT data FROM releases WHERE story_id=?", id)
          ).map((r) => JSON.parse(r.data)),
          publications: await repo.rows(
            "SELECT * FROM publications WHERE story_id=?",
            id,
          ),
        });
      }
      if (method === "POST" && action === "assets") {
        const d = await repo.get(id);
        repo.access(a, d, true);
        const rev = z.coerce
            .number()
            .int()
            .positive()
            .parse(url.searchParams.get("revision")),
          segmentId = url.searchParams.get("segmentId"),
          type = request.headers.get("Content-Type") ?? "";
        if (d.revision !== rev) throw new HttpError(409, "Revision changed");
        if (segmentId ? type !== "audio/mpeg" : type === "audio/mpeg")
          throw new HttpError(400, "Select the matching media destination");
        const asset = await repo.media.put(await boundedBody(request), type);
        await repo.recordAsset(asset);
        return json(
          await repo.change(
            a,
            id,
            rev,
            "draft.upload",
            (d) => {
              if (segmentId)
                d.clips[segmentId] = {
                  asset,
                  fingerprint: repo.fingerprint(d.story, segmentId),
                };
              else d.card.cover = asset.id;
            },
            true,
          ),
        );
      }
      if (method !== "POST" && method !== "PUT")
        throw new HttpError(405, "Method not allowed");
      const b = await body();
      if (method === "PUT" && !action)
        return json(
          await repo.change(
            a,
            id,
            revision(b),
            "draft.edit",
            (d) => {
              if (b.story) {
                const s = StorySchema.parse(b.story);
                if (s.id !== id)
                  throw new HttpError(400, "Stable story ID cannot change");
                d.story = s;
              }
              if (b.card) d.card = CardSchema.parse(b.card);
            },
            true,
          ),
        );
      if (action === "preview")
        return json(await repo.preview(a, id, revision(b)));
      if (action === "previewed") {
        await repo.preview(a, id, revision(b));
        return json(
          await repo.change(a, id, revision(b), "draft.previewed", (d) => {
            repo.read(a, d);
            d.preview = { revision: d.revision, actor: a.id };
            d.state = "in-review";
          }),
        );
      }
      if (action === "review") {
        requireRole(a, "publisher");
        return json(
          await repo.change(a, id, revision(b), "draft.review", (d) => {
            if (d.preview?.revision !== d.revision || repo.readiness(d).length)
              throw new HttpError(
                409,
                "Preview this exact ready revision first",
              );
            d.review = { revision: d.revision, actor: a.id };
            d.state = "ready";
          }),
        );
      }
      if (action === "releases")
        return json(await repo.candidate(a, id, revision(b)));
      if (action === "visibility") {
        requireRole(a, "publisher");
        const v = z
          .object({
            visibility: z.enum(["hidden", "coming-soon", "available"]),
            withdrawn: z.boolean().optional(),
          })
          .parse(b);
        return json(
          await repo.change(a, id, undefined, "catalog.visibility", (d) => {
            if (v.visibility !== "hidden") CardSchema.parse(d.card);
            if (v.visibility === "available" && !Object.keys(d.active).length)
              throw new HttpError(409, "Publish a complete release first");
            d.visibility = v.visibility;
            if (v.withdrawn !== undefined) d.withdrawn = v.withdrawn;
          }),
        );
      }
      if (action === "access") {
        requireRole(a, "admin");
        const editors = z.array(z.string()).parse(b.editors);
        for (const user of editors) await repo.user(user);
        return json(
          await repo.change(a, id, undefined, "story.access", (d) => {
            d.editors = editors;
          }),
        );
      }
      if (action === "jobs") {
        const j = z
          .object({
            revision: z.number().int().positive(),
            segmentId: z.string(),
            provider: z.enum(["elevenlabs", "openai"]),
            key: z.string().min(1).max(100),
            authorizePaidGeneration: z.boolean(),
          })
          .parse(b);
        if (env.ENABLE_PAID_GENERATION !== "true")
          throw new HttpError(
            403,
            "Paid generation is disabled in this environment",
          );
        const job = await repo.enqueue(
          a,
          id,
          j.revision,
          j.segmentId,
          j.provider,
          j.key,
          j.authorizePaidGeneration,
        );
        // Durable DB row is also the outbox. Cron redelivers the SAME Workflow ID if create fails.
        try {
          await env.GENERATION.create({
            id: job.id,
            params: { jobId: job.id },
          });
        } catch {}
        return json(job);
      }
      if (action === "clip-delivery") {
        const d = await repo.get(id);
        repo.read(a, d);
        if (d.revision !== revision(b))
          throw new HttpError(409, "Revision changed");
        const c = d.clips[z.string().parse(b.segmentId)];
        if (!c) throw new HttpError(404, "Audio missing");
        return json(ticket(`preview:${id}:${d.revision}`, c.asset.id));
      }
      if (action === "delivery") {
        const m = await repo.preview(a, id, revision(b)),
          assetId = z.string().parse(b.assetId);
        if (!assets(m).some((x) => x.id === assetId))
          throw new HttpError(403, "Media access denied");
        return json(ticket(`preview:${id}:${m.revision}`, assetId));
      }
    }
    const releaseMatch =
      /^\/api\/releases\/([^/]+)(?:\/(activate|schedule))?$/.exec(path);
    if (releaseMatch) {
      const [, id, action] = releaseMatch;
      if (method === "GET" && !action) return json(await publicRelease(id));
      if (method === "POST") {
        const a = await actor();
        requireRole(a, "publisher");
        if (action === "activate") return json(await repo.activate(a, id));
        if (action === "schedule") {
          const b = z
            .object({
              at: z.string().datetime({ offset: true }),
              timeZone: z.string(),
              key: z.string().min(1).max(100),
            })
            .parse(await body());
          try {
            new Intl.DateTimeFormat("en", { timeZone: b.timeZone });
          } catch {
            throw new HttpError(400, "Invalid time zone");
          }
          const due = Date.parse(b.at);
          if (due <= Date.now())
            throw new HttpError(400, "Schedule must be in the future");
          const m = await repo.release(id),
            pid = tokenHash(`${id}:${b.key}`);
          await repo.commit([
            repo.actorGuard(a),
            repo.sql(
              "INSERT OR IGNORE INTO publications VALUES(?,?,?,?,?)",
              pid,
              m.storyId,
              "scheduled",
              due,
              JSON.stringify({
                releaseId: id,
                actor: a.id,
                timeZone: b.timeZone,
              }),
            ),
            repo.audit(a.id, "publication.schedule", pid),
          ]);
          return json(
            await repo
              .sql("SELECT * FROM publications WHERE id=?", pid)
              .first(),
          );
        }
      }
    }
    const cancel = /^\/api\/publications\/([^/]+)\/cancel$/.exec(path);
    if (cancel && method === "POST") {
      const a = await actor();
      requireRole(a, "publisher");
      await repo.commit([
        repo.actorGuard(a),
        repo.sql(
          "UPDATE publications SET state='cancelled' WHERE id=? AND state='scheduled'",
          cancel[1],
        ),
        repo.audit(a.id, "publication.cancel", cancel[1]),
      ]);
      return json({ ok: true });
    }
    if (path === "/api/delivery" && method === "POST") {
      const b = z
          .object({ releaseId: z.string(), assetId: z.string() })
          .parse(await body()),
        m = await publicRelease(b.releaseId);
      if (!assets(m).some((x) => x.id === b.assetId))
        throw new HttpError(403, "Media access denied");
      return json(ticket(b.releaseId, b.assetId));
    }
    const cover = /^\/api\/covers\/([a-f0-9]{64})$/.exec(path);
    if (cover && ["GET", "HEAD"].includes(method)) {
      if (
        !(await repo
          .sql(
            "SELECT id FROM stories WHERE json_extract(data,'$.visibility')!='hidden' AND json_extract(data,'$.withdrawn')=0 AND json_extract(data,'$.card.cover')=? LIMIT 1",
            cover[1],
          )
          .first())
      )
        throw new HttpError(404, "Cover unavailable");
      const row = await repo
        .sql("SELECT data FROM assets WHERE id=?", cover[1])
        .first<{ data: string }>();
      if (!row) throw new HttpError(404, "Cover unavailable");
      return await repo.media.serve(request, JSON.parse(row.data));
    }
    const media = /^\/media\/([a-f0-9]{64})$/.exec(path);
    if (media && ["GET", "HEAD"].includes(method)) {
      const q = z
        .object({
          scope: z.string(),
          expires: z.coerce.number().finite(),
          signature: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(Object.fromEntries(url.searchParams));
      if (
        q.expires <= Date.now() ||
        !timingSafeEqual(
          Buffer.from(signature(q.scope, media[1], q.expires)),
          Buffer.from(q.signature),
        )
      )
        throw new HttpError(403, "Delivery URL expired");
      let allowed: Asset[];
      if (q.scope.startsWith("preview:")) {
        const [, id, rev] = q.scope.split(":"),
          d = await repo.get(id);
        if (d.revision !== Number(rev))
          throw new HttpError(403, "Preview changed");
        allowed = Object.values(d.clips).map((c) => c.asset);
        if (d.card.cover) {
          const r = await repo
            .sql("SELECT data FROM assets WHERE id=?", d.card.cover)
            .first<{ data: string }>();
          if (r) allowed.push(JSON.parse(r.data));
        }
      } else allowed = assets(await publicRelease(q.scope));
      const asset = allowed.find((a) => a.id === media[1]);
      if (!asset) throw new HttpError(403, "Media access denied");
      return await repo.media.serve(request, asset);
    }
    if (path === "/api/users" && method === "GET") {
      requireRole(await actor(), "admin");
      return json(
        (
          await repo
            .sql("SELECT id,email,roles FROM users")
            .all<{ id: string; email: string; roles: string }>()
        ).results.map((r) => ({ ...r, roles: JSON.parse(r.roles) })),
      );
    }
    const roles = /^\/api\/users\/([^/]+)\/roles$/.exec(path);
    if (roles && method === "PUT") {
      const a = await actor();
      requireRole(a, "admin");
      const values = z
        .array(z.enum(["creator", "publisher", "admin"]))
        .parse((await body()).roles);
      if (a.id === roles[1] && !values.includes("admin"))
        throw new HttpError(409, "Cannot remove your own admin role");
      await repo.commit([
        repo.actorGuard(a),
        repo.sql(
          "UPDATE users SET roles=? WHERE id=?",
          JSON.stringify(values),
          roles[1],
        ),
        repo.sql("DELETE FROM sessions WHERE user_id=?", roles[1]),
        repo.audit(a.id, "user.roles", roles[1]),
      ]);
      return json({ ok: true });
    }
    if (path === "/api/audit" && method === "GET") {
      requireRole(await actor(), "admin");
      return json(
        await repo.rows("SELECT * FROM audit ORDER BY at DESC LIMIT 500"),
      );
    }
    throw new HttpError(404, "Route not found");
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("\n"),
        },
        400,
      );
    if (e instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
    return json(
      { error: e instanceof HttpError ? e.message : "Request failed" },
      e instanceof HttpError ? e.statusCode : 500,
    );
  }
}
