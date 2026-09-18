import { describe, it, expect, vi } from "vitest";
import { VoiceChoiceSession } from "./voiceChoiceSession";
import { sampleStory } from "./sampleStory";
import {
  createInitialPlayerState,
  reducePlayer,
  type PlayerState,
} from "./playerMachine";
const choice = sampleStory.nodes["silver-leaf-choice"];
if (choice.kind !== "choice") throw new Error("fixture");
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function setup(api: number | null = 33) {
  let state: PlayerState = {
    ...createInitialPlayerState(sampleStory),
    nodeId: choice.id,
    trackKind: "choicePrompt",
    mode: "awaitingChoice",
  };
  const native = {
    supportsOnDeviceRecognition: vi.fn(() => true),
    getSupportedLocales: vi.fn(async () => ({
      locales: ["tr-TR"],
      installedLocales: ["tr_TR"],
    })),
    androidTriggerOfflineModelDownload: vi.fn(async () => {}),
    requestMicrophonePermissionsAsync: vi.fn(async () => ({ granted: true })),
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };
  const dispatch = vi.fn((event) => {
    state = reducePlayer(sampleStory, state, event);
  });
  const session = new VoiceChoiceSession(
    native,
    api,
    dispatch,
    vi.fn(),
    vi.fn(),
  );
  return { native, session, dispatch, state: () => state };
}
describe("on-device voice lifecycle (fake recognizer, not native acceptance)", () => {
  it("requires on-device recognition, disables persistence and resolves only on native end", async () => {
    const t = setup();
    await t.session.start(choice, "tr-TR");
    expect(t.native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        requiresOnDeviceRecognition: true,
        recordingOptions: { persist: false },
        maxAlternatives: 5,
      }),
    );
    t.session.result(true, [{ transcript: choice.options[0].label }]);
    expect(t.state().selectedOptionId).toBeNull();
    t.session.end();
    expect(t.state().selectedOptionId).toBe(choice.options[0].id);
    expect(JSON.stringify(t.state())).not.toContain("transcript");
  });
  it("denied permission leaves both tap choices usable", async () => {
    const t = setup();
    t.native.requestMicrophonePermissionsAsync.mockResolvedValue({
      granted: false,
    });
    await t.session.start(choice, "tr-TR");
    expect(t.native.start).not.toHaveBeenCalled();
    expect(t.state().mode).toBe("awaitingChoice");
    t.dispatch({ type: "SELECT_OPTION", optionId: choice.options[1].id });
    expect(t.state().selectedOptionId).toBe(choice.options[1].id);
  });
  it.each([null, 33])(
    "unsupported locale never starts recognition (%s)",
    async (api) => {
      const t = setup(api);
      await t.session.start(choice, "zz-ZZ");
      expect(t.native.start).not.toHaveBeenCalled();
      expect(
        t.native.androidTriggerOfflineModelDownload,
      ).not.toHaveBeenCalled();
      expect(t.state().mode).toBe("awaitingChoice");
    },
  );
  it("offers an Android model download without recording and preserves taps when download fails offline", async () => {
    const t = setup();
    t.native.getSupportedLocales.mockResolvedValue({
      locales: ["tr-TR"],
      installedLocales: [],
    });
    t.native.androidTriggerOfflineModelDownload.mockRejectedValue(
      new Error("offline"),
    );
    await t.session.start(choice, "tr-TR");
    expect(t.native.androidTriggerOfflineModelDownload).toHaveBeenCalledOnce();
    expect(t.native.requestMicrophonePermissionsAsync).not.toHaveBeenCalled();
    expect(t.native.start).not.toHaveBeenCalled();
    expect(t.state().mode).toBe("awaitingChoice");
  });
  it("does not fall back to a network recognizer when on-device recognition is unavailable", async () => {
    const t = setup();
    t.native.supportsOnDeviceRecognition.mockReturnValue(false);
    await t.session.start(choice, "tr-TR");
    expect(t.native.start).not.toHaveBeenCalled();
  });
  it("cancels a pending microphone permission request when a tap wins", async () => {
    const t = setup();
    const pending = deferred<{ granted: boolean }>();
    t.native.requestMicrophonePermissionsAsync.mockReturnValue(pending.promise);
    const start = t.session.start(choice, "tr-TR");
    await Promise.resolve();
    t.session.cancel();
    t.dispatch({ type: "SELECT_OPTION", optionId: choice.options[1].id });
    pending.resolve({ granted: true });
    await start;
    expect(t.native.start).not.toHaveBeenCalled();
    expect(t.state().selectedOptionId).toBe(choice.options[1].id);
  });
  it("ignores locale results after cancellation and deduplicates repeated starts", async () => {
    const t = setup();
    const pending = deferred<{
      locales: string[];
      installedLocales: string[];
    }>();
    t.native.getSupportedLocales.mockReturnValue(pending.promise);
    const start = t.session.start(choice, "tr-TR");
    await t.session.start(choice, "tr-TR");
    expect(t.native.getSupportedLocales).toHaveBeenCalledOnce();
    t.session.cancel();
    pending.resolve({ locales: ["tr-TR"], installedLocales: [] });
    await start;
    expect(t.native.androidTriggerOfflineModelDownload).not.toHaveBeenCalled();
  });
  it("keeps tap selection after interruption and late native events", async () => {
    const t = setup();
    await t.session.start(choice, "tr-TR");
    t.session.cancel("Interrupted");
    t.dispatch({ type: "SELECT_OPTION", optionId: choice.options[1].id });
    t.session.result(true, [{ transcript: choice.options[0].label }]);
    t.session.error("aborted");
    t.session.end();
    expect(t.native.abort).toHaveBeenCalledOnce();
    expect(t.state().selectedOptionId).toBe(choice.options[1].id);
  });
  it("blocks a new native session until the old end arrives", async () => {
    const t = setup();
    await t.session.start(choice, "tr-TR");
    t.session.cancel();
    await t.session.start(choice, "tr-TR");
    expect(t.native.start).toHaveBeenCalledTimes(1);
    t.session.end();
    await t.session.start(choice, "tr-TR");
    expect(t.native.start).toHaveBeenCalledTimes(2);
  });
  it("abstains on no final result and catches permission API rejection", async () => {
    const t = setup();
    await t.session.start(choice, "tr-TR");
    t.session.result(false, [{ transcript: choice.options[0].label }]);
    t.session.end();
    expect(t.state().mode).toBe("awaitingChoice");
    expect(t.state().selectedOptionId).toBeNull();
    t.native.requestMicrophonePermissionsAsync.mockRejectedValue(
      new Error("permission API failed"),
    );
    await t.session.start(choice, "tr-TR");
    expect(t.state().mode).toBe("awaitingChoice");
  });
});
