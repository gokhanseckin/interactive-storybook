import { useEffect, useState } from "react";
import { BackHandler } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { StoryPlayerScreen } from "./src/screens/StoryPlayerScreen";

export default function App() {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!listening) return false;
        setListening(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [listening]);
  return (
    <SafeAreaProvider>
      <StatusBar style={listening ? "light" : "dark"} />
      {listening ? (
        <StoryPlayerScreen autoStart onBack={() => setListening(false)} />
      ) : (
        <LibraryScreen onListen={() => setListening(true)} />
      )}
    </SafeAreaProvider>
  );
}
