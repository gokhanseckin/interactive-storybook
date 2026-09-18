import { Buffer } from "node:buffer";
import { inspectMedia } from "./inspect.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Asset } from "@story/contracts";
import { HttpError } from "./auth.ts";
export class Media {
  constructor(public root: string) {}
  path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpError(400, "Invalid asset");
    return join(this.root, id);
  }
  inspect = inspectMedia;
  async put(data: Buffer, type: string) {
    const asset = await this.inspect(data, type);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const tmp = join(this.root, `${randomUUID()}.partial`);
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, this.path(asset.id));
    return asset;
  }
  async verify(asset: Asset) {
    const b = await readFile(this.path(asset.id));
    if (
      b.length !== asset.bytes ||
      createHash("sha256").update(b).digest("hex") !== asset.sha256
    )
      throw new HttpError(409, `Asset missing or corrupt: ${asset.id}`);
  }
}
