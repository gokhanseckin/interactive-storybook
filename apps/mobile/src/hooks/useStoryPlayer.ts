import { preparePlaybackSource } from "./preparePlaybackSource";
import { metric } from "../delivery/metrics";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

import { source, type PlaybackContext } from "../delivery/source";
import { getAudioDurationSeconds } from "../audio/audioDurations";
import { VoiceChoiceSession, VOICE_RETRY } from "../domain/voiceChoiceSession";
import {
  buildPlaybackSection,
  findPlaybackSectionTarget,
  getSectionNavigation,
  getPlaybackSectionElapsed,
  type SectionNavigationTarget,
} from "../domain/playbackSection";
import {
  createInitialPlayerState,
  getChoiceNode,
  getCurrentSegment,
  hasMeaningfulProgress,
  reducePlayer,
  type PlayerEvent,
  type PlayerState,
} from "../domain/playerMachine";
import type { Story } from "../domain/storySchema";
import {
  clearProgress,
  loadProgress,
  saveProgress,
} from "../services/progressStore";

export function useStoryPlayer(story: Story, context: PlaybackContext) {
  const [state, dispatchBase] = useReducer(
    (current: PlayerState, event: PlayerEvent) =>
      reducePlayer(story, current, event),
    story,
    createInitialPlayerState,
  );
  const [isHydrating, setIsHydrating] = useState(true);
  const [resumeSnapshot, setResumeSnapshot] = useState<PlayerState | null>(
    null,
  );
  const currentSegment = useMemo(
    () => getCurrentSegment(story, state),
    [state, story],
  );
  const choice = useMemo(() => getChoiceNode(story, state), [state, story]);
  const stateRef = useRef(state);
  const [voicePreparing, setVoicePreparing] = useState(false);
  const [audioModeRevision, setAudioModeRevision] = useState(0);
  const finishedSegmentRef = useRef<string | null>(null);
  const assignedSegmentRef = useRef<string | null>(null);
  const readySegmentRef = useRef<string | null>(null);
  const [readinessRevision, setReadinessRevision] = useState(0);
  const pendingSeekRef = useRef<{
    requestId: number;
    segmentId: string;
    positionSeconds: number;
    resumeAfterSeek: boolean;
  } | null>(null);
  const seekRequestIdRef = useRef(0);
  const [seekRevision, setSeekRevision] = useState(0);
  const applyingSeekRef = useRef<number | null>(null);
  const lastSavedSecondRef = useRef(-1);
  const player = useAudioPlayer(null, {
    updateInterval: 250,
    downloadFirst: false,
  });
  const status = useAudioPlayerStatus(player);
  const preparingAt = useRef<number | null>(null),
    bufferingAt = useRef<number | null>(null);
  useEffect(() => {
    if (status.playing && preparingAt.current !== null) {
      metric("startupMs", Date.now() - preparingAt.current);
      preparingAt.current = null;
    }
    if (
      status.isBuffering &&
      state.mode === "playing" &&
      bufferingAt.current === null
    )
      bufferingAt.current = Date.now();
    if (!status.isBuffering && bufferingAt.current !== null) {
      metric("bufferingMs", Date.now() - bufferingAt.current);
      bufferingAt.current = null;
    }
  }, [status.playing, status.isBuffering, state.mode]);
  const [transport, setTransport] = useState<"preparing" | "ready" | "failed">(
    "preparing",
  );
  const [transportError, setTransportError] = useState<string | null>(null);
  const [sourceRetry, setSourceRetry] = useState(0);
  const duration = useCallback(
    (id: string) =>
      context.manifest?.audio[id]?.duration ?? getAudioDurationSeconds(id),
    [context],
  );
  const playbackSection = useMemo(
    () => buildPlaybackSection(story, state, duration),
    [state, story, duration],
  );
  const playbackSectionElapsed = playbackSection
    ? getPlaybackSectionElapsed(
        playbackSection,
        state,
        pendingSeekRef.current ? state.positionSeconds : status.currentTime,
      )
    : 0;
  const sectionNavigation = useMemo(
    () => getSectionNavigation(story, state),
    [state, story],
  );

  const dispatch = useCallback((event: PlayerEvent) => {
    dispatchBase(event);
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const restorePlaybackAudioMode = useCallback(() => {
    setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "doNotMix",
      shouldRouteThroughEarpiece: false,
    })
      .then(() => setAudioModeRevision((n) => n + 1))
      .catch(() => undefined);
  }, []);

  const voice = useMemo(
    () =>
      new VoiceChoiceSession(
        ExpoSpeechRecognitionModule,
        Platform.OS === "android" ? Number(Platform.Version) : null,
        dispatch,
        setVoicePreparing,
        restorePlaybackAudioMode,
      ),
    [dispatch, restorePlaybackAudioMode],
  );
  useSpeechRecognitionEvent("result", (event) =>
    voice.result(event.isFinal, event.results),
  );
  useSpeechRecognitionEvent("error", (event) => voice.error(event.error));
  useSpeechRecognitionEvent("end", () => voice.end());
  useEffect(() => {
    restorePlaybackAudioMode();
    return () => voice.cancel();
  }, [voice, restorePlaybackAudioMode]);

  useEffect(() => {
    let mounted = true;
    loadProgress(story.id, context)
      .then((snapshot) => {
        if (!mounted || !snapshot) return;
        if (
          hasMeaningfulProgress(story, snapshot) &&
          snapshot.mode !== "completed"
        ) {
          setResumeSnapshot(snapshot);
        }
      })
      .catch(() => {
        /* Storage failure must not block the tap/player interface. */
      })
      .finally(() => {
        if (mounted) setIsHydrating(false);
      });
    return () => {
      mounted = false;
    };
  }, [story, context]);

  useEffect(() => {
    if (!currentSegment) {
      player.pause();
      return;
    }
    finishedSegmentRef.current = null;
    readySegmentRef.current = null;
    assignedSegmentRef.current = null;
    lastSavedSecondRef.current = -1;
    preparingAt.current = Date.now();
    setTransport("preparing");
    setTransportError(null);
    let cancelled = false;
    const abort = new AbortController();
    preparePlaybackSource(
      player,
      () =>
        source(story, currentSegment.id, state.nodeId, context, abort.signal),
      abort.signal,
    )
      .then((assigned) => {
        if (cancelled || !assigned) return;
        assignedSegmentRef.current = currentSegment.id;
        setTransport("ready");
      })
      .catch((error) => {
        if (!cancelled) {
          metric("playbackFailures", 1);
          setTransport("failed");
          setTransportError(error.message);
        }
      });
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [currentSegment?.id, player, story, context, sourceRetry]);

  useEffect(() => {
    if (
      currentSegment &&
      transport === "ready" &&
      assignedSegmentRef.current === currentSegment.id &&
      status.isLoaded &&
      !status.didJustFinish &&
      status.currentTime <= 0.5
    ) {
      if (readySegmentRef.current !== currentSegment.id) {
        readySegmentRef.current = currentSegment.id;
        setReadinessRevision((n) => n + 1);
      }
    }
  }, [
    currentSegment,
    status.currentTime,
    status.didJustFinish,
    status.isLoaded,
    transport,
  ]);

  useEffect(() => {
    if (status.error && transport === "ready") {
      metric("playbackFailures", 1);
      setTransport("failed");
      setTransportError(
        "Ses yüklenemedi. Bağlantıyı kontrol edip tekrar dene.",
      );
    }
  }, [status.error, transport]);

  useEffect(() => {
    const pending = pendingSeekRef.current;
    if (
      !pending ||
      !currentSegment ||
      pending.segmentId !== currentSegment.id ||
      readySegmentRef.current !== currentSegment.id ||
      !status.isLoaded ||
      transport !== "ready" ||
      applyingSeekRef.current === pending.requestId
    ) {
      return;
    }

    applyingSeekRef.current = pending.requestId;
    player
      .seekTo(pending.positionSeconds)
      .then(() => {
        if (seekRequestIdRef.current !== pending.requestId) return;
        pendingSeekRef.current = null;
        lastSavedSecondRef.current = -1;
        setSeekRevision((value) => value + 1);
        if (pending.resumeAfterSeek) dispatch({ type: "PLAY" });
      })
      .catch(() => {
        if (seekRequestIdRef.current !== pending.requestId) return;
        pendingSeekRef.current = null;
        setSeekRevision((value) => value + 1);
        setTransport("failed");
        setTransportError("Kaldığın yere gidilemedi. Tekrar dene.");
        dispatch({ type: "PAUSE" });
      });
  }, [
    currentSegment,
    dispatch,
    player,
    status.isLoaded,
    status.currentTime,
    seekRevision,
    readinessRevision,
    transport,
  ]);

  useEffect(() => {
    if (
      state.mode === "playing" &&
      transport === "ready" &&
      currentSegment &&
      !pendingSeekRef.current &&
      status.isLoaded &&
      readySegmentRef.current === currentSegment.id
    ) {
      player.play();
    } else if (state.mode !== "playing") {
      player.pause();
    }
  }, [
    currentSegment,
    player,
    state.mode,
    status.isLoaded,
    transport,
    seekRevision,
    readinessRevision,
    audioModeRevision,
  ]);

  useEffect(() => {
    if (
      transport !== "ready" ||
      state.mode !== "playing" ||
      !currentSegment ||
      !status.didJustFinish ||
      pendingSeekRef.current
    )
      return;
    if (readySegmentRef.current !== currentSegment.id) return;
    if (finishedSegmentRef.current === currentSegment.id) return;
    finishedSegmentRef.current = currentSegment.id;
    dispatch({ type: "AUDIO_FINISHED" });
  }, [currentSegment, dispatch, status.didJustFinish, transport, state.mode]);

  useEffect(() => {
    if (
      transport !== "ready" ||
      readySegmentRef.current !== currentSegment?.id ||
      state.mode !== "playing" ||
      !status.isLoaded ||
      pendingSeekRef.current
    )
      return;
    const wholeSecond = Math.floor(status.currentTime);
    if (wholeSecond === lastSavedSecondRef.current) return;
    lastSavedSecondRef.current = wholeSecond;
    dispatch({ type: "PROGRESS", positionSeconds: status.currentTime });
  }, [
    dispatch,
    state.mode,
    status.currentTime,
    status.isLoaded,
    transport,
    currentSegment,
  ]);

  useEffect(() => {
    if (isHydrating || resumeSnapshot) return;
    saveProgress(state, context).catch(() => undefined);
  }, [isHydrating, resumeSnapshot, state, context]);

  useEffect(() => {
    if (
      state.mode !== "awaitingChoice" ||
      state.guidancePlayed ||
      voicePreparing ||
      transport !== "ready"
    )
      return;
    const timer = setTimeout(
      () => dispatch({ type: "GUIDANCE_TIMEOUT" }),
      8_000,
    );
    return () => clearTimeout(timer);
  }, [dispatch, state.guidancePlayed, state.mode, voicePreparing, transport]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") return;
      voice.cancel(VOICE_RETRY);
      player.pause();
      dispatch({ type: "PAUSE" });
      if (isHydrating || resumeSnapshot) return;
      saveProgress(
        {
          ...stateRef.current,
          mode:
            stateRef.current.mode === "playing"
              ? "paused"
              : stateRef.current.mode,
          positionSeconds:
            pendingSeekRef.current ||
            transport !== "ready" ||
            readySegmentRef.current !==
              getCurrentSegment(story, stateRef.current)?.id
              ? stateRef.current.positionSeconds
              : player.currentTime,
        },
        context,
      ).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [
    dispatch,
    player,
    voice,
    context,
    transport,
    story,
    isHydrating,
    resumeSnapshot,
  ]);

  const togglePlayback = useCallback(() => {
    dispatch({ type: state.mode === "playing" ? "PAUSE" : "PLAY" });
  }, [dispatch, state.mode]);

  const chooseOption = useCallback(
    (optionId: string) => {
      voice.cancel();
      player.pause();
      dispatch({ type: "SELECT_OPTION", optionId });
    },
    [dispatch, player, voice],
  );

  const seekToPlaybackSection = useCallback(
    (seconds: number) => {
      if (!playbackSection) return;
      voice.cancel();
      const target = findPlaybackSectionTarget(playbackSection, seconds);
      if (!target) return;

      const requestId = seekRequestIdRef.current + 1;
      seekRequestIdRef.current = requestId;
      pendingSeekRef.current = {
        requestId,
        segmentId: target.item.segment.id,
        positionSeconds: target.positionSeconds,
        resumeAfterSeek: state.mode === "playing",
      };
      setSeekRevision((value) => value + 1);
      player.pause();
      dispatch({
        type: "SEEK",
        nodeId: target.item.nodeId,
        segmentIndex: target.item.segmentIndex,
        trackKind: target.item.trackKind,
        selectedOptionId: target.item.selectedOptionId,
        positionSeconds: target.positionSeconds,
      });
    },
    [dispatch, playbackSection, player, state.mode, voice],
  );

  const navigateToSection = useCallback(
    (target: SectionNavigationTarget) => {
      voice.cancel();
      const targetSegment = story.nodes[target.nodeId];
      if (!targetSegment || targetSegment.kind !== "narration") return;

      const requestId = seekRequestIdRef.current + 1;
      seekRequestIdRef.current = requestId;
      pendingSeekRef.current = {
        requestId,
        segmentId: targetSegment.segments[0]!.id,
        positionSeconds: 0,
        resumeAfterSeek:
          state.mode === "playing" || state.mode === "awaitingChoice",
      };
      setSeekRevision((value) => value + 1);
      player.pause();
      dispatch({ type: "SEEK", ...target });
    },
    [dispatch, player, state.mode, story.nodes, voice],
  );

  const startVoiceChoice = useCallback(() => {
    if (choice && state.mode === "awaitingChoice" && transport === "ready")
      void voice.start(choice, story.language);
  }, [choice, state.mode, transport, voice, story.language]);
  const finishVoiceChoice = useCallback(() => voice.finish(), [voice]);
  const cancelVoiceChoice = useCallback(
    () => voice.cancel("Sesli seçim iptal edildi. Seçeneğe dokunabilirsin."),
    [voice],
  );
  useEffect(() => {
    if (
      !voicePreparing &&
      state.mode !== "recordingChoice" &&
      state.mode !== "resolvingChoice"
    )
      return;
    const timer = setTimeout(() => voice.cancel(VOICE_RETRY), 15_000);
    return () => clearTimeout(timer);
  }, [voice, voicePreparing, state.mode]);

  const continueSaved = useCallback(async () => {
    if (!resumeSnapshot) return;
    dispatch({ type: "RESTORE", snapshot: resumeSnapshot });
    setResumeSnapshot(null);
    const savedSegment = getCurrentSegment(story, resumeSnapshot);
    if (savedSegment) {
      pendingSeekRef.current = {
        requestId: ++seekRequestIdRef.current,
        segmentId: savedSegment.id,
        positionSeconds: resumeSnapshot.positionSeconds,
        resumeAfterSeek: false,
      };
      setSourceRetry((n) => n + 1);
    }
  }, [player, resumeSnapshot, story]);

  const restart = useCallback(async () => {
    voice.cancel();
    player.pause();
    ++seekRequestIdRef.current;
    pendingSeekRef.current = null;
    try {
      await clearProgress(story.id, context);
    } catch {
      setTransportError("İlerleme sıfırlanamadı. Tekrar dene.");
      return;
    }
    dispatch({ type: "RESTART" });
    setResumeSnapshot(null);
    setSourceRetry((n) => n + 1);
  }, [dispatch, player, story.id, context, voice]);

  return {
    transport:
      state.mode === "completed"
        ? "ended"
        : transport === "ready"
          ? !status.isLoaded
            ? "preparing"
            : status.isBuffering
              ? "buffering"
              : state.mode === "playing"
                ? "playing"
                : "paused"
          : transport,
    transportError,
    retryTransport: () => {
      if (currentSegment)
        pendingSeekRef.current = {
          requestId: ++seekRequestIdRef.current,
          segmentId: currentSegment.id,
          positionSeconds: state.positionSeconds,
          resumeAfterSeek: state.mode === "playing",
        };
      setSourceRetry((n) => n + 1);
    },
    state,
    status,
    choice,
    currentSegment,
    playbackSection,
    playbackSectionElapsed,
    sectionNavigation,
    isHydrating,
    resumeSnapshot,
    togglePlayback,
    chooseOption,
    seekToPlaybackSection,
    navigateToSection,
    startVoiceChoice,
    finishVoiceChoice,
    cancelVoiceChoice,
    voicePreparing,
    continueSaved,
    restart,
  };
}
