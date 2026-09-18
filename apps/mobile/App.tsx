import { useEffect, useState } from "react";
import { BackHandler, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DeliveryLab } from "./src/screens/DeliveryLab";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { StoryPlayerScreen } from "./src/screens/StoryPlayerScreen";
import { sampleStory } from "./src/domain/sampleStory";
import { activeSession } from "./src/services/progressStore";
import { manifest } from "./src/delivery/client";
import { downloads } from "./src/delivery/native";
import type { PlaybackContext } from "./src/delivery/source";
import type { Story } from "@story/contracts";
export default function App() {
  const [listening, setListening] = useState<{
    story: Story;
    context: PlaybackContext;
  } | null>(null);
  const back = () => {
    setListening(null);
    void downloads()
      .then((q) => q.stop())
      .catch(() => {});
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!listening) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [listening]);
  async function listen(storyId: string, releaseId?: string, locale = "tr-TR") {
    try {
      if (storyId === sampleStory.id) {
        setListening({
          story: sampleStory,
          context: {
            releaseId: "bundled-welcome-v1",
            locale: sampleStory.language,
          },
        });
        return;
      }
      const pinned = await activeSession(storyId, locale);
      const m = await manifest(pinned ?? releaseId!);
      setListening({
        story: m.story,
        context: { releaseId: m.releaseId, locale: m.locale, manifest: m },
      });
    } catch (e) {
      Alert.alert(
        "Masal açılamadı",
        e instanceof Error ? e.message : "İnternet bağlantısını kontrol edin.",
      );
    }
  }
  return (
    <SafeAreaProvider>
      <StatusBar style={listening ? "light" : "dark"} />
      {__DEV__ && process.env.EXPO_PUBLIC_DELIVERY_LAB_AUTORUN === "shared" ? (
        <DeliveryLab />
      ) : listening ? (
        <StoryPlayerScreen
          key={listening.context.releaseId}
          story={listening.story}
          context={listening.context}
          autoStart
          onBack={back}
        />
      ) : (
        <LibraryScreen
          onListen={listen}
          onPreview={(m) =>
            setListening({
              story: m.story,
              context: {
                releaseId: m.releaseId,
                locale: m.locale,
                manifest: m,
              },
            })
          }
        />
      )}
    </SafeAreaProvider>
  );
}
