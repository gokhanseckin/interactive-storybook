# ADR 002: Playable MP3 delivery without DRM

Status: Accepted

Date: 2026-09-17

## Context

The early version needs straightforward narration delivery and playback while
the product validates demand. Investing in DRM packaging, license servers,
and protected native playback is premature before there is traction.

## Decision

Use complete, playable MP3 files without DRM for this version. The app may
download and store these files for playback. Interactive stories may still
use separate MP3 clips for narration and choice responses; this decision does
not require flattening a story into one linear audio file.

Do not make DRM, encrypted offline media, expiring playback licenses, or a DRM
provider integration prerequisites for the early release. Revisit DRM only
after the product demonstrates traction and the owner chooses to invest in it.
No traction threshold or DRM implementation date is set yet.

## Consequences

- A copied MP3 remains playable outside the app, including after account access
  ends. This limitation is accepted for the early version.
- Authentication, private hosting, and signed delivery URLs can still control
  initial access, but cannot revoke a file already downloaded. This decision
  does not require public hosting or select a storage provider.
- Keep narration generation credentials on the server.
- This records the delivery decision; it does not implement remote hosting,
  downloads, or changes to the current bundled-audio prototype.
