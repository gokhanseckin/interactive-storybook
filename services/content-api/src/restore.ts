import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AssetSchema, ManifestSchema, assets } from "@story/contracts";
import { Media } from "./media.ts";

const [source, destination] = process.argv.slice(2);
if (!source || !destination || resolve(source) === resolve(destination))
  throw new Error("Pass a backup source and a new restore destination");
// Verify before copying. Never overwrite a live environment.
const backup = new DatabaseSync(join(source, "content.sqlite"), {
  readOnly: true,
});
try {
  const integrity = backup.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok")
    throw new Error("Backup database failed integrity check");
  if (backup.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Backup contains broken references");
  const media = new Media(join(source, "media"));
  for (const row of backup.prepare("SELECT data FROM assets").all())
    await media.verify(AssetSchema.parse(JSON.parse(String(row.data))));
  for (const row of backup.prepare("SELECT data FROM releases").all()) {
    const manifest = ManifestSchema.parse(JSON.parse(String(row.data)));
    for (const asset of assets(manifest)) await media.verify(asset);
  }
} finally {
  backup.close();
}
await mkdir(destination, { recursive: false, mode: 0o700 });
try {
  await cp(join(source, "content.sqlite"), join(destination, "content.sqlite"));
  await cp(join(source, "media"), join(destination, "media"), {
    recursive: true,
  });
  const restored = new DatabaseSync(join(destination, "content.sqlite"));
  // A restored environment requires a fresh login. No server/worker is launched.
  restored.exec("DELETE FROM sessions");
  restored.close();
  console.log(
    "Verified database, release manifests and every media checksum; restored with sessions revoked. Review pending schedules before starting the worker.",
  );
} catch (error) {
  await rm(destination, { recursive: true, force: true });
  throw error;
}
