import { Buffer } from "node:buffer";
import type { Asset } from "@story/contracts";
import { inspectMedia } from "../../content-api/src/inspect.ts";
import { HttpError } from "../../content-api/src/auth.ts";

// Conservative local preparation cap, not a claim that inspection fits Workers Free CPU.
export const MAX_UPLOAD = 10 * 1024 * 1024;
export async function boundedBody(
  request: Pick<Request, "headers" | "body">,
  max = MAX_UPLOAD,
) {
  if (Number(request.headers.get("Content-Length")) > max)
    throw new HttpError(413, "Upload exceeds inspection limit");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Send binary media");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > max) {
        await reader.cancel();
        throw new HttpError(413, "Upload exceeds inspection limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}
export class R2Media {
  constructor(public bucket: R2Bucket) {}
  async put(data: Buffer, type: string) {
    if (data.length > MAX_UPLOAD)
      throw new HttpError(413, "Upload exceeds inspection limit");
    const asset = await inspectMedia(data, type);
    // Content addressed objects are write-once. R2 validates the supplied digest on upload.
    await this.bucket.put(asset.id, new Uint8Array(data), {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: asset.sha256,
      httpMetadata: { contentType: asset.type },
    });
    await this.verify(asset);
    return asset;
  }
  async verify(asset: Asset) {
    const object = await this.bucket.head(asset.id);
    if (
      !object ||
      object.size !== asset.bytes ||
      !object.checksums.sha256 ||
      Buffer.from(object.checksums.sha256).toString("hex") !== asset.sha256
    )
      throw new HttpError(409, `Asset missing or corrupt: ${asset.id}`);
  }
  async serve(request: Request, asset: Asset) {
    await this.verify(asset);
    const etag = `"${asset.id}"`,
      headers = new Headers({
        "Content-Type": asset.type,
        "Accept-Ranges": "bytes",
        ETag: etag,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
    let start = 0,
      end = asset.bytes - 1,
      status = 200;
    const range = request.headers.get("Range");
    if (
      range &&
      (!request.headers.has("If-Range") ||
        request.headers.get("If-Range") === etag)
    ) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${asset.bytes}` },
        });
      if (!m[1]) start = Math.max(0, asset.bytes - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2]) end = Math.min(end, Number(m[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= asset.bytes
      )
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${asset.bytes}` },
        });
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${asset.bytes}`);
    }
    headers.set("Content-Length", String(end - start + 1));
    if (request.method === "HEAD")
      return new Response(null, { status, headers });
    const object = await this.bucket.get(asset.id, {
      range: { offset: start, length: end - start + 1 },
    });
    if (!object) throw new HttpError(404, "Media missing");
    return new Response(object.body, { status, headers });
  }
}
