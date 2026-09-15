# Masal Yolu — technical foundation spike

This repository contains the first runnable slice of the interactive audio storybook:

- `apps/mobile`: Expo SDK 57 / React Native listener app
- `services/audio-api`: server-only OpenAI speech boundary

The included sample is a shortened section of **Rüzgârın Sakladığı Uçurtma**. Its bundled WAV files were generated with a local macOS Turkish voice strictly as development placeholders. Production editions must be generated through the server endpoint with `gpt-4o-mini-tts`.

## What the spike proves

- Audio playback with a large pause/play control
- Two equal cosmetic outcomes that return to one fixed story sequence
- One spoken guidance message after eight seconds, with no automatic choice
- Microphone access only after the story reaches a choice
- On-device speech recognition that is forbidden from falling back to the network
- Local choice resolution from multiple transcript alternatives and localized hints
- Local progress persistence and continue/restart recovery
- A validated JSON story shape with `speaker`, `text`, and optional `direction`

## Run the mobile app

```bash
cd apps/mobile
npm install
npx expo start --dev-client
```

The app includes `expo-dev-client` and `eas.json`; create the development binary with `eas build --profile development` when the Expo account is connected. Expo Go can be used for a quick simulator-only UI check, but it is not the intended project workflow.

Expo SDK 57 requires Node 22.13 or newer; the mobile workspace declares Node 22
in `.nvmrc`. The current development machine has JDK 17, Node 22, Android command-line
tools, API 36, Build Tools 36.0.0, and ADB installed through Homebrew. In a new
shell, use the following environment when building Android:

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export PATH="/opt/homebrew/opt/node@22/bin:$ANDROID_HOME/platform-tools:$PATH"
```

`adb` is also linked into Homebrew's normal binary path by the
`android-platform-tools` cask.

## Voice choices and privacy

Voice choices run entirely on the phone. The app requires the operating
system's on-device recognizer, resolves the words against the two localized
options, and keeps neither audio nor transcripts. Only the chosen option id may
be persisted or transmitted. See
[`docs/adr-001-on-device-voice-choices.md`](docs/adr-001-on-device-voice-choices.md)
for the architecture and multilingual authoring contract.

This feature requires a development build; it is not available in Expo Go. If
an on-device recognizer or locale pack is unavailable, tap selection remains
available. Android 13+ can offer to download a missing offline language pack.

## Enable narration TTS locally

Do not place the OpenAI key in the Expo app. Configure it only in the server process:

```bash
cd services/audio-api
cp .env.example .env
# Add OPENAI_API_KEY to .env locally.
npm install
set -a && source .env && set +a
npm run dev
```

The API is used to generate production narration, not to process listener
speech. `127.0.0.1` works for the iOS simulator. Use `10.0.2.2` for the Android
emulator. A physical phone needs a reachable development-machine address and
the server must be deliberately bound to that interface.

Generated story narration is deliberately ignored by Git. To create the hidden
garden audio locally, load the server-only key and run:

```bash
cd services/audio-api
set -a && source .env && set +a
npm run generate:hidden-garden-preview # representative 10-clip review set
npm run generate:hidden-garden-slice   # all missing clips in the playable slice
```

The resulting MP3 files live under `apps/mobile/assets/audio/<story>/<locale>/`
for local builds. Production builds must receive the same versioned files from
the deployment's private artifact or object-storage workflow; they must not be
committed to this repository.

## Verify

```bash
cd apps/mobile
npm run typecheck
npm test

cd ../../services/audio-api
npm run typecheck
npm test

# Requires OPENAI_API_KEY and uses synthetic speech, never a child's recording.
npm run test:live-speech
```

Real-device acceptance checks:

1. Pause and resume in the middle of every clip.
2. Complete the story once through each option and confirm both outcomes return to the same green-door scene.
3. Wait eight seconds at the choice; guidance plays once and the app keeps waiting.
4. Background or terminate the app mid-clip; relaunch and choose continue or restart.
5. Deny microphone permission; tap selection remains usable.
6. Say a localized paraphrase of each option and confirm the correct cosmetic outcome plays.
7. Disable networking before speaking and confirm voice choice still works.
8. On a device without the locale pack, confirm the download prompt appears and tap selection remains available.

The latest automated/toolchain results and the remaining hardware-dependent
checks are recorded in
[`docs/verification-2026-09-13.md`](docs/verification-2026-09-13.md).

## Audio-generation contract

`POST /v1/tts` accepts:

```json
{
  "speaker": "narrator",
  "text": "Kapının ardında hafif bir ışık görünüyordu.",
  "globalDirection": "Sekiz-on yaş grubu için sıcak bir hikâye anlatımı kullan.",
  "speakerProfile": "Sakin, anlaşılır ve merak uyandıran bir anlatıcı.",
  "direction": "Hafif bir merak duygusu oluştur.",
  "voice": "marin"
}
```

The server combines each segment with the base instructions in `services/audio-api/src/prompts.ts`. Character-specific delivery is applied only when the segment belongs to that speaking character.
