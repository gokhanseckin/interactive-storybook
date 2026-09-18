import { randomUUID } from "node:crypto";
import { generateSpeech } from "../../audio-api/src/elevenlabs.ts";
import { Platform, type Generation } from "./platform.ts";
import { assets } from "@story/contracts";
export type Generator = (
  job: Generation,
) => Promise<{ audio: Buffer; requestId?: string | null }>;
export const providerGenerator: Generator = async (job) => {
  const input = job.input as any;
  if (job.provider === "elevenlabs") {
    if (!process.env.ELEVENLABS_API_KEY)
      throw new Error("ELEVENLABS_API_KEY not configured");
    return generateSpeech(
      {
        text: input.segment.text,
        ttsText: input.segment.ttsText,
        language: input.language,
        voice: input.voice.providerVoice,
        stability: input.voice.stability,
      },
      process.env.ELEVENLABS_API_KEY,
    );
  }
  if (!process.env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY not configured");
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: input.segment.text,
      instructions: input.segment.direction,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) throw new Error("Speech provider rejected generation");
  return {
    audio: Buffer.from(await response.arrayBuffer()),
    requestId: response.headers.get("x-request-id"),
  };
};
export class Worker {
  busy = false;
  constructor(
    public platform: Platform,
    public generate: Generator = providerGenerator,
  ) {}
  // Run once at service startup. A provider request may have billed before process death.
  recover() {
    for (const row of this.platform.store.all(
      "SELECT * FROM jobs WHERE state='running'",
    )) {
      const j = JSON.parse(row.data);
      j.state = "uncertain";
      j.error =
        "Service stopped during generation. Check provider billing before explicitly retrying.";
      this.write(j);
    }
  }
  write(j: Generation) {
    this.platform.store.run(
      "UPDATE jobs SET state=?,data=? WHERE id=?",
      j.state,
      JSON.stringify(j),
      j.id,
    );
  }
  publishing = false;
  async publishDue() {
    if (this.publishing) return;
    this.publishing = true;
    const db = this.platform.store;
    try {
      for (const row of db.all(
        "SELECT * FROM publications WHERE state='scheduled' AND due<=?",
        Date.now(),
      )) {
        try {
          const p = JSON.parse(row.data),
            m = this.platform.release(p.releaseId);
          await Promise.all(
            assets(m).map((a) => this.platform.media.verify(a)),
          );
          db.transaction(() => {
            if (
              db.one("SELECT state FROM publications WHERE id=?", row.id)
                ?.state !== "scheduled"
            )
              return;
            const user = db.one("SELECT roles FROM users WHERE id=?", p.actor);
            if (
              !user ||
              !JSON.parse(user.roles).some(
                (r: string) => r === "admin" || r === "publisher",
              )
            )
              throw new Error("Publisher permission revoked");
            const d = this.platform.get(m.storyId);
            db.run(
              "INSERT OR IGNORE INTO published_releases VALUES(?)",
              m.releaseId,
            );
            d.active[m.locale] = m.releaseId;
            d.visibility = "available";
            d.withdrawn = false;
            this.platform.save(d);
            db.run(
              "UPDATE publications SET state='published' WHERE id=?",
              row.id,
            );
            db.audit(p.actor, "publication.published", m.releaseId);
          });
        } catch {
          db.run(
            "UPDATE publications SET state='failed' WHERE id=? AND state='scheduled'",
            row.id,
          );
        }
      }
    } finally {
      this.publishing = false;
    }
  }
  async tick() {
    // Scheduled activation must not wait for a long narration provider request.
    await this.publishDue();
    if (this.busy) return;
    this.busy = true;
    try {
      const db = this.platform.store;
      const job = db.transaction(() => {
        const row = db.one(
          "SELECT * FROM jobs WHERE state='queued' ORDER BY rowid LIMIT 1",
        );
        if (!row) return null;
        const j: Generation = JSON.parse(row.data);
        j.state = "running";
        j.attempts++;
        this.write(j);
        return j;
      });
      if (!job) return;
      try {
        const user = db.one("SELECT * FROM users WHERE id=?", job.actor);
        if (!user) throw new Error("Creator removed");
        this.platform.access(
          { id: user.id, email: user.email, roles: JSON.parse(user.roles) },
          this.platform.get(job.storyId),
          true,
        );
      } catch {
        job.state = "cancelled";
        job.error = "Creator permission revoked before generation started.";
        this.write(job);
        return;
      }
      try {
        const result = await this.generate(job);
        const asset = await this.platform.media.put(result.audio, "audio/mpeg");
        db.transaction(() => {
          db.run(
            "INSERT OR IGNORE INTO assets VALUES(?,?,?)",
            asset.id,
            JSON.stringify(asset),
            Date.now(),
          );
          const d = this.platform.get(job.storyId);
          if (
            this.platform.fingerprint(d.story, job.segmentId) !==
              job.fingerprint ||
            d.clips[job.segmentId]?.asset.id !== job.baseAsset
          ) {
            job.state = "stale";
          } else {
            d.clips[job.segmentId] = { asset, fingerprint: job.fingerprint };
            d.review = null;
            d.preview = null;
            d.state = "draft";
            d.revision++;
            this.platform.save(d);
            job.state = "complete";
          }
          job.asset = asset;
          job.providerRequestId = result.requestId;
          this.write(job);
          db.audit(job.actor, `generation.${job.state}`, job.id);
        });
      } catch {
        job.state = "uncertain";
        job.error =
          "Generation failed or outcome uncertain. Check credentials/provider usage before authorizing a new attempt.";
        this.write(job);
      }
    } finally {
      this.busy = false;
    }
  }
}
