# Story platform implementation evidence

Base: `ab7e2d7876a93581a9f6cfe898a75afeeeb17edd` (`origin/main`, fetched before editing).
Branch: `codex/story-studio-mobile-audio`. Updated 2026-09-18.

Main already contained the library/detail UI, timeline fixes, ElevenLabs adapter and
six approved narration files. Implementation reuses those. No paid generation,
production deployment, merge, or external infrastructure provisioning was performed.

## Architecture and phase evidence

| Phase | Implementation and verification |
| --- | --- |
| 0 | Shared Zod graph/asset/release contracts; Fastify/SQLite WAL/private content-addressed files; native capability spike; signed range delivery. |
| 1 | Server sessions, creator ownership/editor scope, publisher/admin roles, optimistic revisions, measured/validated MP3 uploads, persistent generation jobs, catalog/release/delivery APIs. |
| 2 | Same-origin Studio login, filtered library, details and scene/choice forms, JSON import/export, clip upload/generation/audition, interactive preview and staff mobile preview. |
| 3 | Revision-bound preview/review; immutable candidates; atomic activation; scheduled publication/cancellation; retained rollback releases; independent visibility and withdrawal; audit. |
| 4 | Existing mobile library integrated with cached remote catalog, one welcome bundle, progressive/local source selection and release-aware progress migration. |
| 5 | Persistent priority queue, both responses and continuation before choices, bounded concurrency, constrained-network policy, native transfer adoption and checksum validation. |
| 6 | Explicit pinned complete packages, shared asset references, backup-excluded native storage, 250 MB automatic cache, free-space checks and parent controls. |
| 7 | Six development fixtures (four available, one coming soon, one failed draft), automated invariants, throttled simulator harness and verified backup/restore command. |

Local environments use separate DATA_DIR/database/media/accounts/secrets. Node 22 is
required. This is a single-service SQLite deployment: do not run multiple independent
workers against the same database. Hosted staging, managed identity/database/CDN and
production provisioning remain rollout decisions. No cloud service is silently assumed.

Fixtures reuse approved narration and are labeled development content. They exercise
release/catalog state; they are not six editorially approved new books. The primary
import retains the legacy garden story ID/release mapping. Bundled welcome WAVs total
approximately 3.05 MB; the six long garden MP3s are no longer bundled.

## Native transport

Expo 57 documentation and installed implementation were inspected before mobile edits:

- https://docs.expo.dev/versions/v57.0.0/
- https://docs.expo.dev/versions/v57.0.0/sdk/audio/
- https://docs.expo.dev/versions/v57.0.0/sdk/filesystem-legacy/

`expo-audio` uses `downloadFirst: false`; verified files take priority at clip boundaries.
The local StoryStorage module replaces reliance on JS/Expo legacy transfer promises:

- iOS: stable background URLSession identifier, asset task descriptions, persisted native
  journal, native size/SHA-256 validation, resume data and app-delegate completion hook.
- Android: persistent unique WorkManager jobs, network constraints, range/If-Range partial
  recovery, per-asset write serialization, native size/SHA-256 validation.
- Native transfer concurrency is bounded at two. iOS Application Support excludes media
  from backup; Android uses noBackupFilesDir. Local files keep their media extension.
- iOS container paths are rebound to the current container on launch, preserving downloads
  across reinstall/update container relocation when their checksum still matches.

Streaming buffers are **not** durable offline files. The currently streaming asset is
excluded from speculative downloads, but AVPlayer/ExoPlayer bytes cannot yet be reused
by the durable transfer adapter. A later offline download can transfer those bytes again.
Shared stream/download byte reuse remains an implementation gap, not a claimed guarantee.

## Measured simulator results

iPhone 17, iOS 26.5, signed Debug native build. Local HTTP proxy limited each response to
32 KiB/s; reference MP3 duration 170.37 seconds, size 2,726,391 bytes.

- Progressive playback advanced after **2,066 ms**, with **114,534 bytes** sent by proxy
  (well before the complete MP3). This is a player-clock assertion, not acoustic measurement.
- Seek to 120 seconds advanced to 121.92 seconds; pause position remained stable.
- Complete book (approximately 5.3 MB) downloaded and passed checksum reconciliation.
- Both choice responses played from `file:` URLs with clock advancement (0.16/0.15 s).
- Extensionless local audio initially failed; `.mp3` paths fixed the failure. The lab now
  fails if local playback does not advance, preventing a false-positive offline result.
- Unsigned simulator builds initially failed background URLSession identity checks. Ad-hoc
  signing fixed this. Reproducible prebuild plugin fixes Xcode shell quoting for repo spaces.
- Background cancellation races were fixed with task identity checks and latest-policy
  retention. All six native files completed while the app remained on the simulator Home
  screen; independent SHA-256 checks passed for every file (5,513,142 total bytes).
- After simulator process termination and relaunch with the content server stopped, the
  pinned package restored its Downloaded badge. Both local responses advanced (0.15/0.14 s)
  without requesting delivery URLs. This does not establish physical-device force-quit behavior.

Android full debug APK build and StoryStorage Kotlin compilation passed with the installed SDK at
`/opt/homebrew/share/android-commandlinetools` (Node 22, fresh Gradle process). No attached
Android device/emulator was available, so Android runtime behavior is not certified.
A signed iPhone development build also succeeded; the paired phone required its passcode.
Physical-device playback, suspension, force-quit, airplane mode, network transitions,
storage pressure and on-device speech checks are pending user/device availability.

## Automated and operational checks

Latest suite: **55 tests passed** (12 contracts/backend, 37 mobile, 6 existing audio API);
root and mobile TypeScript checks passed.
Run `npm test && npm run typecheck` at the root and in `apps/mobile`.
The backend tests drive private draft → binary upload → preview → review → immutable
release → publication → catalog → signed HTTP byte ranges. They also cover roles,
ownership, CSRF origin, revision conflicts, stale jobs, uncertain billing recovery,
schedule cancellation, rollback, private candidates, corrupt/truncated files and withdrawal.
Mobile tests cover choices/voice resolution, release progress, queue priorities, cellular
restrictions, complete branches/artwork, corrupt restart, references, pinning and low storage.
No child speech or transcripts are transmitted; tests also exclude transcripts from progress.

Backup/restore rehearsal succeeded on 2026-09-18: SQLite snapshot restored to a fresh
isolated directory, integrity/foreign keys/release schemas and every media checksum passed.
Restoration revokes copied sessions and does not launch a worker. Review pending schedules
before starting a restored environment. Quiesce writes/media cleanup during backup for a
consistent database-plus-media snapshot. Existing source files remain untouched.

## Remaining acceptance gates

- Shared progressive/download byte reuse, rather than transferring streamed bytes twice.
- Real iOS and Android matrix: slow/reconnecting networks, expiry/reissue, seek, transitions,
  suspension/process death/force quit, corrupt files, storage pressure and offline restart.
- Native voice choices with network disabled and microphone denied on both platforms.
- Hosted staging/CDN and isolated production configuration, editorial welcome/catalog review,
  generation credentials plus explicit paid-run authorization, numerical device baselines.
- Limited rollout only after those gates pass and the user authorizes deployment.
