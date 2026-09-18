import { assets } from "@story/contracts";
import type { DownloadQueue } from "../delivery/queue";
export function downloadState(queue: DownloadQueue, releaseId: string) {
  const p = queue.state.packages[releaseId];
  if (!p)
    return {
      label: "İndirilmedi — internet gerekir",
      complete: false,
      pinned: false,
      failed: false,
    };
  const transfers = assets(p.manifest).map((a) => queue.state.transfers[a.id]);
  const complete = queue.complete(releaseId);
  const failed = transfers.some((t) => t?.state === "failed");
  const downloading = transfers.some((t) => t?.state === "downloading");
  const label = complete
    ? p.pinned
      ? "İndirildi — çevrimdışı hazır"
      : "Çevrimdışı önbellekte — kaldırılabilir"
    : p.paused
      ? "Duraklatıldı — kalan sesler için internet gerekir"
      : failed
        ? "İndirme tamamlanamadı — tekrar dene"
        : downloading
          ? "İndiriliyor — henüz çevrimdışı hazır değil"
          : !queue.wifi && !queue.state.cellular
            ? "Wi-Fi bekleniyor — henüz çevrimdışı hazır değil"
            : "İndirme sırada — henüz çevrimdışı hazır değil";
  return { label, complete, pinned: p.pinned, failed };
}
