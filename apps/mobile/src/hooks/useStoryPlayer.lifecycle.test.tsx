import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { sampleStory } from "../domain/sampleStory";
import { createInitialPlayerState } from "../domain/playerMachine";

// Integration harness uses the pinned test-only renderer from mobile devDependencies.
// No native recording, storage, network or device-acceptance claims are made here.
const native = vi.hoisted(() => ({
  status: {
    isLoaded: true,
    currentTime: 0,
    didJustFinish: false,
    isBuffering: false,
    playing: false,
    error: null,
  },
  subscribers: new Set<() => void>(),
  appState: null as null | ((state: string) => void),
  speech: {} as Record<string, (event?: any) => void>,
  player: {
    pause: vi.fn(),
    play: vi.fn(),
    replace: vi.fn(),
    seekTo: vi.fn(async () => {}),
    currentTime: 0,
  },
  source: vi.fn(async () => ({ uri: "file:///bundled.wav" })),
  saved: null as any,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios", Version: "26.7" },
  AppState: {
    addEventListener: (_: string, fn: any) => {
      native.appState = fn;
      return {
        remove() {
          native.appState = null;
        },
      };
    },
  },
}));
vi.mock("expo-audio", async () => {
  const React = await import("react");
  return {
    setAudioModeAsync: vi.fn(async () => {}),
    useAudioPlayer: () => native.player,
    useAudioPlayerStatus: () =>
      React.useSyncExternalStore(
        (fn) => {
          native.subscribers.add(fn);
          return () => {
            native.subscribers.delete(fn);
          };
        },
        () => native.status,
      ),
  };
});
vi.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    supportsOnDeviceRecognition: () => true,
    getSupportedLocales: async () => ({
      locales: ["tr-TR"],
      installedLocales: ["tr-TR"],
    }),
    requestMicrophonePermissionsAsync: async () => ({ granted: true }),
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  },
  useSpeechRecognitionEvent: (event: string, fn: any) => {
    native.speech[event] = fn;
  },
}));
vi.mock("../delivery/source", () => ({ source: native.source }));
vi.mock("../delivery/metrics", () => ({ metric: vi.fn() }));
vi.mock("../services/progressStore", () => ({
  loadProgress: async () => native.saved,
  saveProgress: vi.fn(async () => {}),
  clearProgress: vi.fn(async () => {}),
}));
import { useStoryPlayer } from "./useStoryPlayer";
const context = { releaseId: "bundled-welcome-v1", locale: "tr-TR" };
let api: ReturnType<typeof useStoryPlayer>;
function Harness() {
  api = useStoryPlayer(sampleStory, context);
  return null;
}
const runtimePath = process.env.STORY_REACT_TEST_RENDERER || "react-test-renderer";
describe(
  "actual React hook lifecycle with fake native events",
  () => {
    let renderer: any, act: any, tree: any;
    const emit = (status: Partial<typeof native.status>) => {
      native.status = { ...native.status, ...status };
      native.player.currentTime = native.status.currentTime;
      native.subscribers.forEach((fn) => fn());
    };
    beforeEach(async () => {
      renderer = await import(/* @vite-ignore */ runtimePath!);
      act = renderer.act ?? renderer.default.act;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
      vi.clearAllMocks();
      native.status = {
        isLoaded: true,
        currentTime: 0,
        didJustFinish: false,
        isBuffering: false,
        playing: false,
        error: null,
      };
      native.saved = {
        ...createInitialPlayerState(sampleStory),
        nodeId: "silver-leaf-choice",
        trackKind: "choicePrompt",
        mode: "awaitingChoice",
      };
      await act(async () => {
        tree = (renderer.create ?? renderer.default.create)(<Harness />);
      });
      await act(async () => {
        await api.continueSaved();
      });
    });
    afterEach(async () => {
      await act(async () => tree.unmount());
    });
    it("starts tapped response after Home/lock when isLoaded stays true across source replacement", async () => {
      await act(async () => {
        emit({ currentTime: 12 });
      });
      await act(async () => {
        api.startVoiceChoice();
      });
      await act(async () => {
        native.appState?.("background");
      });
      await act(async () => {
        native.appState?.("active");
        api.chooseOption("inspect-stones");
      });
      expect(api.state.selectedOptionId).toBe("inspect-stones");
      native.player.play.mockClear();
      // Native may coalesce load notifications: only the clock changes to new clip zero.
      await act(async () => {
        emit({ currentTime: 0, isLoaded: true });
      });
      expect(native.player.play).toHaveBeenCalled();
    });
    it("reasserts playback after a late speech-end restores the audio session", async () => {
      await act(async () => {
        api.startVoiceChoice();
      });
      await act(async () => {
        native.appState?.("background");
      });
      await act(async () => {
        native.appState?.("active");
        api.chooseOption("inspect-stones");
      });
      native.player.play.mockClear();
      await act(async () => {
        native.speech.end();
      });
      expect(api.state.selectedOptionId).toBe("inspect-stones");
      expect(native.player.play).toHaveBeenCalled();
    });
    it("does not resume paused narration when audio mode restoration completes after backgrounding", async () => {
      await act(async () => { api.startVoiceChoice(); });
      await act(async () => {
        api.chooseOption("inspect-stones");
      });
      await act(async () => {
        native.appState?.("background");
      });
      native.player.play.mockClear();
      await act(async () => {
        native.speech.end();
      });
      expect(api.state.mode).toBe("paused");
      expect(native.player.play).not.toHaveBeenCalled();
    });
  },
);
