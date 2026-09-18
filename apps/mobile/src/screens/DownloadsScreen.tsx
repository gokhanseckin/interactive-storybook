import { DeliveryLab } from "./DeliveryLab";
import { StaffPreview } from "./StaffPreview";
import { assets, type Manifest } from "@story/contracts";
import { useDownloadQueue } from "../hooks/useDownloadQueue";
import { downloadState } from "../hooks/downloadState";
import { View, Text, Pressable, ScrollView, Switch, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
export function DownloadsScreen({
  onBack,
  onPreview,
  onListen,
}: {
  onBack: () => void;
  onListen?: (storyId: string, releaseId: string, locale: string) => void;
  onPreview?: (m: Manifest) => void;
}) {
  const { queue, error, retry } = useDownloadQueue();
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
        {!!error && (
          <>
            <Text accessibilityLiveRegion="polite">{error}</Text>
            {action("Tekrar dene", retry)}
          </>
        )}
        {!queue && !error && <Text>İndirmeler hazırlanıyor…</Text>}
        {queue && !Object.keys(queue.state.packages).length && (
          <Text>
            Henüz indirilen masal yok. Kitaplıktan bir masal seçebilirsin.
          </Text>
        )}
        <Text style={{ marginTop: 20 }}>
          Otomatik önbellek: {mb(autoBytes)} / {mb(queue?.budget ?? 0)}
        </Text>
        {action("Önbelleği temizle", () => queue?.clearCache())}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Text style={{ flex: 1 }}>
            Kitapların tamamını mobil veri ile indirmeye izin ver
          </Text>
          <Switch
            disabled={!queue}
            accessibilityLabel="Kitapların tamamını mobil veri ile indir"
            value={queue?.state.cellular ?? false}
            onValueChange={(allow) => queue?.cellular(allow)}
          />
        </View>
        <Text style={{ marginVertical: 12, color: "#756C82" }}>
          Wi-Fi dışında yalnızca yaklaşan sesler hazırlanır. İndirilen sesleri
          silmek dinleme ilerlemesini silmez.
        </Text>
        {queue &&
          Object.entries(queue.state.packages)
            .filter(([id]) => !id.startsWith("preview-"))
            .map(([id, p]) => {
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
                    {downloadState(queue, id).label}
                  </Text>
                  <Text>
                    {p.manifest.locale} · {id}
                  </Text>
                  <Text>
                    {mb(progress.bytes)} / {mb(progress.total)}
                  </Text>
                  {failed && <Text>{failed.error}</Text>}
                  {queue.complete(id) &&
                    onListen &&
                    action("Çevrimdışı dinle", () =>
                      onListen(p.manifest.storyId, id, p.manifest.locale),
                    )}
                  {!queue.complete(id) &&
                    action(p.paused ? "Devam et" : "Duraklat", () =>
                      queue.pause(id, !p.paused),
                    )}
                  {failed && action("Tekrar dene", () => queue.retry(id))}
                  {!p.pinned &&
                    action("Çevrimdışı sakla", () =>
                      queue.add(p.manifest, true),
                    )}
                  {action(
                    !queue.complete(id)
                      ? "İndirmeyi iptal et"
                      : p.pinned
                        ? "İndirmeyi kaldır"
                        : "Önbellekten kaldır",
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
