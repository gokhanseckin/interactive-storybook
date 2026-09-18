import { HttpError } from "./auth.ts";
// Validate complete MPEG layer III frames, including VBR. No seconds→bytes approximation.
export function validateMp3Frames(data: Buffer) {
  let offset = 0,
    frames = 0;
  if (data.subarray(0, 3).toString() === "ID3") {
    if (data.length < 10 || [...data.subarray(6, 10)].some((n) => n > 127))
      throw new HttpError(400, "Invalid ID3 tag");
    const size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9];
    offset = 10 + size + (data[5] & 16 ? 10 : 0);
  }
  while (offset < data.length) {
    if (
      data.length - offset === 128 &&
      data.subarray(offset, offset + 3).toString() === "TAG"
    )
      break;
    if (data.length - offset < 4)
      throw new HttpError(400, "Truncated MP3 frame");
    const h = data.readUInt32BE(offset),
      version = (h >>> 19) & 3,
      layer = (h >>> 17) & 3,
      rateIndex = (h >>> 10) & 3,
      bitrateIndex = (h >>> 12) & 15;
    if (
      h >>> 21 !== 0x7ff ||
      version === 1 ||
      layer !== 1 ||
      rateIndex === 3 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15
    )
      throw new HttpError(400, "Invalid MP3 frame");
    const rates = [44100, 48000, 32000];
    const bitrates =
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const rate = rates[rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const size =
      Math.floor(
        ((version === 3 ? 144 : 72) * bitrates[bitrateIndex] * 1000) / rate,
      ) +
      ((h >>> 9) & 1);
    if (offset + size > data.length)
      throw new HttpError(400, "Truncated MP3 frame");
    offset += size;
    frames++;
  }
  if (frames < 2) throw new HttpError(400, "Complete MP3 required");
}
