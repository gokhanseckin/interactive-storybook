import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { handle } from "./api.ts";
import type { Env } from "./env.ts";
import { Repository } from "./repository.ts";
import { R2Media, boundedBody } from "./media.ts";
import { runGeneration, type Generate } from "./generation.ts";
import {
  buildSpeechRequest,
  TtsRequestSchema,
  OUTPUT_FORMAT,
} from "../../audio-api/src/elevenlabs.ts";

export class NarrationWorkflow extends WorkflowEntrypoint<
  Env,
  { jobId: string }
> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    // No Workflow retry around a provider call. D1's claim also fences replay/manual restart.
    return step.do(
      "generate-once",
      { retries: { limit: 0, delay: "1 second" }, timeout: "10 minutes" },
      async () => {
        const generate: Generate = async (job) => {
          const input = job.input as {
            segment: { text: string; ttsText?: string; direction?: string };
            language: string;
            voice: { providerVoice?: string; stability?: 0 | 0.5 | 1 };
          };
          let response: Response;
          if (job.provider === "elevenlabs") {
            if (!this.env.ELEVENLABS_API_KEY)
              throw new Error("Provider not configured");
            const parsed = TtsRequestSchema.parse({
              text: input.segment.text,
              ttsText: input.segment.ttsText,
              language: input.language,
              voice: input.voice.providerVoice,
              stability: input.voice.stability,
            });
            response = await fetch(
              `https://api.elevenlabs.io/v1/text-to-speech/${parsed.voice}?output_format=${OUTPUT_FORMAT}`,
              {
                method: "POST",
                headers: {
                  "xi-api-key": this.env.ELEVENLABS_API_KEY,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(buildSpeechRequest(parsed)),
                signal: AbortSignal.timeout(300000),
              },
            );
          } else {
            if (!this.env.OPENAI_API_KEY)
              throw new Error("Provider not configured");
            response = await fetch("https://api.openai.com/v1/audio/speech", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
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
          }
          if (!response.ok) throw new Error("Provider rejected generation");
          // Bound even a misbehaving provider response, before full-file validation.
          const audio = await boundedBody(response);
          return {
            audio,
            requestId:
              response.headers.get("request-id") ??
              response.headers.get("x-request-id"),
          };
        };
        return runGeneration(
          new Repository(this.env.DB, new R2Media(this.env.MEDIA)),
          event.payload.jobId,
          generate,
          this.env.ENABLE_PAID_GENERATION === "true",
        );
      },
    );
  }
}
export default {
  fetch: handle,
  async scheduled(_event, env) {
    const repo = new Repository(env.DB, new R2Media(env.MEDIA));
    await repo.publishDue();
    await repo
      .sql("DELETE FROM login_attempts WHERE until<?", Date.now())
      .run();
    await repo.sql("DELETE FROM sessions WHERE expires<?", Date.now()).run();
    if (env.ENABLE_PAID_GENERATION !== "true") return;
    // The D1 job is the outbox; use its stable ID when recovering a failed Workflow create.
    for (const row of await repo.rows(
      "SELECT id FROM jobs WHERE state='queued' LIMIT 10",
    )) {
      try {
        await env.GENERATION.create({ id: row.id, params: { jobId: row.id } });
      } catch {}
    }
    // Only terminal Workflow failure may mark a billing claim uncertain. Never steal live work.
    for (const row of await repo.rows(
      "SELECT id FROM jobs WHERE state='running' LIMIT 10",
    )) {
      const instance = await env.GENERATION.get(row.id),
        state = await instance.status();
      if (["errored", "terminated", "complete"].includes(state.status))
        await repo
          .sql(
            "UPDATE jobs SET state='uncertain',data=json_set(data,'$.state','uncertain','$.error','Workflow ended after billing claim; reconcile provider usage before a new attempt') WHERE id=? AND state='running'",
            row.id,
          )
          .run();
    }
  },
} satisfies ExportedHandler<Env>;
