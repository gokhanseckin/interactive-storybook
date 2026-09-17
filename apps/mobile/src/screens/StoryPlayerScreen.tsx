import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { hiddenGardenStory } from '../domain/hiddenGardenStory';
import { useStoryPlayer } from '../hooks/useStoryPlayer';

const palette = {
  midnight: '#101827',
  midnightRaised: '#182538',
  inkBlue: '#233650',
  moon: '#F3F6F1',
  mist: '#A9B7C6',
  amber: '#F7B955',
  amberDeep: '#D98B25',
  teal: '#76C7BC',
  red: '#F08C7D',
};

function formatTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

type StoryTimelineProps = {
  elapsedSeconds: number;
  totalSeconds: number;
  label: string;
  disabled: boolean;
  onSeek: (seconds: number) => void;
};

function StoryTimeline({
  elapsedSeconds,
  totalSeconds,
  label,
  disabled,
  onSeek,
}: StoryTimelineProps) {
  const [trackWidth, setTrackWidth] = useState(1);
  const [previewSeconds, setPreviewSeconds] = useState<number | null>(null);
  const displayedSeconds = previewSeconds ?? elapsedSeconds;
  const progress = totalSeconds > 0 ? displayedSeconds / totalSeconds : 0;
  const clampedProgress = Math.min(1, Math.max(0, progress));

  const secondsFromEvent = (event: GestureResponderEvent) =>
    Math.min(
      totalSeconds,
      Math.max(0, (event.nativeEvent.locationX / trackWidth) * totalSeconds),
    );

  const updatePreview = (event: GestureResponderEvent) => {
    if (!disabled) setPreviewSeconds(secondsFromEvent(event));
  };

  const commitSeek = (event: GestureResponderEvent) => {
    if (disabled) return;
    const seconds = secondsFromEvent(event);
    setPreviewSeconds(null);
    onSeek(seconds);
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(Math.max(1, event.nativeEvent.layout.width));
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) return;
    const difference = event.nativeEvent.actionName === 'increment' ? 10 : -10;
    onSeek(Math.min(totalSeconds, Math.max(0, elapsedSeconds + difference)));
  };

  if (totalSeconds <= 0) return null;

  return (
    <View style={styles.timelineRegion}>
      <View style={styles.timelineMeta}>
        <Text style={styles.timelineLabel}>{label}</Text>
        <Text style={styles.timelineTime}>
          {formatTime(displayedSeconds)} / {formatTime(totalSeconds)}
        </Text>
      </View>
      <View
        accessible
        accessibilityActions={[
          { name: 'decrement', label: '10 saniye geri git' },
          { name: 'increment', label: '10 saniye ileri git' },
        ]}
        accessibilityLabel={`${label} zaman çizgisi`}
        accessibilityRole="adjustable"
        accessibilityValue={{
          min: 0,
          max: Math.round(totalSeconds),
          now: Math.round(displayedSeconds),
          text: `${formatTime(displayedSeconds)} / ${formatTime(totalSeconds)}`,
        }}
        onAccessibilityAction={handleAccessibilityAction}
        onLayout={handleLayout}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={updatePreview}
        onResponderMove={updatePreview}
        onResponderRelease={commitSeek}
        onResponderTerminate={() => setPreviewSeconds(null)}
        onStartShouldSetResponder={() => !disabled}
        style={[styles.timelineTouchTarget, disabled && styles.timelineDisabled]}
      >
        <View pointerEvents="none" style={styles.timelineTrack}>
          <View style={[styles.timelineFill, { width: `${clampedProgress * 100}%` }]} />
        </View>
        <View
          pointerEvents="none"
          style={[styles.timelineThumb, { left: `${clampedProgress * 100}%` }]}
        />
      </View>
    </View>
  );
}

function SectionSkipIcon({ direction }: { direction: 'previous' | 'next' }) {
  const triangle = (
    <View
      style={
        direction === 'previous'
          ? styles.sectionSkipTrianglePrevious
          : styles.sectionSkipTriangleNext
      }
    />
  );
  const bar = <View style={styles.sectionSkipBar} />;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.sectionSkipGlyph}
    >
      {direction === 'previous' ? bar : triangle}
      {direction === 'previous' ? triangle : bar}
    </View>
  );
}

