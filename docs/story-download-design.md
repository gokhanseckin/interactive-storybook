# Story download and storage design

Status: Accepted direction; implementation defaults subject to device testing

Date: 2026-09-17

## Goals and constraints

Support an initial catalog of 5–10 interactive storybooks with a small install,
quick playback, predictable storage, and explicit offline availability. Follow
ADR 002: complete playable MP3 files, no DRM. The user approved this direction,
including progressive playback for longer MP3s. This document does not implement
downloads. Size budgets and buffering thresholds remain tunable defaults.

## Installation and discovery

Bundle one short, complete welcome story, including all its choices, in the
primary launch language. Target at most 5 MB of audio after listening review.
Include a small fallback catalog snapshot and thumbnails. The welcome story
must be identified as a short experience, not an incomplete full book.

On first launch, refresh catalog metadata and visible covers only. Do not
download every book or every opening chapter. Fetch a story manifest when its
detail page opens; begin audio delivery on Play or Download for offline.
Only fetch the selected narration language. Cache metadata for offline browsing.

## Playback and download priority

Use progressive HTTP playback for longer MP3 narration clips: start after a
sufficient playable buffer rather than waiting for the whole clip. Prefer a
verified local copy when present. Group clips by story structure; do not split
every file into arbitrary one-minute recordings. A buffer and a completed
offline file are different states.

On Play, select the current release (or the release of an existing session).
Start as soon as the native player reports sufficient buffered audio. Tune
startup and rebuffer thresholds on devices; 30–60 seconds can be a lookahead
target, not a mandatory startup wait. HTTP ranges address bytes, not seconds;
do not assume a fixed mapping for variable-bitrate MP3s.

Persist downloads into temporary files, verify expected size and checksum on
completion, then atomically promote them to offline-usable local files. A
partial stream cannot pass a whole-file checksum or count as an offline file.
Coordinate playback and download transfers to avoid fetching the same audio
twice; validate the native cache/download integration before choosing it.

Continue downloading the selected book in playback order:

1. Current and immediately upcoming narration.
2. Upcoming choice prompt, guidance, both responses, and shared continuation.
3. Remaining sections and all remaining option responses.

Use a small bounded download queue, with one active book having priority.
Reprioritize when resuming, seeking, changing books, or choosing an option.
Deduplicate requests and shared clips. Pause speculative work for other books.

Before playing a choice prompt, verify that both response paths and the first
shared continuation clip are available. If necessary, pause at the preceding
boundary and offer retry without losing progress. Never remove an option or
make a choice automatically because audio is missing. No partial download can
guarantee uninterrupted playback if connectivity disappears.

## Network policy

On ordinary Wi-Fi, continue fetching the selected book to completion while
listening. Treat metered Wi-Fi and low-data settings as constrained networks.
On cellular/constrained networks, fetch only upcoming playback and choice
dependencies by default; allow a parent to approve downloading the whole book
after showing the remaining size. Do not fetch unrelated books automatically.

Persist the queue and verified-file inventory across restarts. Native background
transfer support is needed for downloads while suspended; JavaScript execution
alone is not a guarantee. OS scheduling and force-quit behavior can interrupt
work. Reconcile and resume when the app returns. Refresh expired delivery URLs
without discarding verified audio. Retry failures with bounded backoff.

## Offline and storage behavior

Separate automatically cached audio from user-pinned offline books:

- Automatic cache: proposed soft budget of 250 MB; evict least recently played,
  inactive books first. Never evict files needed by the active session.
- Download for offline: obtain every section, response, prompt, guidance clip,
  manifest, and required artwork; verify all assets before marking complete.
  Store outside purgeable OS cache and exclude re-downloadable media from backup.
  Pinned books are not automatically evicted to satisfy the automatic cache cap.
- Check free space before downloads, including partial-file overhead. If pinned
  content or active playback prevents cleanup, pause new downloads and offer
  storage management instead of silently deleting pinned books.
- Remove download deletes audio but preserves listening progress and choices.

An automatically cached complete book can be played offline while its files
remain present. Reserve the persistent Downloaded badge for verified pinned
books; recheck file existence after restart or errors. A partial book must show
that internet is needed for the remainder.

## Listener and parent interface

Story detail: Play, Download for offline, total download size and duration.
Download state: Not downloaded, Downloading (bytes/total), Paused, Downloaded,
or Retry. A placeholder has no audio download action.

Player: quiet preparation/reconnection status only when needed. Storage and
cellular policy controls belong in the parent area, not at story choices.

Downloads screen: pinned books and sizes, progress, pause/resume/cancel, remove,
automatic cache usage, clear cache, and cellular-download preference. Canceling
a download must not disrupt an active playback dependency.

## Publication and versioning

Each immutable release manifest identifies story, release, locale, supported
schema, graph, clip IDs, durations, byte sizes, checksums, asset paths, startup
dependencies, and section/choice groups. Keep expiring delivery URLs separate
from stable asset identity. Publishing verifies every referenced asset before
activating the release; Studio displays total bytes and startup bytes.

Persist progress with story ID and release ID. Keep a started session on its
release; new sessions can use the latest compatible release. Reuse identical
files by checksum. Download and verify replacements before switching offline
packages, and remove old files only when no session or pinned release needs
them. Account for temporary update storage; retain the old package on failure.
New ordinary content releases should require no app release; new player
capabilities or unsupported schemas may require one.

## Validation before shipping

Test first launch offline, slow networks, loss of connectivity before a choice,
both options offline, interrupted downloads, expired URLs, corrupt files,
insufficient storage, app restart/force quit, seeking ahead, changing books,
cache eviction, pinned persistence, and a release update during a session.

## Platform references

- Android app-specific storage and cache eviction:
  https://developer.android.com/training/data-storage/app-specific
- Apple background transfer behavior, including force quit:
  https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)
