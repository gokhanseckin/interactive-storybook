# Masal Yolu — technical foundation spike

This repository contains the first runnable slice of the interactive audio storybook:

- `apps/mobile`: Expo SDK 57 / React Native listener app
- `services/audio-api`: server-only ElevenLabs speech boundary

The active story is **Çalıların Ardındaki Gizli Bahçe**, narrated by the selected
ElevenLabs voice `BwhlzGpUiZ9uHtfvCl1H` (Mert Aksoy), using `eleven_v3` and Natural
stability (`0.5`). Six approved continuous MP3 tracks cover section 1, its choice,
both outcomes, section 2, and an optional answer reminder. The slice ends with
“Birini seçin.” before the second choice question.

The older kite story remains a test fixture with local macOS placeholder audio.

## What the spike proves

The next-stage roadmap is documented in
[`docs/story-platform-development-plan.md`](docs/story-platform-development-plan.md),
covering Story Studio, independent placeholder visibility, publication, progressive
MP3 playback, downloads, and offline storage. These features are planned, not yet
implemented by this spike.

- Audio playback with a large pause/play control
- Two equal cosmetic outcomes that return to one fixed story sequence
- One spoken guidance message after eight seconds, with no automatic choice
- Microphone access only after the story reaches a choice
- On-device speech recognition that is forbidden from falling back to the network
- Local choice resolution from multiple transcript alternatives and localized hints
- Local progress persistence and continue/restart recovery
- A validated JSON story shape with clean `text`, reviewed inline `ttsText`, and editorial speaker/direction metadata

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

Do not place the ElevenLabs key in the Expo app. Configure it only in the server process:

```bash
cd services/audio-api
test -f .env || cp .env.example .env
# Add ELEVENLABS_API_KEY to .env locally.
npm install
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
npm run generate:hidden-garden-preview # section 1 only
npm run generate:hidden-garden-slice   # verify existing tracks; generate missing tracks
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

# Requires ELEVENLABS_API_KEY and uses synthetic speech, never a child's recording.
npm run test:live-speech
```

Real-device acceptance checks:

1. Pause and resume in the middle of every clip.
2. Complete the story once through each option and confirm both outcomes return to the same Bay Makara passage.
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

The early release uses complete, playable MP3 files without DRM; DRM investment
is deferred until the product demonstrates traction. See
[`docs/adr-002-mp3-delivery-without-drm.md`](docs/adr-002-mp3-delivery-without-drm.md)
for the accepted delivery decision and its implications.

`POST /v1/tts` accepts:

```json
{
  "text": "Güneş. Ay. Yıldız.",
  "ttsText": "Güneş. [short pause] Ay. [short pause] Yıldız.",
  "language": "tr-TR",
  "voice": "BwhlzGpUiZ9uHtfvCl1H",
  "stability": 0.5
}
```

`ttsText` is optional. Removing its audio tags must reproduce `text` exactly.
Natural-language editorial directions and speaker profiles are not sent to the
provider. Only reviewed inline tags affect delivery. The endpoint uses
`eleven_v3`, MP3 44.1 kHz / 128 kb/s, and no automatic generation retries.
`ELEVENLABS_VOICE_ID` configures the endpoint's default voice; the story's recorded
voice ID controls batch generation to preserve the approved cast.

## ElevenLabs audio edition

- `apps/mobile/src/domain/hiddenGardenStory.json`: active six-track edition, including clean and tagged text.
- `apps/mobile/src/audio/hiddenGardenAudio.json`: measured durations, audio SHA-256 hashes, and original segment IDs.
- `content/calarin-ardindaki-gizli-bahce/speaker-segmented-edition.json`: preserved detailed manuscript for editing.
- `content/calarin-ardindaki-gizli-bahce/elevenlabs-preview`: listening-test requests and receipts.

