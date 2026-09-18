import { Buffer } from "node:buffer";
import type { Generation } from "../../content-api/src/platform.ts";
import { Repository } from "./repository.ts";
import { HttpError } from "../../content-api/src/auth.ts";
export type Generate = (
  job: Generation,
) => Promise<{ audio: Buffer; requestId?: string | null }>;

// A durable claim is the billing fence, independent of Workflow replay/checkpoint behavior.
// A running/uncertain job is NEVER automatically submitted to the provider again.
export async function runGeneration(
  repo: Repository,
  id: string,
  generate: Generate,
  enabled: boolean,
) {
  if (!enabled) return "disabled";
  const row = await repo
    .sql("SELECT data,state FROM jobs WHERE id=?", id)
    .first<{ data: string; state: string }>();
  if (!row || row.state !== "queued") return row?.state ?? "missing";
  const job: Generation = JSON.parse(row.data),
    draft = await repo.get(job.storyId);
  let actor;
  try {
    actor = await repo.user(job.actor);
    repo.access(actor, draft, true);
  } catch {
    await repo
      .sql(
        "UPDATE jobs SET state='cancelled',data=json_set(data,'$.state','cancelled') WHERE id=? AND state='queued'",
        id,
      )
      .run();
    return "cancelled";
  }
  job.state = "running";
  job.attempts++;
  try {
    await repo.commit([
      repo.actorGuard(actor),
      repo.draftGuard(draft),
      repo.guard(
        "EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='queued')",
        id,
      ),
      repo.sql(
        "UPDATE jobs SET state='running',data=? WHERE id=?",
        JSON.stringify(job),
        id,
      ),
    ]);
  } catch (e) {
    if (e instanceof HttpError && e.statusCode === 409) return "not-claimed";
    throw e;
  }
  try {
    const result = await generate(job),
      asset = await repo.media.put(result.audio, "audio/mpeg");
    await repo.recordAsset(asset);
    // Retry only metadata CAS, never the paid provider call.
    for (let attempt = 0; attempt < 5; attempt++) {
      const original = await repo.get(job.storyId),
        d = structuredClone(original);
      let same = false;
      try {
        same =
          repo.fingerprint(d.story, job.segmentId) === job.fingerprint &&
          d.clips[job.segmentId]?.asset.id === job.baseAsset;
      } catch {}
      job.state = same ? "complete" : "stale";
      job.asset = asset;
      job.providerRequestId = result.requestId;
      if (same) {
        d.clips[job.segmentId] = { asset, fingerprint: job.fingerprint };
        d.preview = null;
        d.review = null;
        d.state = "draft";
        d.revision++;
      }
      try {
        await repo.commit([
          repo.draftGuard(original),
          repo.guard(
            "EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='running')",
            id,
          ),
          ...(same ? [repo.save(d)] : []),
          repo.sql(
            "UPDATE jobs SET state=?,data=? WHERE id=?",
            job.state,
            JSON.stringify(job),
            id,
          ),
          repo.audit(job.actor, `generation.${job.state}`, id),
        ]);
        return job.state;
      } catch (e) {
        if (!(e instanceof HttpError && e.statusCode === 409)) throw e;
      }
    }
    throw new Error("Metadata changed repeatedly");
  } catch {
    job.state = "uncertain";
    job.error =
      "Provider outcome may have billed. Reconcile provider usage before authorizing a new attempt.";
    await repo
      .sql(
        "UPDATE jobs SET state='uncertain',data=? WHERE id=? AND state='running'",
        JSON.stringify(job),
        id,
      )
      .run();
    return job.state;
  }
}
