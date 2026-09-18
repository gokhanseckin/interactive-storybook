import { Buffer } from "node:buffer";
import { validateMp3Frames } from "./mp3.ts";
import { createHash } from "node:crypto";
import { parseBuffer } from "music-metadata";
import type { Asset } from "@story/contracts";
import { HttpError } from "./auth.ts";
export async function inspectMedia(data: Buffer, type: string): Promise<Asset> {
  if (!data.length || data.length > 100 * 1024 * 1024)
    throw new HttpError(400, "File size must be 1 byte–100 MB");
  let duration = 0;
  if (type === "audio/mpeg") {
    validateMp3Frames(data);
    let metadata;
    try {
      metadata = await parseBuffer(
        data,
        { mimeType: type },
        { duration: true },
      );
    } catch {
      throw new HttpError(400, "Invalid MP3");
    }
    if (
      metadata.format.container !== "MPEG" ||
      !metadata.format.duration ||
      metadata.format.duration <= 0
    )
      throw new HttpError(
        400,
        "Complete MP3 with measurable duration required",
      );
    duration = metadata.format.duration;
  } else if (type === "image/png") {
    if (
      data.length < 24 ||
      data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      throw new HttpError(400, "Invalid PNG");
  } else if (type === "image/jpeg") {
    if (
      data[0] !== 255 ||
      data[1] !== 216 ||
      data.at(-2) !== 255 ||
      data.at(-1) !== 217
    )
      throw new HttpError(400, "Invalid JPEG");
  } else throw new HttpError(400, "MP3, PNG or JPEG required");
  const id = createHash("sha256").update(data).digest("hex");
  return {
    id,
    sha256: id,
    bytes: data.length,
    duration,
    type: type as Asset["type"],
  };
}
