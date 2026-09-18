import { DeliveryLab } from "./DeliveryLab";
import { StaffPreview } from "./StaffPreview";
import { assets, type Manifest } from "@story/contracts";
import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, Switch, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { downloads } from "../delivery/native";
import type { DownloadQueue } from "../delivery/queue";
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
export function DownloadsScreen({
  onBack,
  onPreview,
}: {
  onBack: () => void;
  onPreview?: (m: Manifest) => void;
}) {
  const [queue, setQueue] = useState<DownloadQueue | null>(null),
    [, update] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let mounted = true;
    downloads()
      .then((q) => {
        if (!mounted) return;
        setQueue(q);
        unsubscribe = q.subscribe(() => update((n) => n + 1));
      })
      .catch((e) => setError(e.message));
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);
  const action = (label: string, fn: () => unknown) => (
    <Pressable
      accessibilityRole="button"
      style={{ paddingVertical: 13 }}
      onPress={() =>
        Promise.resolve()
          .then(fn)
          .catch((e) => Alert.alert("İndirilenler", e.message))
      }
    >
      <Text style={{ color: "#695091", fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  const autoBytes = queue
    ? Object.values(queue.state.transfers)
        .filter(
          (t) =>
            t.state === "verified" &&
            !Object.values(queue.state.packages).some(
              (p) =>
                p.pinned && assets(p.manifest).some((a) => a.id === t.asset.id),
            ),
        )
        .reduce((n, t) => n + t.asset.bytes, 0)
    : 0;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F5F3FA" }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        {action("‹ Kitaplığa dön", onBack)}
        <Text style={{ fontSize: 28, color: "#302640" }}>
          İndirilenler ve depolama
        </Text>
        {!!error && <Text>{error}</Text>}
        <Text style={{ marginTop: 20 }}>
          Otomatik önbellek: {mb(autoBytes)} / {mb(queue?.budget ?? 0)}
        </Text>
        {action("Önbelleği temizle", () => queue?.clearCache())}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Text style={{ flex: 1 }}>
            Kitapların tamamını mobil veri ile indirmeye izin ver
          </Text>
          <Switch
            value={queue?.state.cellular ?? false}
            onValueChange={(allow) => queue?.cellular(allow)}
          />
        </View>
        <Text style={{ marginVertical: 12, color: "#756C82" }}>
          Wi-Fi dışında yalnızca yaklaşan sesler hazırlanır. İndirilen sesleri
          silmek dinleme ilerlemesini silmez.
        </Text>
        {queue &&
          Object.entries(queue.state.packages).map(([id, p]) => {
            const progress = queue.progress(id),
              failed = Object.values(queue.state.transfers).find(
                (t) =>
                  t.state === "failed" &&
                  assets(p.manifest).some((a) => a.id === t.asset.id),
              );
            return (
              <View
                key={id}
                style={{
                  borderTopWidth: 1,
                  borderColor: "#DFDAE8",
                  paddingVertical: 20,
                }}
              >
                <Text style={{ fontSize: 20, color: "#302640" }}>
                  {p.manifest.story.title}
                </Text>
                <Text style={{ marginTop: 8 }}>
                  {p.pinned && queue.complete(id)
                    ? "İndirildi"
                    : queue.complete(id)
                      ? "Önbellekte — depolama gerektiğinde kaldırılabilir"
                      : p.paused
                        ? "Duraklatıldı"
                        : failed
                          ? "Tekrar dene"
                          : "Kısmi indirme — internet gerekebilir"}
                </Text>
                <Text>
                  {mb(progress.bytes)} / {mb(progress.total)}
                </Text>
                {failed && <Text>{failed.error}</Text>}
                {!queue.complete(id) &&
                  action(p.paused ? "Devam et" : "Duraklat", () =>
                    queue.pause(id, !p.paused),
                  )}
                {failed && action("Tekrar dene", () => queue.retry(id))}
                {action(
                  p.pinned ? "İndirmeyi kaldır" : "Önbellekten kaldır",
                  () => queue.remove(id),
                )}
              </View>
            );
          })}
        {onPreview && <StaffPreview onPreview={onPreview} />}
        {__DEV__ && <DeliveryLab />}
      </ScrollView>
    </SafeAreaView>
  );
}
