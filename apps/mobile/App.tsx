import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { StoryPlayerScreen } from './src/screens/StoryPlayerScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <StoryPlayerScreen />
    </SafeAreaProvider>
  );
}