export function StoryPlayerScreen({ onBack, autoStart = false }: { onBack?: () => void; autoStart?: boolean }) {
  const started = useRef(false);
  const player = useStoryPlayer(hiddenGardenStory);
  const {
    state,
    choice,
    isHydrating,
    resumeSnapshot,
    playbackSection,
    playbackSectionElapsed,
    sectionNavigation,
    togglePlayback,
    chooseOption,
    seekToPlaybackSection,
    navigateToSection,
    startVoiceChoice,
    finishVoiceChoice,
    continueSaved,
    restart,
  } = player;

  useEffect(() => {
    if (!autoStart || isHydrating || started.current) return;
    started.current = true;
    if (!resumeSnapshot) togglePlayback();
  }, [autoStart, isHydrating, resumeSnapshot, togglePlayback]);

  const showChoices = Boolean(
    choice &&
      (state.mode === 'awaitingChoice' ||
        state.mode === 'recordingChoice' ||
        state.mode === 'resolvingChoice' ||
        state.trackKind === 'choicePrompt' ||
        state.trackKind === 'choiceGuidance'),
  );
  const canTapChoice =
    state.mode === 'awaitingChoice' || state.trackKind === 'choiceGuidance';
  const sectionNavigationLocked =
    state.mode === 'recordingChoice' || state.mode === 'resolvingChoice';

  const listeningLabel = useMemo(() => {
    switch (state.mode) {
      case 'playing':
        return state.trackKind === 'choiceGuidance'
          ? 'Küçük bir hatırlatma'
          : 'Hikâyeyi dinliyorsun';
      case 'paused':
        return 'Hazır olduğunda başlat';
      case 'awaitingChoice':
        return 'Sıra sende';
      case 'recordingChoice':
        return 'Seni dinliyorum';
      case 'resolvingChoice':
        return 'Seçimini anlıyorum';
      case 'completed':
        return 'Bölüm tamamlandı';
    }
  }, [state.mode, state.trackKind]);

  const handleMainAction = () => {
    if (state.mode === 'completed') {
      restart();
      return;
    }
    if (state.mode === 'recordingChoice') {
      finishVoiceChoice();
      return;
    }
    if (state.mode === 'awaitingChoice') {
      startVoiceChoice();
      return;
    }
    if (state.mode !== 'resolvingChoice') togglePlayback();
  };

  const mainIcon =
    state.mode === 'playing'
      ? 'Ⅱ'
      : state.mode === 'recordingChoice'
        ? '■'
        : state.mode === 'resolvingChoice'
          ? '…'
          : state.mode === 'awaitingChoice'
            ? '●'
            : state.mode === 'completed'
              ? '↻'
              : '▶';
  const mainActionLabel =
    state.mode === 'playing'
      ? 'Duraklat'
      : state.mode === 'recordingChoice'
        ? 'Kaydı bitir'
        : state.mode === 'resolvingChoice'
          ? 'Bekle'
          : state.mode === 'awaitingChoice'
            ? 'Sesle seç'
            : state.mode === 'completed'
              ? 'Baştan dinle'
              : 'Dinlemeye başla';

  if (isHydrating) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={palette.amber} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.screen}>
        {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Kitaplığa dön" onPress={onBack} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: palette.mist, fontSize: 15 }}>‹  Kitaplığa dön</Text>
        </Pressable>}
        <View style={styles.header}>
          <View style={styles.episodeMark}>
            <Text style={styles.episodeNumber}>{hiddenGardenStory.episode.number}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.seriesTitle}>{hiddenGardenStory.title}</Text>
            <Text style={styles.episodeTitle}>{hiddenGardenStory.episode.title}</Text>
            <Text style={styles.aiVoiceDisclosure}>
              Anlatıcı sesi yapay zekâ ile oluşturulmuştur.
            </Text>
          </View>
        </View>

        <View style={styles.room}>
          <View style={styles.lampGlow} />
          <View style={styles.statusBlock}>
            <Text style={styles.statusText}>{listeningLabel}</Text>
          </View>

          {showChoices && choice ? (
            <View style={styles.choiceRegion} accessibilityRole="radiogroup">
              <Text style={styles.choicePrompt}>Nasıl devam edelim?</Text>
              <View style={styles.choiceSplit}>
                {choice.options.map((option, index) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Seçenek ${index + 1}: ${option.label}`}
                    disabled={!canTapChoice}
                    key={option.id}
                    onPress={() => chooseOption(option.id)}
                    style={({ pressed }) => [
                      styles.choiceButton,
                      index === 0 ? styles.choiceLeft : styles.choiceRight,
                      pressed && styles.choicePressed,
                      !canTapChoice && styles.choiceDisabled,
                    ]}
                  >
                    <Text style={styles.choiceIndex}>{index + 1}</Text>
                    <Text style={styles.choiceLabel}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.voiceHint}>
                Seçeneğe dokun veya aşağıdaki düğmeyle söyle.
              </Text>
            </View>
          ) : (
            <View style={styles.quietCenter}>
              <View style={styles.soundBars} accessibilityElementsHidden>
                {[22, 42, 60, 36, 52, 28].map((height, index) => (
                  <View
                    key={`${height}-${index}`}
                    style={[
                      styles.soundBar,
                      { height, opacity: state.mode === 'playing' ? 1 : 0.42 },
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.quietMessage}>
                {state.mode === 'completed'
                  ? 'Hikâyenin test bölümü burada sona eriyor.'
                  : 'Ekranı izlemen gerekmiyor. Rahatça dinleyebilirsin.'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.controls}>
          {playbackSection ? (
            <StoryTimeline
              disabled={
                state.mode === 'recordingChoice' || state.mode === 'resolvingChoice'
              }
              elapsedSeconds={playbackSectionElapsed}
              label={playbackSection.label}
              onSeek={seekToPlaybackSection}
              totalSeconds={playbackSection.durationSeconds}
            />
          ) : null}

          {state.message ? (
            <Text accessibilityLiveRegion="polite" style={styles.message}>
              {state.message}
            </Text>
          ) : null}

          <View style={styles.transportRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Önceki bölüm"
              accessibilityHint="Bir önceki hikâye bölümünün başına gider."
              disabled={sectionNavigationLocked || !sectionNavigation.previous}
              onPress={() => {
                if (sectionNavigation.previous) {
                  navigateToSection(sectionNavigation.previous);
                }
              }}
              style={({ pressed }) => [
                styles.sectionSkipButton,
                pressed && styles.sectionSkipButtonPressed,
                (sectionNavigationLocked || !sectionNavigation.previous) &&
                  styles.sectionSkipButtonDisabled,
              ]}
            >
              <SectionSkipIcon direction="previous" />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mainActionLabel}
              disabled={state.mode === 'resolvingChoice'}
              onPress={handleMainAction}
              style={({ pressed }) => [
                styles.mainButton,
                pressed && styles.mainButtonPressed,
                state.mode === 'recordingChoice' && styles.recordingButton,
                state.mode === 'resolvingChoice' && styles.mainButtonDisabled,
              ]}
            >
              {state.mode === 'resolvingChoice' ? (
                <ActivityIndicator color={palette.midnight} size="large" />
              ) : (
                <Text style={styles.mainIcon}>{mainIcon}</Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sonraki bölüm"
              accessibilityHint="Bir sonraki hikâye bölümünün başına gider."
              disabled={sectionNavigationLocked || !sectionNavigation.next}
              onPress={() => {
                if (sectionNavigation.next) navigateToSection(sectionNavigation.next);
              }}
              style={({ pressed }) => [
                styles.sectionSkipButton,
                pressed && styles.sectionSkipButtonPressed,
                (sectionNavigationLocked || !sectionNavigation.next) &&
                  styles.sectionSkipButtonDisabled,
              ]}
            >
              <SectionSkipIcon direction="next" />
            </Pressable>
          </View>
          <Text style={styles.mainActionLabel}>{mainActionLabel}</Text>
        </View>
      </View>

      <Modal animationType="fade" transparent visible={Boolean(resumeSnapshot)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.resumeCard}>
            <Text style={styles.resumeTitle}>Kaldığın yer hazır</Text>
            <Text style={styles.resumeText}>
              Bu bölümü kaldığın yerden sürdürebilir veya en baştan dinleyebilirsin.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={continueSaved}
              style={({ pressed }) => [styles.resumePrimary, pressed && styles.buttonPressed]}
            >
              <Text style={styles.resumePrimaryText}>Kaldığım yerden devam et</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={restart}
              style={({ pressed }) => [styles.resumeSecondary, pressed && styles.buttonPressed]}
            >
              <Text style={styles.resumeSecondaryText}>Baştan başla</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.midnight },
  screen: { flex: 1, backgroundColor: palette.midnight, paddingHorizontal: 20 },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.midnight,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 16, gap: 14 },
  episodeMark: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.teal,
  },
  episodeNumber: { color: palette.moon, fontSize: 24, fontWeight: '700' },
  headerText: { flex: 1 },
  seriesTitle: { color: palette.mist, fontSize: 14, lineHeight: 20 },
  episodeTitle: {
    color: palette.moon,
    fontFamily: 'serif',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  aiVoiceDisclosure: { color: palette.mist, fontSize: 11, lineHeight: 15, marginTop: 3 },
  room: { flex: 1, justifyContent: 'center', position: 'relative' },
  lampGlow: {
    position: 'absolute',
    alignSelf: 'center',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#263042',
    opacity: 0.52,
  },
  statusBlock: { alignItems: 'center', marginBottom: 24 },
  statusText: { color: palette.amber, fontSize: 16, fontWeight: '700' },
  quietCenter: { alignItems: 'center', paddingHorizontal: 28 },
  soundBars: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 26,
  },
  soundBar: { width: 5, borderRadius: 3, backgroundColor: palette.teal },
  quietMessage: {
    color: palette.moon,
    fontFamily: 'serif',
    fontSize: 21,
    lineHeight: 30,
    textAlign: 'center',
    maxWidth: 320,
  },
  choiceRegion: { width: '100%', alignItems: 'center' },
  choicePrompt: {
    color: palette.moon,
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  choiceSplit: { flexDirection: 'row', width: '100%', minHeight: 178, gap: 10 },
  choiceButton: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 18,
    borderWidth: 1,
    borderRadius: 22,
  },
  choiceLeft: { backgroundColor: '#173B45', borderColor: palette.teal },
  choiceRight: { backgroundColor: '#3D2C30', borderColor: palette.red },
  choicePressed: { transform: [{ scale: 0.98 }], opacity: 0.85 },
  choiceDisabled: { opacity: 0.55 },
  choiceIndex: { color: palette.moon, fontSize: 13, fontWeight: '800' },
  choiceLabel: { color: palette.moon, fontSize: 17, lineHeight: 24, fontWeight: '700' },
  voiceHint: { color: palette.mist, fontSize: 13, lineHeight: 18, marginTop: 14, textAlign: 'center' },
  controls: { alignItems: 'center', paddingBottom: 14 },
  timelineRegion: { width: '100%', marginBottom: 16 },
  timelineMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  timelineLabel: { color: palette.moon, fontSize: 13, fontWeight: '700' },
  timelineTime: {
    color: palette.mist,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  timelineTouchTarget: {
    width: '100%',
    height: 44,
    justifyContent: 'center',
    position: 'relative',
  },
  timelineTrack: {
    height: 7,
    backgroundColor: palette.inkBlue,
    borderRadius: 4,
    overflow: 'hidden',
  },
  timelineFill: { height: '100%', backgroundColor: palette.amber },
  timelineThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    backgroundColor: palette.moon,
    borderWidth: 4,
    borderColor: palette.amber,
  },
  timelineDisabled: { opacity: 0.45 },
  message: {
    color: palette.moon,
    backgroundColor: palette.midnightRaised,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 12,
  },
  transportRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  sectionSkipButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.midnightRaised,
    borderWidth: 1,
    borderColor: palette.inkBlue,
  },
  sectionSkipButtonPressed: {
    backgroundColor: palette.inkBlue,
    borderColor: palette.teal,
    transform: [{ scale: 0.94 }],
  },
  sectionSkipButtonDisabled: { opacity: 0.25 },
  sectionSkipGlyph: {
    width: 27,
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  sectionSkipBar: {
    width: 4,
    height: 21,
    borderRadius: 2,
    backgroundColor: palette.moon,
  },
  sectionSkipTrianglePrevious: {
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderRightWidth: 16,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: palette.moon,
  },
  sectionSkipTriangleNext: {
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 16,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: palette.moon,
  },
  mainButton: {
    width: 94,
    height: 94,
    borderRadius: 47,
    backgroundColor: palette.amber,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 7,
    borderColor: '#3D352C',
  },
  mainButtonPressed: { transform: [{ scale: 0.96 }], backgroundColor: palette.amberDeep },
  recordingButton: { backgroundColor: palette.red, borderColor: '#4B3034' },
  mainButtonDisabled: { opacity: 0.7 },
  mainIcon: { color: palette.midnight, fontSize: 34, fontWeight: '900', marginLeft: 2 },
  mainActionLabel: { color: palette.moon, fontSize: 14, fontWeight: '700', marginTop: 8 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(5, 10, 18, 0.82)',
  },
  resumeCard: {
    backgroundColor: palette.moon,
    borderRadius: 26,
    padding: 24,
  },
  resumeTitle: {
    color: palette.midnight,
    fontFamily: 'serif',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  resumeText: { color: palette.inkBlue, fontSize: 16, lineHeight: 24, marginTop: 10, marginBottom: 22 },
  resumePrimary: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: palette.midnight,
    paddingHorizontal: 16,
  },
  resumePrimaryText: { color: palette.moon, fontSize: 16, fontWeight: '700' },
  resumeSecondary: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  resumeSecondaryText: { color: palette.midnight, fontSize: 15, fontWeight: '700' },
  buttonPressed: { opacity: 0.72 },
});
