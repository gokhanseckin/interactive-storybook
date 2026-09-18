import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import type { Asset } from "@story/contracts";
import { inspectMedia } from "../../content-api/src/inspect.ts";
import { HttpError } from "../../content-api/src/auth.ts";

// Cloudflare Free/Pro request bodies are capped at 100 MB. Keep one byte below that
// decimal limit so the Worker can always return its own structured 413 response.
export const MAX_UPLOAD = 100_000_000 - 1;
export const MAX_BUFFERED_BODY = 10 * 1024 * 1024;
const R2_PART_BYTES = 5 * 1024 * 1024;
const VALIDATION_CHUNK_BYTES = 64 * 1024;
export async function boundedBody(
  request: Pick<Request, "headers" | "body">,
  max = MAX_BUFFERED_BODY,
) {
  const declared = request.headers.get("Content-Length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > max))
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

function assertMediaType(type: string): asserts type is Asset["type"] {
  if (!["audio/mpeg", "image/png", "image/jpeg"].includes(type))
    throw new HttpError(400, "MP3, PNG or JPEG required");
}

function mp3Frame(header: number) {
  const version = (header >>> 19) & 3,
    layer = (header >>> 17) & 3,
    rateIndex = (header >>> 10) & 3,
    bitrateIndex = (header >>> 12) & 15;
  if (
    header >>> 21 !== 0x7ff ||
    version === 1 ||
    layer !== 1 ||
    rateIndex === 3 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15
  )
    throw new HttpError(400, "Invalid MP3 frame");
  const rates = [44100, 48000, 32000],
    bitrates =
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    rate = rates[rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4),
    bytes =
      Math.floor(
        ((version === 3 ? 144 : 72) * bitrates[bitrateIndex] * 1000) / rate,
      ) +
      ((header >>> 9) & 1);
  return { bytes, seconds: (version === 3 ? 1152 : 576) / rate };
}

// Validate every frame while retaining at most one R2 chunk plus one partial frame.
async function inspectMp3Stream(body: ReadableStream, expectedBytes: number) {
  const reader = body.getReader();
  let pending = Buffer.alloc(0),
    bytes = 0,
    frames = 0,
    duration = 0,
    skip = -1,
    tagged = false;
  const consume = (done: boolean) => {
    if (skip < 0) {
      if (pending.length < 10 && !done) return;
      if (pending.subarray(0, 3).toString() === "ID3") {
        if (
          pending.length < 10 ||
          [...pending.subarray(6, 10)].some((n) => n > 127)
        )
          throw new HttpError(400, "Invalid ID3 tag");
        skip =
          10 +
          ((pending[6] << 21) |
            (pending[7] << 14) |
            (pending[8] << 7) |
            pending[9]) +
          (pending[5] & 16 ? 10 : 0);
      } else skip = 0;
    }
    if (skip) {
      const count = Math.min(skip, pending.length);
      pending = pending.subarray(count);
      skip -= count;
      if (skip) {
        if (done) throw new HttpError(400, "Invalid ID3 tag");
        return;
      }
    }
    while (pending.length) {
      if (tagged) throw new HttpError(400, "Data follows MP3 end tag");
      if (pending.subarray(0, 3).toString() === "TAG") {
        if (pending.length < 128 && !done) return;
        if (pending.length < 128)
          throw new HttpError(400, "Truncated MP3 end tag");
        pending = pending.subarray(128);
        tagged = true;
        continue;
      }
      if (pending.length < 4) {
        if (done) throw new HttpError(400, "Truncated MP3 frame");
        return;
      }
      const frame = mp3Frame(pending.readUInt32BE(0));
      if (pending.length < frame.bytes) {
        if (done) throw new HttpError(400, "Truncated MP3 frame");
        return;
      }
      pending = pending.subarray(frame.bytes);
      duration += frame.seconds;
      frames++;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      for (let offset = 0; offset < value.byteLength;) {
        const count = Math.min(
          VALIDATION_CHUNK_BYTES,
          value.byteLength - offset,
        );
        const chunk = Buffer.from(value.subarray(offset, offset + count));
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        consume(false);
        offset += count;
      }
    }
    consume(true);
  } finally {
    reader.releaseLock();
  }
  if (bytes !== expectedBytes)
    throw new HttpError(409, "Staged upload changed");
  if (frames < 2) throw new HttpError(400, "Complete MP3 required");
  return duration;
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
  async ingest(request: Pick<Request, "headers" | "body">, type: string) {
    assertMediaType(type);
    const declared = request.headers.get("Content-Length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_UPLOAD))
      throw new HttpError(413, "Upload exceeds inspection limit");
    if (!request.body) throw new HttpError(400, "Send binary media");

    const stagedKey = `_ingest/${randomUUID()}`,
      hash = createHash("sha256"),
      head = Buffer.alloc(24);
    let bytes = 0,
      headBytes = 0,
      tail = Buffer.alloc(0);
    try {
      const upload = await this.bucket.createMultipartUpload(stagedKey, {
          httpMetadata: { contentType: type },
        }),
        uploaded: R2UploadedPart[] = [],
        reader = request.body.getReader();
      let partChunks: Uint8Array[] = [],
        partBytes = 0,
        complete = false;
      const flush = async () => {
        if (!partBytes) return;
        uploaded.push(
          await upload.uploadPart(
            uploaded.length + 1,
            Buffer.concat(
              partChunks.map((chunk) => Buffer.from(chunk)),
              partBytes,
            ),
          ),
        );
        partChunks = [];
        partBytes = 0;
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_UPLOAD) {
            await reader.cancel();
            throw new HttpError(413, "Upload exceeds inspection limit");
          }
          hash.update(value);
          if (headBytes < head.length) {
            const count = Math.min(head.length - headBytes, value.byteLength);
            head.set(value.subarray(0, count), headBytes);
            headBytes += count;
          }
          tail =
            value.byteLength >= 2
              ? Buffer.from(value.subarray(value.byteLength - 2))
              : Buffer.concat([tail, Buffer.from(value)]).subarray(-2);
          for (let offset = 0; offset < value.byteLength;) {
            const count = Math.min(
              R2_PART_BYTES - partBytes,
              value.byteLength - offset,
            );
            partChunks.push(value.subarray(offset, offset + count));
            partBytes += count;
            offset += count;
            if (partBytes === R2_PART_BYTES) await flush();
          }
        }
        await flush();
        if (!uploaded.length)
          throw new HttpError(400, "File size must be at least 1 byte");
        await upload.complete(uploaded);
        complete = true;
      } finally {
        reader.releaseLock();
        if (!complete) await upload.abort();
      }
      if (!bytes) throw new HttpError(400, "File size must be at least 1 byte");
      if (declared && Number(declared) !== bytes)
        throw new HttpError(400, "Content-Length does not match upload");

      let duration = 0;
      if (type === "audio/mpeg") {
        const staged = await this.bucket.get(stagedKey);
        if (!staged || staged.size !== bytes)
          throw new HttpError(409, "Staged upload changed");
        duration = await inspectMp3Stream(staged.body, bytes);
      } else if (
        type === "image/png" &&
        (headBytes < 24 ||
          head.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      )
        throw new HttpError(400, "Invalid PNG");
      else if (
        type === "image/jpeg" &&
        (headBytes < 2 ||
          head[0] !== 255 ||
          head[1] !== 216 ||
          tail[0] !== 255 ||
          tail[1] !== 217)
      )
        throw new HttpError(400, "Invalid JPEG");

      const id = hash.digest("hex"),
        asset: Asset = { id, sha256: id, bytes, duration, type };
      const existing = await this.bucket.head(id);
      if (!existing) {
        const staged = await this.bucket.get(stagedKey);
        if (!staged || staged.size !== bytes)
          throw new HttpError(409, "Staged upload changed");
        const copy = await this.bucket.createMultipartUpload(id, {
            httpMetadata: { contentType: asset.type },
            customMetadata: { sha256: asset.sha256 },
          }),
          copied: R2UploadedPart[] = [],
          copyHash = createHash("sha256"),
          reader = staged.body.getReader();
        let copyChunks: Uint8Array[] = [],
          copyBytes = 0,
          totalCopied = 0,
          complete = false;
        const flush = async () => {
          if (!copyBytes) return;
          copied.push(
            await copy.uploadPart(
              copied.length + 1,
              Buffer.concat(
                copyChunks.map((chunk) => Buffer.from(chunk)),
                copyBytes,
              ),
            ),
          );
          copyChunks = [];
          copyBytes = 0;
        };
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalCopied += value.byteLength;
            copyHash.update(value);
            for (let offset = 0; offset < value.byteLength;) {
              const count = Math.min(
                R2_PART_BYTES - copyBytes,
                value.byteLength - offset,
              );
              copyChunks.push(value.subarray(offset, offset + count));
              copyBytes += count;
              offset += count;
              if (copyBytes === R2_PART_BYTES) await flush();
            }
          }
          await flush();
          if (
            totalCopied !== asset.bytes ||
            copyHash.digest("hex") !== asset.sha256
          )
            throw new HttpError(409, "Staged upload changed");
          await copy.complete(copied);
          complete = true;
        } finally {
          reader.releaseLock();
          if (!complete) await copy.abort();
        }
      }
      await this.verify(asset);
      return asset;
    } finally {
      await this.bucket.delete(stagedKey);
    }
  }
  async verify(asset: Asset) {
    const object = await this.bucket.head(asset.id);
    const checksum = object?.checksums.sha256
      ? Buffer.from(object.checksums.sha256).toString("hex")
      : object?.customMetadata?.sha256;
    if (!object || object.size !== asset.bytes || checksum !== asset.sha256)
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
