# One-narrator audiobook listening preview

Generated 15 September 2026 with OpenAI `gpt-4o-mini-tts`, voice `marin`.

Listen: section 1 (3:25) → decision question (0:09) → ONE option (A 0:37 / B 0:34) → section 2 (1:42). The answer reminder (0:06) is optional. Section 2 ends at the approved preview boundary, “Birini seçin.”

Each file is one continuous generation request. Section 1 replaces 43 independently generated clips; section 2 replaces 26. The general algorithm and app integration await listening approval.

## Review materials

- `prompts.md`: readable spoken scripts and non-spoken directions.
- `requests.json`: exact six manually prepared requests; only paragraph breaks and quotation marks were added to the spoken copy.
- All 86 source segment IDs appear exactly once. Normalized word comparison confirms the prepared text preserves source wording and order within each track.
- `token-check.json`: local o200k_base estimates including instructions; largest request 1,205 tokens. Provider accounting may differ.
- `audio-check.json`: sizes and durations. All six files are recognized by afinfo as mono 24 kHz MP3. Full afconvert decoding was unavailable (format configuration error).
- Automatic transcription was not performed because approval review rejected the separate audio upload. Spoken-word fidelity and subjective performance await listening review.
- Receipts contain request and audio hashes. Section 2 needed a retry after a network disconnect; completed tracks were retained.
- MP3 files are local and Git-ignored. Existing app audio is unchanged.

Listen for narrator continuity, restrained character changes, natural dialogue timing, Turkish pronunciation, and missing or altered words.

## Reproduce

From `services/audio-api`:

```sh
node --env-file=.env --import tsx src/generateAudiobookPreview.ts
```

The one-off script reuses matching recordings. It is not the future general chunking algorithm. Revised prompts should use a new preview version.
