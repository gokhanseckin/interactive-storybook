# Masal Yolu — technical foundation spike

This repository contains the first runnable slice of the interactive audio storybook:

- `apps/mobile`: Expo SDK 57 / React Native listener app
- `services/audio-api`: server-only OpenAI speech boundary

The included sample is a shortened section of **Rüzgârın Sakladığı Uçurtma**. Its bundled WAV files were generated with a local macOS Turkish voice strictly as development placeholders. Production editions must be generated through the server endpoint with `gpt-4o-mini-tts`.

## What the spike proves

- Audio playback with a large pause/play control
- Two equal, converging choices
- One spoken guidance message after eight seconds, with no automatic choice
- Microphone access only after the story reaches a choice
- Server-side transcription with `gpt-4o-mini-transcribe`
- Immediate deletion of the temporary recording after the request succeeds or fails
- Local progress persistence and continue/restart recovery
- A validated JSON story shape with `speaker`, `text`, `style`, and `audioKey`

## Run the mobile app

```bash
cd apps/mobile
npm install
npx expo start --dev-client
```

The app includes `expo-dev-client` and `eas.json`; create the development binary with `eas build --profile development` when the Expo account is connected. Expo Go can be used for a quick simulator-only UI check, but it is not the intended project workflow.

Android development also requires a JDK and Android SDK/ADB, which are not installed on the current machine yet.

## Enable voice choice locally

Do not place the OpenAI key in the Expo app. Configure it only in the server process:

```bash
cd services/audio-api
cp .env.example .env
# Add OPENAI_API_KEY to .env locally.
npm install
set -a && source .env && set +a
npm run dev
```

Then copy `apps/mobile/.env.example` to `apps/mobile/.env` and restart Expo. `127.0.0.1` works for the iOS simulator. Use `10.0.2.2` for the Android emulator. A physical phone needs a reachable development-machine address and the server must be deliberately bound to that interface.

The child voice flow must not be enabled in a production environment until Zero Data Retention is approved for the OpenAI project. The API response contains only the selected option id; it never returns or stores the transcript.

## Verify

```bash
cd apps/mobile
npm run typecheck
npm test

cd ../../services/audio-api
npm run typecheck
npm test
```

Real-device acceptance checks:

1. Pause and resume in the middle of every clip.
2. Complete the story once through each choice and confirm both reach the green-door ending.
3. Wait eight seconds at the choice; guidance plays once and the app keeps waiting.
4. Background or terminate the app mid-clip; relaunch and choose continue or restart.
5. Deny microphone permission; tap selection remains usable.
6. Record a choice, let the ten-second limit expire, and confirm resolution begins automatically.
7. Disconnect the API server; the recording is deleted and tap selection remains available.

## Audio-generation contract

`POST /v1/tts` accepts:

```json
{
  "speaker": "narrator",
  "text": "Kapının ardında hafif bir ışık görünüyordu.",
  "style": "Quiet, mysterious and curious. Build gentle suspense.",
  "voice": "marin"
}
```

The server combines each segment with the base instructions in `services/audio-api/src/prompts.ts`. Character-specific delivery is applied only when the segment belongs to that speaking character.
