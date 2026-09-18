export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  GENERATION: Workflow<{ jobId: string }>;
  ENVIRONMENT: string;
  ORIGIN: string;
  SESSION_SECRET: string;
  ENABLE_PAID_GENERATION: string;
  ELEVENLABS_API_KEY?: string;
  OPENAI_API_KEY?: string;
}
