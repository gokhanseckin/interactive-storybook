import { assets, type Asset, type Manifest } from "@story/contracts";
export type TransferState =
  "queued" | "downloading" | "verified" | "paused" | "failed";
export type Transfer = {
  asset: Asset;
  state: TransferState;
  bytes: number;
  attempts: number;
  retryAt: number;
  error?: string;
  local?: string;
};
export type Package = {
  manifest: Manifest;
  pinned: boolean;
  paused: boolean;
  lastUsed: number;
};
export type Inventory = {
  version: 1;
  transfers: Record<string, Transfer>;
  packages: Record<string, Package>;
  cellular: boolean;
};
export const emptyInventory = (): Inventory => ({
  version: 1,
  transfers: {},
  packages: {},
  cellular: false,
});
export type PlannedTransfer = {
  asset: Asset;
  manifest: Manifest;
  wifiOnly: boolean;
  urgent: boolean;
};
export interface TransferAdapter {
  plan?(items: PlannedTransfer[]): Promise<void>;
  retain?(ids: string[]): Promise<void>;
  save(state: Inventory): Promise<void>;
  download(
    asset: Asset,
    manifest: Manifest,
    onProgress: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<string>;
  exists(asset: Asset, path: string): Promise<boolean>;
  recover?(asset: Asset): Promise<string | null>;
  remove(id: string): Promise<void>;
  freeSpace(): Promise<number>;
}
export class DownloadQueue {
  state: Inventory;
  activeRelease: string | null = null;
  streaming: string | null = null;
  urgent = new Set<string>();
  wifi = false;
  private running = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private saving = Promise.resolve();
  private pumping = false;
  constructor(
    private adapter: TransferAdapter,
    state = emptyInventory(),
    public budget = 250 * 1024 * 1024,
  ) {
    this.state = state;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  changed() {
    this.listeners.forEach((fn) => fn());
    const snapshot = JSON.parse(JSON.stringify(this.state));
    this.saving = this.saving
      .catch(() => {})
      .then(() => this.adapter.save(snapshot));
  }
  async flush() {
    await this.saving;
  }
  async reconcile() {
    for (const t of Object.values(this.state.transfers)) {
      const recovered = await this.adapter.recover?.(t.asset);
      if (recovered) {
        t.local = recovered;
        t.state = "verified";
        t.bytes = t.asset.bytes;
        delete t.error;
        continue;
      }
      if (
        t.state === "verified" &&
        (!t.local || !(await this.adapter.exists(t.asset, t.local)))
      ) {
        t.state = "queued";
        t.bytes = 0;
        delete t.local;
      }
      if (t.state === "downloading") {
        t.state = "queued";
        t.bytes = 0;
      }
    }
    this.changed();
  }
  add(manifest: Manifest, pinned = false) {
    const prior = this.state.packages[manifest.releaseId];
    this.state.packages[manifest.releaseId] = {
      manifest,
      pinned: pinned || prior?.pinned || false,
      paused: false,
      lastUsed: Date.now(),
    };
    for (const asset of assets(manifest))
      this.state.transfers[asset.id] ??= {
        asset,
        state: "queued",
        bytes: 0,
        attempts: 0,
        retryAt: 0,
      };
    this.changed();
    void this.pump();
  }
  select(manifest: Manifest, currentId?: string, dependencies: string[] = []) {
    this.activeRelease = manifest.releaseId;
    this.streaming = currentId ?? null;
    this.urgent = new Set(dependencies);
    this.add(manifest);
    this.applyPolicy();
  }
  policy(wifi: boolean) {
    this.wifi = wifi;
    this.applyPolicy();
    void this.pump();
  }
  private owners(id: string) {
    return Object.values(this.state.packages).filter((p) =>
      assets(p.manifest).some((a) => a.id === id),
    );
  }
  private allowed(id: string) {
    if (id === this.streaming) return false;
    return this.owners(id).some(
      (p) =>
        (p.manifest.releaseId === this.activeRelease && this.urgent.has(id)) ||
        (!p.paused &&
          ((p.manifest.releaseId === this.activeRelease && this.wifi) ||
            (p.pinned && (this.wifi || this.state.cellular)))),
    );
  }
  private applyPolicy() {
    void this.adapter
      .retain?.(
        Object.keys(this.state.transfers).filter((id) => this.allowed(id)),
      )
      .catch(() => {});
    for (const [id, c] of this.running) if (!this.allowed(id)) c.abort();
  }
  pause(release: string, paused = true) {
    const p = this.state.packages[release];
    if (p) p.paused = paused;
    this.applyPolicy();
    this.changed();
    void this.pump();
  }
  retry(release: string) {
    for (const a of assets(this.state.packages[release].manifest)) {
      const t = this.state.transfers[a.id];
      if (t.state === "failed") {
        t.state = "queued";
        t.attempts = 0;
        t.retryAt = 0;
      }
    }
    this.pause(release, false);
  }
  cellular(allow: boolean) {
    this.state.cellular = allow;
    this.applyPolicy();
    this.changed();
    void this.pump();
  }
  complete(release: string) {
    const p = this.state.packages[release];
    return (
      !!p &&
      assets(p.manifest).every(
        (a) => this.state.transfers[a.id]?.state === "verified",
      )
    );
  }
  progress(release: string) {
    const p = this.state.packages[release];
    return p
      ? assets(p.manifest).reduce(
          (v, a) => ({
            bytes:
              v.bytes +
              Math.min(a.bytes, this.state.transfers[a.id]?.bytes ?? 0),
            total: v.total + a.bytes,
          }),
          { bytes: 0, total: 0 },
        )
      : { bytes: 0, total: 0 };
  }
  async ensure(manifest: Manifest, ids: string[], signal?: AbortSignal) {
    this.activeRelease = manifest.releaseId;
    ids.forEach((id) => this.urgent.add(id));
    this.add(manifest);
    await this.pump();
    if (ids.every((id) => this.state.transfers[id]?.state === "verified"))
      return;
    await new Promise<void>((resolve, reject) => {
      const aborted = () => {
        stop();
        signal?.removeEventListener("abort", aborted);
        reject(new Error("Preparation cancelled"));
      };
      const check = () => {
        if (ids.every((id) => this.state.transfers[id]?.state === "verified")) {
          stop();
          signal?.removeEventListener("abort", aborted);
          resolve();
        } else if (
          ids.some((id) => this.state.transfers[id]?.state === "failed")
        ) {
          stop();
          signal?.removeEventListener("abort", aborted);
          reject(new Error("Audio preparation failed. Retry when connected."));
        }
      };
      const stop = this.subscribe(check);
      if (signal?.aborted) {
        aborted();
        return;
      }
      signal?.addEventListener("abort", aborted, { once: true });
      check();
    });
  }
  async local(asset: Asset) {
    const t = this.state.transfers[asset.id];
    if (t && t.state !== "verified") {
      const recovered = await this.adapter.recover?.(asset);
      if (recovered) {
        t.local = recovered;
        t.state = "verified";
        t.bytes = asset.bytes;
        delete t.error;
        this.changed();
        return recovered;
      }
    }
    if (t?.state === "verified" && t.local) {
      if (await this.adapter.exists(asset, t.local)) return t.local;
      t.state = "queued";
      t.bytes = 0;
      delete t.local;
      this.changed();
    }
    return null;
  }
  async remove(release: string) {
    if (release === this.activeRelease)
      throw new Error("Stop this book before removing its audio.");
    delete this.state.packages[release];
    this.applyPolicy();
    for (const [id, t] of Object.entries(this.state.transfers)) {
      if (!this.owners(id).length && !this.running.has(id)) {
        await this.adapter.remove(id);
        delete this.state.transfers[id];
      }
    }
    this.changed();
  }
  async clearCache() {
    for (const [id, p] of Object.entries(this.state.packages))
      if (!p.pinned && id !== this.activeRelease) await this.remove(id);
  }
  async evict() {
    const usage = () =>
      Object.values(this.state.transfers)
        .filter(
          (t) =>
            t.state === "verified" &&
            !this.owners(t.asset.id).some((p) => p.pinned),
        )
        .reduce((n, t) => n + t.asset.bytes, 0);
    for (const [id] of Object.entries(this.state.packages)
      .filter(([id, p]) => !p.pinned && id !== this.activeRelease)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)) {
      if (usage() <= this.budget) break;
      await this.remove(id);
    }
  }
  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      await this.evict();
      const planned = Object.values(this.state.transfers)
        .filter(
          (t) =>
            t.state !== "verified" &&
            t.state !== "failed" &&
            this.allowed(t.asset.id),
        )
        .sort(
          (a, b) =>
            Number(this.urgent.has(b.asset.id)) -
            Number(this.urgent.has(a.asset.id)),
        )
        .map((t) => ({
          asset: t.asset,
          manifest: (
            this.owners(t.asset.id).find(
              (p) => p.manifest.releaseId === this.activeRelease,
            ) ?? this.owners(t.asset.id)[0]
          ).manifest,
          urgent: this.urgent.has(t.asset.id),
          wifiOnly: !this.urgent.has(t.asset.id) && !this.state.cellular,
        }));
      // Only schedule work whose aggregate remaining footprint fits; never evict pinned media.
      const required = planned.reduce((n, t) => n + t.asset.bytes, 0);
      if (
        this.adapter.plan &&
        (await this.adapter.freeSpace()) > required * 2 + 20 * 1024 * 1024
      )
        await this.adapter.plan(planned).catch(() => {});
      while (this.running.size < 2) {
        const next = Object.values(this.state.transfers)
          .filter(
            (t) =>
              t.state === "queued" &&
              t.retryAt <= Date.now() &&
              this.allowed(t.asset.id) &&
              !this.running.has(t.asset.id),
          )
          .sort(
            (a, b) =>
              Number(this.urgent.has(b.asset.id)) -
              Number(this.urgent.has(a.asset.id)),
          )[0];
        if (!next) break;
        const id = next.asset.id;
        const free = await this.adapter.freeSpace();
        const reserved = [...this.running.keys()].reduce(
          (n, k) => n + this.state.transfers[k].asset.bytes,
          0,
        );
        if (free < next.asset.bytes * 2 + reserved + 20 * 1024 * 1024) {
          next.state = "failed";
          next.error = "Not enough storage. Remove downloads or clear cache.";
          this.changed();
          continue;
        }
        const c = new AbortController();
        this.running.set(id, c);
        next.state = "downloading";
        next.attempts++;
        this.changed();
        const owner =
          this.owners(id).find(
            (p) => p.manifest.releaseId === this.activeRelease,
          ) ?? this.owners(id)[0];
        void this.adapter
          .download(
            next.asset,
            owner.manifest,
            (n) => {
              next.bytes = n;
              this.changed();
            },
            c.signal,
          )
          .then((path) => {
            next.local = path;
            next.state = "verified";
            next.bytes = next.asset.bytes;
            delete next.error;
          })
          .catch((e) => {
            // A native completion may have been recovered while this observer was stopping.
            if (next.state === "verified") return;
            next.state = c.signal.aborted
              ? "queued"
              : next.attempts < 3
                ? "queued"
                : "failed";
            next.bytes = 0;
            next.error = c.signal.aborted ? undefined : String(e.message);
            next.retryAt = c.signal.aborted
              ? 0
              : Date.now() + 1000 * 2 ** next.attempts;
          })
          .finally(() => {
            this.running.delete(id);
            this.changed();
            void this.pump();
          });
      }
    } finally {
      this.pumping = false;
    }
  }
  stop() {
    this.activeRelease = null;
    this.streaming = null;
    this.urgent.clear();
    this.applyPolicy();
  }
}
