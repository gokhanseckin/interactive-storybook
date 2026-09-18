import { join } from "node:path";
import { Store } from "./store.ts";
import { Media } from "./media.ts";
import { Platform } from "./platform.ts";
import { createApp } from "./app.ts";
import { Worker } from "./worker.ts";
const environment = process.env.APP_ENV ?? "development";
if (!["development", "staging", "production"].includes(environment))
  throw new Error("Invalid APP_ENV");
const root = process.env.DATA_DIR ?? join(".data", environment);
const secret = process.env.SESSION_SECRET;
if (!secret || secret.startsWith("replace-"))
  throw new Error(
    "Set SESSION_SECRET (32+ random characters); see services/content-api/.env.example",
  );
const store = new Store(join(root, "content.sqlite"));
const platform = new Platform(store, new Media(join(root, "media")));
const app = createApp(platform, {
  secret,
  origin: process.env.PUBLIC_ORIGIN ?? "http://localhost:4400",
  secure: environment !== "development",
});
const worker = new Worker(platform);
worker.recover();
const timer = setInterval(
  () => void worker.tick().catch(() => console.error("Worker tick failed")),
  1000,
);
app.addHook("onClose", async () => {
  clearInterval(timer);
});
await app.listen({
  port: Number(process.env.PORT ?? 4400),
  host: process.env.HOST ?? "127.0.0.1",
});
console.log(`Story Studio listening (${environment})`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void app.close());
