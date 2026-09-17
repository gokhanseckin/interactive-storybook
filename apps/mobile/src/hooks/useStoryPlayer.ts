import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { getAudioSource } from '../audio/audioAssets';
import { getAudioDurationSeconds } from '../audio/audioDurations';
import { resolveChoiceFromTranscripts } from '../domain/choiceResolver';
import {
  buildPlaybackSection,
  findPlaybackSectionTarget,
  getSectionNavigation,
  getPlaybackSectionElapsed,
  type SectionNavigationTarget,
} from '../domain/playbackSection';
import {
  createInitialPlayerState,
  getChoiceNode,
  getCurrentSegment,
  hasMeaningfulProgress,
  reducePlayer,
  type PlayerEvent,
  type PlayerState,
} from '../domain/playerMachine';
import type { Story } from '../domain/storySchema';
import { clearProgress, loadProgress, saveProgress } from '../services/progressStore';

const VOICE_UNAVAILABLE_MESSAGE =
  'Bu cihazda çevrimdışı ses tanıma kullanılamıyor. Seçeneğe dokunabilirsin.';
const VOICE_NOT_RECOGNIZED_MESSAGE =
  'Söylediğin seçeneği anlayamadım. Tekrar söyleyebilir veya dokunabilirsin.';
const OFFLINE_MODEL_MESSAGE =
  'Çevrimdışı dil paketini indirmen için cihaz penceresi açıldı. Bu sırada seçeneğe dokunabilirsin.';

function normalizeLocale(locale: string): string {
  return locale.replaceAll('_', '-').toLowerCase();
}

