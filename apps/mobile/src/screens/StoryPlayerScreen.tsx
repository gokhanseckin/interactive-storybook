import { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { sampleStory } from '../domain/sampleStory';
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

export function StoryPlayerScreen() {
  const player = useStoryPlayer(sampleStory);
  const {
    state,
    status,
    choice,
    isHydrating,
    resumeSnapshot,
    togglePlayback,
    chooseOption,
    startVoiceChoice,
    finishVoiceChoice,
    continueSaved,
    restart,
  } = player;

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;
  const showChoices = Boolean(
    choice &&
      (state.mode === 'awaitingChoice' ||
        state.mode === 'recordingChoice' ||
        state.mode === 'resolvingChoice' ||
        state.trackKind === 'choiceGuidance'),
  );
  const canTapChoice =
    state.mode === 'awaitingChoice' || state.trackKind === 'choiceGuidance';

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
        <View style={styles.header}>
          <View style={styles.episodeMark}>
            <Text style={styles.episodeNumber}>{sampleStory.episode.number}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.seriesTitle}>{sampleStory.title}</Text>
            <Text style={styles.episodeTitle}>{sampleStory.episode.title}</Text>
          </View>
        </View>

        <View style={styles.room}>
          <View style={styles.lampGlow} />
          <View style={styles.statusBlock}>
            <Text style={styles.statusText}>{listeningLabel}</Text>
            <Text style={styles.timeText}>
              {formatTime(status.currentTime)} / {formatTime(status.duration)}
            </Text>
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
                  ? 'Yeşil kapının ardındaki macera seni bekliyor.'
                  : 'Ekranı izlemen gerekmiyor. Rahatça dinleyebilirsin.'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.controls}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, Math.max(0, progress * 100))}%` },
              ]}
            />
          </View>

          {state.message ? (
            <Text accessibilityLiveRegion="polite" style={styles.message}>
              {state.message}
            </Text>
          ) : null}

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
  timeText: { color: palette.mist, fontSize: 13, marginTop: 6, fontVariant: ['tabular-nums'] },
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
  progressTrack: {
    width: '100%',
    height: 3,
    backgroundColor: palette.inkBlue,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 18,
  },
  progressFill: { height: '100%', backgroundColor: palette.amber },
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
