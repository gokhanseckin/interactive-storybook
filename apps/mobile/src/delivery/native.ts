import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FS from "expo-file-system/legacy";
import { File } from "expo-file-system";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { AppState } from "react-native";
import * as Network from "expo-network";
import NativeStorage, { type TransferSpec } from "../../modules/story-storage";
import { DownloadQueue, type Inventory, type TransferAdapter } from "./queue";
import { delivery } from "./client";
import { metric } from "./metrics";
import type { Asset } from "@story/contracts";
let instance: Promise<DownloadQueue> | undefined;
const extension = (asset: Asset): "mp3" | "png" | "jpg" =>
  asset.type === "audio/mpeg"
    ? "mp3"
    : asset.type === "image/png"
      ? "png"
      : "jpg";
async function verified(asset: Asset, path: string) {
  try {
    const info = await FS.getInfoAsync(path);
    if (!info.exists || info.size !== asset.bytes) return false;
    const handle = new File(path).open();
    const hash = sha256.create();
    try {
      let remaining = asset.bytes;
      while (remaining > 0) {
        const data = handle.readBytes(Math.min(256 * 1024, remaining));
        if (!data.length) return false;
        hash.update(data);
        remaining -= data.length;
      }
    } finally {
      handle.close();
    }
    return bytesToHex(hash.digest()) === asset.sha256;
  } catch {
    return false;
  }
}
export function downloads(): Promise<DownloadQueue> {
  return (instance ??= (async () => {
    const root = await NativeStorage.root();
    let generation = 0;
    let allowed = new Set<string>();
    const specs = new Map<string, TransferSpec>();
    const submitted = new Set<string>();
    const adapter: TransferAdapter = {
      async save(state) {
        await AsyncStorage.setItem(
          "@story/downloads-v1",
          JSON.stringify(state),
        );
      },
      exists: verified,
      async retain(ids) {
        generation++;
        allowed = new Set(ids);
        for (const id of submitted) if (!allowed.has(id)) submitted.delete(id);
        await NativeStorage.retain(ids);
      },
      async plan(items) {
        const version = generation;
        const permitted = new Set(items.map((t) => t.asset.id));
        allowed = permitted;
        await NativeStorage.retain([...permitted]);
        for (const t of items) {
          const previous = specs.get(t.asset.id);
          if (
            submitted.has(t.asset.id) &&
            previous?.wifiOnly === t.wifiOnly &&
            previous?.urgent === t.urgent
          )
            continue;
          if (previous && previous.wifiOnly !== t.wifiOnly)
            await NativeStorage.pause(t.asset.id);
          if (version !== generation || !allowed.has(t.asset.id)) return;
          const status = await NativeStorage.status(t.asset.id);
          if (
            status.state === "complete" &&
            (await verified(
              t.asset,
              root + t.asset.id + "." + extension(t.asset),
            ))
          )
            continue;
          if (status.state === "complete") {
            await NativeStorage.forget(t.asset.id);
            await FS.deleteAsync(root + t.asset.id + "." + extension(t.asset), {
              idempotent: true,
            });
          }
          const ticket = await delivery(t.manifest, t.asset.id);
          if (version !== generation || !allowed.has(t.asset.id)) return;
          const spec = {
            id: t.asset.id,
            bytes: t.asset.bytes,
            extension: extension(t.asset),
            url: ticket.url,
            wifiOnly: t.wifiOnly,
            urgent: t.urgent,
          };
          specs.set(t.asset.id, spec);
          submitted.add(t.asset.id);
          await NativeStorage.enqueue(spec);
        }
      },
      async remove(id) {
        await NativeStorage.pause(id);
        await NativeStorage.forget(id);
        for (const suffix of ["", ".mp3", ".png", ".jpg"])
          await FS.deleteAsync(root + id + suffix, { idempotent: true });
        await FS.deleteAsync(root + id + ".partial", { idempotent: true });
      },
      freeSpace: FS.getFreeDiskStorageAsync,
      async download(asset, m, progress, signal) {
        const final = root + asset.id + "." + extension(asset);
        if (await verified(asset, final)) return final;
        const status = await NativeStorage.status(asset.id);
        {
          if (status.state === "complete") {
            await NativeStorage.forget(asset.id);
            await FS.deleteAsync(final, { idempotent: true });
          }
          const ticket = await delivery(m, asset.id);
          const prior = specs.get(asset.id);
          const spec = {
            id: asset.id,
            bytes: asset.bytes,
            extension: extension(asset),
            url: ticket.url,
            wifiOnly: prior?.wifiOnly ?? true,
            urgent: prior?.urgent ?? false,
          };
          specs.set(asset.id, spec);
          await NativeStorage.enqueue(spec);
        }
        const cancel = () => {
          void NativeStorage.pause(asset.id);
        };
        if (signal.aborted) {
          await NativeStorage.pause(asset.id);
          throw new Error("Paused");
        }
        signal.addEventListener("abort", cancel, { once: true });
        try {
          while (!signal.aborted) {
            const state = await NativeStorage.status(asset.id);
            progress(state.bytesWritten ?? 0);
            if (state.state === "complete") {
              if (!(await verified(asset, final)))
                throw new Error("Corrupt native download");
              metric("downloadedBytes", asset.bytes);
              return final;
            }
            if (["failed", "paused", "missing"].includes(state.state)) {
              metric("downloadFailures", 1);
              throw new Error(
                state.error ?? "Download interrupted. Retry when connected.",
              );
            }
            await new Promise((r) => setTimeout(r, 500));
          }
          throw new Error("Paused");
        } finally {
          signal.removeEventListener("abort", cancel);
        }
      },
    };
    let state: Inventory | undefined;
    try {
      const raw = await AsyncStorage.getItem("@story/downloads-v1");
      const parsed = JSON.parse(raw ?? "null");
      if (parsed?.version === 1) state = parsed;
    } catch {}
    if (state)
      for (const t of Object.values(state.transfers)) {
        const target = root + t.asset.id + "." + extension(t.asset);
        if (await verified(t.asset, target)) {
          t.local = target;
          t.state = "verified";
          continue;
        }
        if (
          t.local &&
          t.local !== target &&
          (await verified(t.asset, t.local))
        ) {
          await FS.moveAsync({ from: t.local, to: target });
          t.local = target;
        }
      }
    const queue = new DownloadQueue(adapter, state);
    await queue.reconcile();
    const network = async () =>
      queue.policy(await NativeStorage.unconstrainedWifi().catch(() => false));
    await network();
    Network.addNetworkStateListener(() => void network());
    AppState.addEventListener("change", (s) => {
      if (s === "active") void queue.reconcile().then(network);
      else void queue.flush();
    });
    setInterval(() => void queue.pump().catch(() => {}), 2000);
    return queue;
  })());
}