Existing MP3s are reused only when their checksums and request fingerprints match. Missing assets can be
regenerated with the batch command; this uses credits and updates measured
durations and checksums. Generation requires `afinfo` on macOS or `ffprobe` on
Linux. Restore approved assets from private artifact storage when possible.
Revised recordings should use a new edition rather than overwrite approved files.

The edition has a new story ID, so saved positions from the former 86-clip
recording do not resume at incorrect positions. Both choice outcomes rejoin
section 2, section navigation remains available, and child voice choices still
run entirely on-device. The mobile bundle contains no provider credentials.

The OpenAI preview generator and prompt helpers are retained only as historical
comparison tools; active API, batch generation, and live TTS checks use ElevenLabs.

## Story Studio and remote books

Use Node 22.13 or later. Install root dependencies with `npm ci`, and mobile dependencies
with `npm ci --prefix apps/mobile`. Copy `services/content-api/.env.example` to
`services/content-api/.env`, replace `SESSION_SECRET` with a random 32+ character secret,
and provision a local account:

```sh
STUDIO_PASSWORD='choose-a-long-local-password' npm run studio:user -- author@example.com creator,publisher
npm run dev
```

Open http://localhost:4400 for Story Studio. The content service serves Studio from the
same origin. Password hashes and sessions are stored only in the private DATA_DIR.
Create a draft, save card details, import/edit scenes, upload each MP3, preview the exact
revision, mark it previewed, approve it with a publisher account, freeze a release and
publish. A placeholder is optional. Repeat editing creates a successor draft; active
releases do not change. Generation buttons require explicit paid authorization; provider
keys are never exposed to Studio/mobile. Failed/uncertain provider requests are not
silently retried. An operator can create an admin account with the same user command.

`npm run seed` imports existing approved private recordings into a development catalog
without generating audio. Those six MP3s must already exist in the documented private
asset location. Fixture books are labeled as development content. `APP_ENV=staging` with
its own DATA_DIR and SESSION_SECRET creates an isolated local staging instance; this
does not deploy anything. `npm run backup -- /new/backup/directory` snapshots SQLite and
copies immutable media. Published assets are retained across rollback and withdrawal.

Set `EXPO_PUBLIC_CONTENT_API_URL` in `apps/mobile/.env` to the content service URL reachable
from your simulator/device. Set service PUBLIC_ORIGIN to that same URL so delivery URLs
resolve correctly. Remote catalog refresh downloads metadata, not the books. A selected
book streams narration progressively and prepares both options before offering a choice.
The welcome story remains bundled for first launch offline. Offline downloads require a
new native build (`npm run ios --prefix apps/mobile` or Android equivalent) for StoryStorage.

Run `npm test`, `npm run typecheck`, plus `npm test --prefix apps/mobile` and
`npm run typecheck --prefix apps/mobile`. See
[implementation evidence and open acceptance gates](docs/verification/story-platform.md).
Do not ship until the native and hosted-environment gates recorded there have passed.

Restore rehearsal: stop authoring/generation/media cleanup while taking the database-plus-media
backup, then run `npm run restore -- /backup/directory /new/restore/directory`. This verifies
database integrity, release manifests and all media checksums, refuses an existing destination,
and revokes copied sessions. It does not start a server. Review pending publication schedules
before starting a restored worker. Run one content-service worker per environment.

Native acceptance evidence and remaining shipping gates are maintained in
[Story platform verification](docs/verification/story-platform.md).

### Cloudflare preparation

The existing Studio/mobile API now also has a local Workers + D1 + private R2 +
Workflows implementation. See [Cloudflare adaptation](docs/cloudflare-adaptation.md)
for local migration, account provisioning, tests, environment isolation and remaining
hosted acceptance gates. All checked-in environments disable paid generation; no
cloud resources have been provisioned or deployed.

The native shared-byte playback experiment is opt-in via
`EXPO_PUBLIC_SHARED_AUDIO_CACHE=1`. See [delivery design](docs/story-download-design.md)
and [verification evidence](docs/verification/story-platform.md) before enabling it.
