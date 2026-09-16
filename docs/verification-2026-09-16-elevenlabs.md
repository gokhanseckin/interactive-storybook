# ElevenLabs migration verification — 16 September 2026

## Repository baseline

GitHub main and local HEAD both resolve to `3859c880466838c6466991d07c01db77b0bff6ae`.
Latest merge: PR #5, “Show choices while the choice prompt plays”, after PR #4,
“Add section skip controls to the story player”. No open PRs at inspection.
Existing app.json, eas.json, .easignore and listening-preview work were preserved.

## Changes

The active edition uses six approved ElevenLabs MP3s, voice
`BwhlzGpUiZ9uHtfvCl1H`, model `eleven_v3`, stability 0.5. The original detailed
86-segment manuscript is preserved under content. The new edition ID isolates
saved positions from the previous recording. Section 2 ends at “Birini seçin.”;
the second choice question is excluded.

The server, batch generator and live TTS check use ElevenLabs. API credentials
remain server-only. The generator validates source fidelity, request fingerprints,
and existing audio hashes. It does not automatically retry provider calls.
Historical OpenAI comparison tooling remains explicitly separate.

## Verification

- Mobile TypeScript check: passed.
- Mobile unit tests: 28 passed, including both choice paths, section navigation,
  timeline seeking, source coverage and clean/inline text fidelity.
- Server TypeScript check: passed.
- Server tests: 6 passed, including provider request shape, invalid input,
  missing credentials, upstream failure and no automatic retries.
- Batch generator: verified six existing asset hashes and request fingerprints;
  no new paid generations.
- Expo Android production export: passed; bundled all six ElevenLabs recordings.
- git diff --check: passed.

The MP3s remain Git-ignored and must be supplied through the private artifact
workflow on another checkout/build machine. This verification does not include
real-device listening, interruption/resume, or on-device speech-recognition checks.
