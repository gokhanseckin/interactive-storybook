import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { downloads } from "../delivery/native";
import type { DownloadQueue } from "../delivery/queue";

export function useDownloadQueue(enabled = true) {
  const [queue, setQueue] = useState<DownloadQueue | null>(null);
  const [revision, update] = useState(0);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    setError("");
    downloads()
      .then((q) => {
        if (!mounted) return;
        setQueue(q);
        unsubscribe = q.subscribe(() => update((n) => n + 1));
      })
      .catch(() => {
        if (mounted) setError("İndirmeler açılamadı. Tekrar deneyin.");
      });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [attempt, enabled]);
  useEffect(() => {
    if (!queue || !enabled) return;
    // Recheck verified paths without resetting in-flight native transfers.
    const check = () =>
      Promise.all(
        Object.values(queue.state.transfers)
          .filter((t) => t.state === "verified")
          .map((t) => queue.local(t.asset)),
      ).catch(() =>
        setError("Çevrimdışı dosyalar doğrulanamadı. Tekrar deneyin."),
      );
    void check();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void check();
    });
    return () => sub.remove();
  }, [queue, attempt, enabled]);
  return {
    queue,
    revision,
    error,
    retry: useCallback(() => retry((n) => n + 1), []),
  };
}