export function useStoryPlayer(story: Story) {
  const [state, dispatchBase] = useReducer(
    (current: PlayerState, event: PlayerEvent) => reducePlayer(story, current, event),
    story,
    createInitialPlayerState,
  );
  const [isHydrating, setIsHydrating] = useState(true);
  const [resumeSnapshot, setResumeSnapshot] = useState<PlayerState | null>(null);
  const currentSegment = useMemo(() => getCurrentSegment(story, state), [state, story]);
  const choice = useMemo(() => getChoiceNode(story, state), [state, story]);
  const stateRef = useRef(state);
  const choiceRef = useRef(choice);
  const voiceSessionActiveRef = useRef(false);
  const voiceResultHandledRef = useRef(false);
  const finishedSegmentRef = useRef<string | null>(null);
  const readySegmentRef = useRef<string | null>(null);
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
  const player = useAudioPlayer(null, { updateInterval: 250, downloadFirst: true });
  const status = useAudioPlayerStatus(player);
  const playbackSection = useMemo(
    () => buildPlaybackSection(story, state, getAudioDurationSeconds),
    [state, story],
  );
  const playbackSectionElapsed = playbackSection
    ? getPlaybackSectionElapsed(
        playbackSection, state, pendingSeekRef.current ? state.positionSeconds : status.currentTime,
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

  useEffect(() => {
    choiceRef.current = choice;
  }, [choice]);

  const restorePlaybackAudioMode = useCallback(() => {
    setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
  }, []);

  useSpeechRecognitionEvent('result', (event) => {
    if (!event.isFinal || !voiceSessionActiveRef.current) return;

    voiceResultHandledRef.current = true;
    voiceSessionActiveRef.current = false;
    restorePlaybackAudioMode();
    dispatch({ type: 'START_RESOLVING' });

    const activeChoice = choiceRef.current;
    const optionId = activeChoice
      ? resolveChoiceFromTranscripts(
          event.results.map(({ transcript }) => transcript),
          activeChoice.options,
          story.language,
        )
      : null;

    dispatch(
      optionId
        ? { type: 'SELECT_OPTION', optionId }
        : { type: 'VOICE_FAILED', message: VOICE_NOT_RECOGNIZED_MESSAGE },
    );
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!voiceSessionActiveRef.current || event.error === 'aborted') return;
    voiceSessionActiveRef.current = false;
    voiceResultHandledRef.current = true;
    restorePlaybackAudioMode();
    dispatch({
      type: 'VOICE_FAILED',
      message:
        event.error === 'no-speech' || event.error === 'speech-timeout'
          ? VOICE_NOT_RECOGNIZED_MESSAGE
          : VOICE_UNAVAILABLE_MESSAGE,
    });
  });

  useSpeechRecognitionEvent('end', () => {
    restorePlaybackAudioMode();
    if (!voiceSessionActiveRef.current || voiceResultHandledRef.current) return;
    voiceSessionActiveRef.current = false;
    dispatch({ type: 'VOICE_FAILED', message: VOICE_NOT_RECOGNIZED_MESSAGE });
  });

  useEffect(() => {
    restorePlaybackAudioMode();
    return () => {
      if (voiceSessionActiveRef.current) ExpoSpeechRecognitionModule.abort();
    };
  }, [restorePlaybackAudioMode]);

  useEffect(() => {
    let mounted = true;
    loadProgress(story.id)
      .then((snapshot) => {
        if (!mounted || !snapshot) return;
        if (hasMeaningfulProgress(story, snapshot) && snapshot.mode !== 'completed') {
          setResumeSnapshot(snapshot);
        }
      })
      .finally(() => {
        if (mounted) setIsHydrating(false);
      });
    return () => {
      mounted = false;
    };
  }, [story]);

  useEffect(() => {
    if (!currentSegment) return;
    finishedSegmentRef.current = null;
    readySegmentRef.current = null;
    player.pause();
    player.replace(
      getAudioSource(
        currentSegment.audioKey ?? `${story.id}/${story.language}/${currentSegment.id}`,
      ),
    );
  }, [currentSegment?.id, player, story.id, story.language]);

  useEffect(() => {
    if (
      currentSegment &&
      status.isLoaded &&
      !status.didJustFinish &&
      status.currentTime <= 0.5
    ) {
      readySegmentRef.current = currentSegment.id;
    }
  }, [currentSegment, status.currentTime, status.didJustFinish, status.isLoaded]);

  useEffect(() => {
    const pending = pendingSeekRef.current;
    if (
      !pending ||
      !currentSegment ||
      pending.segmentId !== currentSegment.id ||
      readySegmentRef.current !== currentSegment.id ||
      !status.isLoaded ||
      applyingSeekRef.current === pending.requestId
    ) {
      return;
    }

    applyingSeekRef.current = pending.requestId;
    player.seekTo(pending.positionSeconds).then(() => {
      if (seekRequestIdRef.current !== pending.requestId) return;
      pendingSeekRef.current = null;
      lastSavedSecondRef.current = -1;
      setSeekRevision(value => value + 1);
      if (pending.resumeAfterSeek) dispatch({ type: 'PLAY' });
    }).catch(() => {
      if (seekRequestIdRef.current !== pending.requestId) return;
      pendingSeekRef.current = null;
      setSeekRevision(value => value + 1);
      dispatch({ type: 'PAUSE' });
    });
  }, [currentSegment, dispatch, player, status.isLoaded, status.currentTime, seekRevision]);

  useEffect(() => {
    if (
      state.mode === 'playing' &&
      currentSegment &&
      status.isLoaded &&
      readySegmentRef.current === currentSegment.id
    ) {
      player.play();
    } else if (state.mode !== 'playing') {
      player.pause();
    }
  }, [currentSegment, player, state.mode, status.isLoaded]);

  useEffect(() => {
    if (!currentSegment || !status.didJustFinish || pendingSeekRef.current) return;
    if (readySegmentRef.current !== currentSegment.id) return;
    if (finishedSegmentRef.current === currentSegment.id) return;
    finishedSegmentRef.current = currentSegment.id;
    dispatch({ type: 'AUDIO_FINISHED' });
  }, [currentSegment, dispatch, status.didJustFinish]);

  useEffect(() => {
    if (state.mode !== 'playing' || !status.isLoaded || pendingSeekRef.current) return;
    const wholeSecond = Math.floor(status.currentTime);
    if (wholeSecond === lastSavedSecondRef.current) return;
    lastSavedSecondRef.current = wholeSecond;
    dispatch({ type: 'PROGRESS', positionSeconds: status.currentTime });
  }, [dispatch, state.mode, status.currentTime, status.isLoaded]);

  useEffect(() => {
    if (isHydrating || resumeSnapshot) return;
    saveProgress(state).catch(() => undefined);
  }, [isHydrating, resumeSnapshot, state]);

  useEffect(() => {
    if (state.mode !== 'awaitingChoice' || state.guidancePlayed) return;
    const timer = setTimeout(() => dispatch({ type: 'GUIDANCE_TIMEOUT' }), 8_000);
    return () => clearTimeout(timer);
  }, [dispatch, state.guidancePlayed, state.mode]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;
      if (voiceSessionActiveRef.current) {
        voiceSessionActiveRef.current = false;
        voiceResultHandledRef.current = true;
        ExpoSpeechRecognitionModule.abort();
        restorePlaybackAudioMode();
        dispatch({ type: 'VOICE_FAILED', message: VOICE_NOT_RECOGNIZED_MESSAGE });
      }
      player.pause();
      dispatch({ type: 'PAUSE' });
      saveProgress({
        ...stateRef.current,
        mode:
          stateRef.current.mode === 'playing' ? 'paused' : stateRef.current.mode,
        positionSeconds: player.currentTime,
      }).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [dispatch, player, restorePlaybackAudioMode]);

  const togglePlayback = useCallback(() => {
    dispatch({ type: state.mode === 'playing' ? 'PAUSE' : 'PLAY' });
  }, [dispatch, state.mode]);

  const chooseOption = useCallback(
    (optionId: string) => {
      player.pause();
      dispatch({ type: 'SELECT_OPTION', optionId });
    },
    [dispatch, player],
  );

  const seekToPlaybackSection = useCallback(
    (seconds: number) => {
      if (!playbackSection) return;
      const target = findPlaybackSectionTarget(playbackSection, seconds);
      if (!target) return;

      const requestId = seekRequestIdRef.current + 1;
      seekRequestIdRef.current = requestId;
      pendingSeekRef.current = {
        requestId,
        segmentId: target.item.segment.id,
        positionSeconds: target.positionSeconds,
        resumeAfterSeek: state.mode === 'playing',
      };
      setSeekRevision(value => value + 1);
      player.pause();
      dispatch({
        type: 'SEEK',
        nodeId: target.item.nodeId,
        segmentIndex: target.item.segmentIndex,
        trackKind: target.item.trackKind,
        selectedOptionId: target.item.selectedOptionId,
        positionSeconds: target.positionSeconds,
      });
    },
    [dispatch, playbackSection, player, state.mode],
  );

  const navigateToSection = useCallback(
    (target: SectionNavigationTarget) => {
      const targetSegment = story.nodes[target.nodeId];
      if (!targetSegment || targetSegment.kind !== 'narration') return;

      const requestId = seekRequestIdRef.current + 1;
      seekRequestIdRef.current = requestId;
      pendingSeekRef.current = {
        requestId,
        segmentId: targetSegment.segments[0]!.id,
        positionSeconds: 0,
        resumeAfterSeek: state.mode === 'playing' || state.mode === 'awaitingChoice',
      };
      setSeekRevision(value => value + 1);
      player.pause();
      dispatch({ type: 'SEEK', ...target });
    },
    [dispatch, player, state.mode, story.nodes],
  );

  const startVoiceChoice = useCallback(async () => {
    if (!choice || state.mode !== 'awaitingChoice') return;

    const supportsOnDeviceRecognition =
      ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();

    if (
      supportsOnDeviceRecognition &&
      Platform.OS === 'android' &&
      Number(Platform.Version) >= 33
    ) {
      try {
        const { installedLocales } =
          await ExpoSpeechRecognitionModule.getSupportedLocales({});
        const requestedLocale = normalizeLocale(story.language);
        const localeIsInstalled = installedLocales.some(
          (locale) => normalizeLocale(locale) === requestedLocale,
        );

        if (!localeIsInstalled) {
          await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
            locale: story.language,
          });
          dispatch({ type: 'VOICE_FAILED', message: OFFLINE_MODEL_MESSAGE });
          return;
        }
      } catch {
        // Starting below remains privacy-safe because on-device recognition is mandatory.
      }
    }

    if (!supportsOnDeviceRecognition) {
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        try {
          await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
            locale: story.language,
          });
          dispatch({ type: 'VOICE_FAILED', message: OFFLINE_MODEL_MESSAGE });
          return;
        } catch {
          // The tap fallback below is intentionally retained when Android cannot download a pack.
        }
      }
      dispatch({ type: 'VOICE_FAILED', message: VOICE_UNAVAILABLE_MESSAGE });
      return;
    }

    const permission = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    if (!permission.granted) {
      dispatch({
        type: 'VOICE_FAILED',
        message: 'Mikrofon izni kapalı. Seçeneğe dokunarak devam edebilirsin.',
      });
      return;
    }

    try {
      voiceSessionActiveRef.current = true;
      voiceResultHandledRef.current = false;
      dispatch({ type: 'START_RECORDING' });
      ExpoSpeechRecognitionModule.start({
        lang: story.language,
        contextualStrings: choice.options.flatMap(({ label, voiceHints }) => [
          label,
          ...voiceHints,
        ]),
        continuous: false,
        interimResults: false,
        maxAlternatives: 5,
        requiresOnDeviceRecognition: true,
      });
    } catch {
      voiceSessionActiveRef.current = false;
      dispatch({ type: 'VOICE_FAILED', message: VOICE_UNAVAILABLE_MESSAGE });
    }
  }, [choice, dispatch, state.mode, story.language]);

  const finishVoiceChoice = useCallback(() => {
    if (!choice || state.mode !== 'recordingChoice' || !voiceSessionActiveRef.current) return;
    dispatch({ type: 'START_RESOLVING' });
    ExpoSpeechRecognitionModule.stop();
  }, [choice, dispatch, state.mode]);

  useEffect(() => {
    if (state.mode !== 'recordingChoice') return;
    const timer = setTimeout(finishVoiceChoice, 10_000);
    return () => clearTimeout(timer);
  }, [finishVoiceChoice, state.mode]);

  const continueSaved = useCallback(async () => {
    if (!resumeSnapshot) return;
    dispatch({ type: 'RESTORE', snapshot: resumeSnapshot });
    setResumeSnapshot(null);
    const savedSegment = getCurrentSegment(story, {
      ...resumeSnapshot,
      mode: 'paused',
    });
    if (savedSegment) {
      player.replace(
        getAudioSource(
          savedSegment.audioKey ?? `${story.id}/${story.language}/${savedSegment.id}`,
        ),
      );
    }
    if (resumeSnapshot.positionSeconds > 0) {
      setTimeout(() => {
        player.seekTo(resumeSnapshot.positionSeconds).catch(() => undefined);
      }, 250);
    }
  }, [player, resumeSnapshot, story]);

  const restart = useCallback(async () => {
    player.pause();
    await clearProgress(story.id);
    dispatch({ type: 'RESTART' });
    setResumeSnapshot(null);
  }, [dispatch, player, story.id]);

  return {
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
    continueSaved,
    restart,
  };
}
