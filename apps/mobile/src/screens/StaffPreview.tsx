import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { ManifestSchema, type Manifest } from "@story/contracts";
import { staffLogin, staffLogout, request } from "../delivery/client";
export function StaffPreview({
  onPreview,
}: {
  onPreview: (m: Manifest) => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [stories, setStories] = useState<
      { id: string; revision: number; story: { title: string } }[] | null
    >(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <View
      style={{
        marginTop: 30,
        borderTopWidth: 1,
        borderColor: "#DFDAE8",
        paddingTop: 20,
      }}
    >
      <Text style={{ fontSize: 20 }}>Story Studio personel önizlemesi</Text>
      {!stories ? (
        <>
          <TextInput
            accessibilityLabel="Staff email"
            placeholder="Studio e-posta"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            style={{ padding: 12 }}
          />
          <TextInput
            accessibilityLabel="Staff password"
            placeholder="Parola"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={{ padding: 12 }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              run(async () => {
                await staffLogin(email, password);
                setPassword("");
                const drafts = await request("/stories");
                if (mounted.current) setStories(drafts);
              })
            }
          >
            <Text style={{ padding: 12, color: "#695091" }}>Giriş yap</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              void run(async () => {
                try {
                  await staffLogout();
                } finally {
                  setStories(null);
                }
              });
            }}
          >
            <Text style={{ padding: 12, color: "#695091" }}>Çıkış yap</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const drafts = await request("/stories");
                if (mounted.current) setStories(drafts);
              })
            }
          >
            <Text style={{ padding: 12, color: "#695091" }}>
              Taslakları yenile
            </Text>
          </Pressable>
          {stories.map((d) => (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              key={d.id}
              onPress={() =>
                run(async () => {
                  const m = ManifestSchema.parse(
                    await request(
                      `/stories/${encodeURIComponent(d.id)}/preview`,
                      { revision: d.revision },
                    ),
                  );
                  if (
                    m.storyId !== d.id ||
                    m.revision !== d.revision ||
                    !m.releaseId.startsWith("preview-")
                  )
                    throw new Error(
                      "Önizleme sürümü değişti. Listeyi yenileyin.",
                    );
                  if (mounted.current) onPreview(m);
                })
              }
            >
              <Text style={{ padding: 12, color: "#695091" }}>
                {d.story.title} · r{d.revision}
              </Text>
            </Pressable>
          ))}
        </>
      )}
      {busy && (
        <Text accessibilityLiveRegion="polite">Önizleme hazırlanıyor…</Text>
      )}
      {!!error && <Text accessibilityLiveRegion="polite">{error}</Text>}
    </View>
  );
}
