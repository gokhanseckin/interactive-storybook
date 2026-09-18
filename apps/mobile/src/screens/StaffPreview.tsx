import { useState } from "react";
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
  const run = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
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
            onPress={() =>
              run(async () => {
                await staffLogin(email, password);
                setPassword("");
                setStories(await request("/stories"));
              })
            }
          >
            <Text style={{ padding: 12, color: "#695091" }}>Giriş yap</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
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
          {stories.map((d) => (
            <Pressable
              key={d.id}
              onPress={() =>
                run(async () =>
                  onPreview(
                    ManifestSchema.parse(
                      await request(`/stories/${d.id}/preview`, {
                        revision: d.revision,
                      }),
                    ),
                  ),
                )
              }
            >
              <Text style={{ padding: 12, color: "#695091" }}>
                {d.story.title} · r{d.revision}
              </Text>
            </Pressable>
          ))}
        </>
      )}
      {!!error && <Text>{error}</Text>}
    </View>
  );
}
