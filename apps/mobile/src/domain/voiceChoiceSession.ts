import type { ExpoSpeechRecognitionOptions } from "expo-speech-recognition";
import type { ChoiceNode } from "./storySchema";
import type { PlayerEvent } from "./playerMachine";
import { resolveChoiceFromTranscripts } from "./choiceResolver";

export const VOICE_UNAVAILABLE =
  "Bu cihazda çevrimdışı ses tanıma kullanılamıyor. Seçeneğe dokunabilirsin.";
export const VOICE_RETRY =
  "Söylediğin seçeneği anlayamadım. Tekrar söyleyebilir veya dokunabilirsin.";
const normalize = (locale: string) => locale.replaceAll("_", "-").toLowerCase();

type Recognizer = {
  supportsOnDeviceRecognition(): boolean;
  getSupportedLocales(options: {}): Promise<{
    locales: string[];
    installedLocales: string[];
  }>;
  androidTriggerOfflineModelDownload(options: {
    locale: string;
  }): Promise<unknown>;
  requestMicrophonePermissionsAsync(): Promise<{ granted: boolean }>;
  start(options: ExpoSpeechRecognitionOptions): void;
  stop(): void;
  abort(): void;
};

/** Owns one native recognition attempt. No audio/transcript is stored or returned. */
export class VoiceChoiceSession {
  private generation = 0;
  private attempt: {
    id: number;
    choice: ChoiceNode;
    locale: string;
    option: string | null;
  } | null = null;
  private nativeBusy = false;
  constructor(
    private native: Recognizer,
    private androidApi: number | null,
    private dispatch: (event: PlayerEvent) => void,
    private preparing: (value: boolean) => void,
    private restoreAudio: () => void,
  ) {}
  async start(choice: ChoiceNode, locale: string) {
    // Events have no session ID. Wait for native end before allowing another attempt.
    if (this.attempt || this.nativeBusy) return;
    const id = ++this.generation;
    this.attempt = { id, choice, locale, option: null };
    const current = () => this.attempt?.id === id;
    this.preparing(true);
    try {
      if (!this.native.supportsOnDeviceRecognition()) {
        this.fail(VOICE_UNAVAILABLE);
        return;
      }
      if (this.androidApi === null || this.androidApi >= 33) {
        const { locales, installedLocales } =
          await this.native.getSupportedLocales({});
        if (!current()) return;
        const requested = normalize(locale);
        const supported = locales.some((l) => normalize(l) === requested);
        const installed = installedLocales.some(
          (l) => normalize(l) === requested,
        );
        if (!supported && !installed) {
          this.fail(VOICE_UNAVAILABLE);
          return;
        }
        if (this.androidApi !== null && !installed) {
          await this.native.androidTriggerOfflineModelDownload({ locale });
          if (current())
            this.fail(
              "Çevrimdışı dil paketi henüz hazır değil. Paketi indirdikten sonra tekrar dene veya seçeneğe dokun.",
            );
          return;
        }
      }
      const permission = await this.native.requestMicrophonePermissionsAsync();
      if (!current()) return;
      if (!permission.granted) {
        this.fail(
          "Mikrofon izni kapalı. Seçeneğe dokunarak devam edebilirsin.",
        );
        return;
      }
      this.preparing(false);
      this.nativeBusy = true;
      this.dispatch({ type: "START_RECORDING" });
      this.native.start({
        lang: locale,
        contextualStrings: choice.options.flatMap((o) => [
          o.label,
          ...o.voiceHints,
        ]),
        continuous: false,
        interimResults: false,
        maxAlternatives: 5,
        requiresOnDeviceRecognition: true,
        recordingOptions: { persist: false },
      });
    } catch {
      if (current()) this.fail(VOICE_UNAVAILABLE);
    }
  }
  result(isFinal: boolean, results: { transcript: string }[]) {
    if (!isFinal || !this.nativeBusy || !this.attempt) return;
    const a = this.attempt;
    a.option = resolveChoiceFromTranscripts(
      results.slice(0, 5).map((r) => r.transcript),
      a.choice.options,
      a.locale,
    );
    this.dispatch({ type: "START_RESOLVING" });
    // Commit only after native end has relinquished the microphone/audio session.
  }
  end() {
    const a = this.attempt;
    if (!this.nativeBusy) return;
    this.nativeBusy = false;
    this.attempt = null;
    this.preparing(false);
    this.restoreAudio();
    if (a)
      this.dispatch(
        a.option
          ? { type: "SELECT_OPTION", optionId: a.option }
          : { type: "VOICE_FAILED", message: VOICE_RETRY },
      );
  }
  error(error: string) {
    if (this.attempt && this.nativeBusy)
      this.fail(
        error === "no-speech" || error === "speech-timeout"
          ? VOICE_RETRY
          : VOICE_UNAVAILABLE,
      );
  }
  finish() {
    if (!this.attempt || !this.nativeBusy) return;
    this.dispatch({ type: "START_RESOLVING" });
    try {
      this.native.stop();
    } catch {
      this.fail(VOICE_UNAVAILABLE);
    }
  }
  cancel(message?: string) {
    const hadAttempt = !!this.attempt;
    this.attempt = null;
    ++this.generation;
    this.preparing(false);
    if (this.nativeBusy) {
      try {
        this.native.abort();
      } catch {
        /* Fail closed; taps still work. */
      }
    }
    this.restoreAudio();
    if (hadAttempt && message) this.dispatch({ type: "VOICE_FAILED", message });
  }
  private fail(message: string) {
    this.cancel(message);
  }
}
