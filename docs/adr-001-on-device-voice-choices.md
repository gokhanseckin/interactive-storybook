# ADR 001: On-device voice choices

Status: Accepted

Date: 2026-09-13

## Context

Masal Yolu is a multilingual storybook for children. At each choice, a child may
say an answer in their own words rather than repeat the displayed label. The
first spike uploaded the recording to the audio API and used an OpenAI
transcription model before matching the transcript to an option.

That design exposes a child's voice and words to a cloud processor. It also
makes voice choice depend on connectivity, API credentials, and a provider's
retention approval. The choice set is already known on the device and contains
exactly two options, so cloud inference is not required to resolve it.

## Decision

Production voice choices use the operating system's speech recognizer with
on-device recognition required. Recognition must never fall back silently to a
network recognizer.

The runtime flow is:

1. Check that on-device recognition is available for the story's BCP-47 locale.
2. Request microphone permission only when the listener starts a voice choice.
3. Supply the localized option labels and `voiceHints` as contextual phrases.
4. Keep up to five transcription alternatives in memory; do not persist audio.
5. Resolve the alternatives locally against localized labels and authored
   paraphrases.
6. Accept a choice only when one option has a clear score advantage. Otherwise,
   ask the listener to try again or tap an option.
7. Persist or transmit only the selected option id.

If an Android device supports on-device recognition but lacks the selected
locale pack, the app asks Android to download it and leaves tap selection
available. If on-device recognition is unavailable, voice selection remains
disabled for that attempt and tap selection continues to work.

## Multilingual authoring contract

Each localized story supplies:

- a BCP-47 `language` tag such as `tr-TR` or `en-US`;
- the localized visible option `label`;
- localized `voiceHints` containing short synonyms and natural paraphrases,
  especially the words that distinguish the two options.

The matcher is language-agnostic: it applies Unicode normalization, compares
whole phrases, tolerates inflected words through prefix matching, and evaluates
all recognizer alternatives. Locale-specific quality comes from the authored
labels and hints, not from sending speech to a general-purpose language model.

Cloud language models may help authors generate candidate paraphrases before a
story ships, but child speech and runtime transcripts are not sent to them.

## Deferred enhancement

If measured false-rejection rates remain high after improving localized hints,
evaluate an on-device multilingual embedding model. It would rank the local
transcript against precomputed option examples and would remain an optional
second-stage matcher. It is not included in the initial implementation because
of its application-size, memory, native-runtime, and per-language validation
costs.

An on-device Whisper model may likewise be evaluated only for locales or
devices whose native recognizer fails acceptance testing. Tap selection remains
the universal fallback.

## Consequences

- No child recording or transcript is sent to OpenAI by the production app.
- Zero Data Retention approval is not a dependency of voice choice.
- The audio API remains responsible only for pre-generated narration TTS.
- A new development build is required because speech recognition is a native
  Expo module.
- Every supported locale needs device coverage and consented acceptance samples.
- False selections are treated as more harmful than asking the listener to
  repeat or tap, so ambiguous speech must abstain.
