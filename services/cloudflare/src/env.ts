export type Env = Omit<Cloudflare.Env, "ENABLE_PAID_GENERATION"> & {
  ENABLE_PAID_GENERATION: string;
  SESSION_SECRET: string;
  ELEVENLABS_API_KEY?: string;
  OPENAI_API_KEY?: string;
};
