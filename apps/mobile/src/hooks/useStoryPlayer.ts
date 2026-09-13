import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

import { getAudioSource } from '../audio/audioAssets';
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
import { resolveSpokenChoice } from '../services/choiceApi';
import { clearProgress, loadProgress, saveProgress } from '../services/progressStore';

export function useStoryPlayer(story: Story) {
  const [state, dispatchBase] = useReducer(
    (current: PlayerState, event: PlayerEvent) => reducePlayer(story, current, event),
    story,
    createInitialPlayerState,
  );
  const [isHydrating, setIsHydrating] = useState(true);
  const [resumeSnapshot, setResumeSnapshot] = useState<PlayerState | null>(null);
  const stateRef = useRef(state);
  const finishedSegmentRef = useRef<string | null>(null);
  const readySegmentRef = useRef<string | null>(null);
  const lastSavedSecondRef = useRef(-1);
  const player = useAudioPlayer(null, { updateInterval: 250, downloadFirst: true });
  const status = useAudioPlayerStatus(player);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderStatus = useAudioRecorderState(recorder, 250);

  const currentSegment = useMemo(() => getCurrentSegment(story, state), [state, story]);
  const choice = useMemo(() => getChoiceNode(story, state), [state, story]);

  const dispatch = useCallback((event: PlayerEvent) => {
    dispatchBase(event);
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
  }, []);

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
    player.replace(getAudioSource(currentSegment.audioKey));
  }, [currentSegment?.id, player]);

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
    if (state.mode === 'playing' && currentSegment) {
      player.play();
    } else {
      player.pause();
    }
  }, [currentSegment, player, state.mode]);

  useEffect(() => {
    if (!currentSegment || !status.didJustFinish) return;
    if (readySegmentRef.current !== currentSegment.id) return;
    if (finishedSegmentRef.current === currentSegment.id) return;
    finishedSegmentRef.current = currentSegment.id;
    dispatch({ type: 'AUDIO_FINISHED' });
  }, [currentSegment, dispatch, status.didJustFinish]);

  useEffect(() => {
    if (state.mode !== 'playing' || !status.isLoaded) return;
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
  }, [dispatch, player]);

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

  const startVoiceChoice = useCallback(async () => {
    if (!choice || state.mode !== 'awaitingChoice') return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      dispatch({
        type: 'VOICE_FAILED',
        message: 'Mikrofon izni kapalı. Seçeneğe dokunarak devam edebilirsin.',
      });
      return;
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: 10 });
    dispatch({ type: 'START_RECORDING' });
  }, [choice, dispatch, recorder, state.mode]);

  const finishVoiceChoice = useCallback(async (recordingAlreadyStopped = false) => {
    if (!choice || state.mode !== 'recordingChoice') return;
    if (!recordingAlreadyStopped) await recorder.stop();
    dispatch({ type: 'START_RESOLVING' });
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });

    const recordingUri = recorder.uri ?? recorderStatus.url;
    if (!recordingUri) {
      dispatch({ type: 'VOICE_FAILED', message: 'Ses kaydı alınamadı. Tekrar deneyebilirsin.' });
      return;
    }

    try {
      const optionId = await resolveSpokenChoice(recordingUri, choice.options);
      dispatch({ type: 'SELECT_OPTION', optionId });
    } catch (error) {
      dispatch({
        type: 'VOICE_FAILED',
        message: error instanceof Error ? error.message : 'Ses seçimi tamamlanamadı.',
      });
    }
  }, [choice, dispatch, recorder, recorderStatus.url, state.mode]);

  useEffect(() => {
    if (
      state.mode === 'recordingChoice' &&
      !recorderStatus.isRecording &&
      recorderStatus.durationMillis >= 9_500
    ) {
      finishVoiceChoice(true);
    }
  }, [finishVoiceChoice, recorderStatus.durationMillis, recorderStatus.isRecording, state.mode]);

  const continueSaved = useCallback(async () => {
    if (!resumeSnapshot) return;
    dispatch({ type: 'RESTORE', snapshot: resumeSnapshot });
    setResumeSnapshot(null);
    player.replace(
      getAudioSource(
        getCurrentSegment(story, { ...resumeSnapshot, mode: 'paused' })?.audioKey ?? 'intro',
      ),
    );
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
    isHydrating,
    resumeSnapshot,
    togglePlayback,
    chooseOption,
    startVoiceChoice,
    finishVoiceChoice,
    continueSaved,
    restart,
  };
}
