import { Store } from "./store.ts";
import { join, resolve } from "node:path";
import { cp, mkdir } from "node:fs/promises";
const root = process.env.DATA_DIR ?? ".data/development";
const destination = process.argv[2];
if (!destination) throw new Error("Pass a new backup destination directory");
await mkdir(destination, { recursive: false, mode: 0o700 });
const store = new Store(join(root, "content.sqlite"));
// SQLite VACUUM INTO produces a consistent snapshot even in WAL mode.
store.run("VACUUM INTO ?", resolve(destination, "content.sqlite"));
await cp(join(root, "media"), join(destination, "media"), { recursive: true });
console.log(
  "Database snapshot and immutable media copied. Test restoration before rollout.",
);
