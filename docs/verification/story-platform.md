# Story platform implementation evidence

Base: `ab7e2d7876a93581a9f6cfe898a75afeeeb17edd` (`origin/main`, fetched before editing).
Branch: `codex/story-studio-mobile-audio`. Updated 2026-09-18.

## Integration-owner lane reconciliation (2026-09-18)

Four reviewed lane commits were cherry-picked locally without merging PRs #11-#14. The
fifth branch, `codex/mobile-player-voice`, was already on PR #10 and had no separate draft PR.
Central integration added pinned Playwright/React hook test dependencies, root Studio and
Cloudflare data-operation commands, and the Worker-aligned 99,999,999-byte Studio upload cap.

Fresh evidence on the combined tree:

- **120 unique automated tests passed:** 12 shared contracts/Fastify backend, 12 Worker
  runtime, 3 Cloudflare data operations, 87 mobile (including 3 real React-hook lifecycle
  regressions by default), and 6 audio API. Root, Worker, mobile and audio TypeScript pass.
- Wrangler dry-run passed at 2,167.93 KiB raw / 360.39 KiB gzip. Latest retrieved Workers
  types were `5.20260918.1`; no used R2/D1/Workflow signature differed from generated types.
- **14 real-Chromium Studio groups passed**, with one mocked provider invocation and no real
  provider call. Independent agent-browser smoke found meaningful content, expected login
  controls, no framework overlay and no page errors.
- Full Android debug APK passed (398 Gradle tasks, SDK 36) and full Expo iOS simulator build
  passed (Xcode 27, 110-target graph). The standalone Swift transport harness also built.
- Dedicated iPhone 17 / iOS 26.5 simulator transport matrix passed clean/pause/policy,
  ignored/malformed ranges, corruption, interruption, process restart, real background
  handoff, slow streaming and verified offline file playback. Slow 32 KiB/s start was
  **2,412 ms / 81,920 bytes**; completion used exactly **2,726,391 origin bytes**. Slow
  background handoff completed with 2,734,583 response bytes, including one 8 KiB
  cancellation chunk, then recovered verified local playback without another media request.
- Layered local author → review → immutable publish → catalog → signed delivery → native
  stream/download → offline playback passed across the Studio, Worker, mobile and simulator
  suites. This is contract-linked local evidence, not one hosted deployment or a physical pass.

Unavailable/unperformed in this integration run: hosted deployment/profiling, remote D1/R2
backup/restore, real provider billing/reconciliation, physical shared-cache lifecycle,
Android runtime (ADB listed no devices and no emulator binary was installed), full Expo app
runtime lifecycle, physical microphone denial/locale/interruption checks, real radio/storage
pressure, and the prior iPhone Home/lock silent-response retest. Shared caching remains off by
default and child speech remains entirely on-device.

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
This describes the original baseline. An opt-in shared native writer/loopback reader is
now implemented; see the continuation evidence below. It is not enabled by default.

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

- Shared progressive/download byte reuse qualification on physical iOS and Android;
  the opt-in implementation and simulator evidence are documented below.
- Real iOS and Android matrix: slow/reconnecting networks, expiry/reissue, seek, transitions,
  suspension/process death/force quit, corrupt files, storage pressure and offline restart.
- Native voice choices with network disabled and microphone denied on both platforms.
- Hosted staging/CDN and isolated production configuration, editorial welcome/catalog review,
  generation credentials plus explicit paid-run authorization, numerical device baselines.
- Limited rollout only after those gates pass and the user authorizes deployment.

## PR #10 continuation: Cloudflare and shared bytes (2026-09-18)

Current main was fetched again: `ab7e2d7876a93581a9f6cfe898a75afeeeb17edd` is already
an ancestor of this branch. PR #10 had no reviews or inline findings; CodeRabbit had
skipped the draft PR. Existing implementation and narration were reused.

### Cloudflare evidence

- Read-only MCP list calls returned HTTP 200 for Workers, D1, R2, Workflows and Pages.
  No resource, subscription, deployment or paid generation was created/run.
- Worker Static Assets/API, D1 migration and guarded transactions, private R2 media,
  generation Workflow and publication cron are implemented. See
  [runtime adaptation](../cloudflare-adaptation.md) for commands and hosted limitations.
- **11 local workerd/D1/R2/Workflow integration tests pass**: full authenticated HTTP
  author/upload/preview/review/publish/delivery flow; immutable/retained release rows;
  exact byte ranges/HEAD/If-Range; atomic stale-state rollback; cancellation and role
  revocation; concurrent generation deduplication; replay/uncertain billing fences;
  stale results; disabled generation; a real disabled Workflow instance; corrupt media,
  URL expiry and missing-media scheduled failure. Provider calls use mocks only.
- Local migration and account bootstrap commands passed. Wrangler dry-run bundled
  approximately 2.16 MiB uncompressed / 358 KiB gzip; this is a build result, not hosted
  CPU/memory/free-tier qualification. Root, Worker and mobile TypeScript checks pass.
- Combined suites: **70 tests passed** (12 contracts/backend, 11 Cloudflare,
  41 mobile, 6 audio API). Use `npm run cloudflare:test` in addition to baseline commands.
- The Worker now streams and fully validates uploads through 99,999,999 bytes; no password
  strength or MP3 validation was reduced. Local D1/R2 backup/restore passes; remote cloud
  rehearsal and hosted large-file benchmarking remain open.

### Native changes and limits

Both current native builds passed: Xcode 27.0 iOS simulator and Android debug APK.
The new shared writer/loopback reader is opt-in (`EXPO_PUBLIC_SHARED_AUDIO_CACHE=1`).
Direct streaming remains the default. Child speech code still requires on-device
recognition; this continuation added no speech upload or transcript persistence.

The shared path reuses one native file writer, checksum verifies the complete file,
and uses that same file for offline playback. iOS background handoff retains the
foreground prefix and requests a suffix; Android uses the existing WorkManager
partial file. Full prefixes left by process death are verified/promoted before a
new request, avoiding an invalid `Range: bytes=<file-size>-` retry loop. The queue can
adopt native completions even if its JavaScript observer previously failed.

Failures encountered and corrected during implementation:

- Swift exclusivity and task-enumeration compile/scheduling errors; early lab runs
  transferred zero bytes and correctly reported failure.
- Suspended foreground tasks needed inclusion in the native scheduler before URLSession
  enumeration; duplicate enqueue/session initialization and stale task scheduling were
  guarded. After this fix, progressive playback began before the file completed.
- A completed native MP3 passed an independent SHA-256 check but the JS lab initially
  reported incomplete. Native-completion recovery and a regression test were added.
- Development Fast Refresh could overlap lab runs. The lab now aborts old observers on
  unmount/restart; final acceptance must use a clean launch, not overlapping refreshes.

Clean-launch shared-byte results on iPhone 17 / iOS 26.5 simulator, 32 KiB/s proxy:

- Player clock advanced after **2,413 ms**, with **130,723 / 2,726,391 bytes** at the
  origin proxy; playback source was the native loopback reader.
- The complete SHA-256-verified MP3 required **2,726,391 / 2,726,391 origin bytes**.
  The same durable file was reused; no second full transfer was needed.
- Verified local playback advanced; seek reached **120.93 seconds**. This is player-clock
  evidence, not acoustic validation. Pause remained stable. Slow seeking beyond an
  incomplete prefix and physical-device behavior are still separate acceptance gates.

Reproduce the shared-byte lab with isolated fixtures and no paid calls:

```sh
# Local content server: PORT=4410 PUBLIC_ORIGIN=http://localhost:4410
LAB_PORT=4411 LAB_UPSTREAM_PORT=4410 node --import tsx services/content-api/src/labProxy.ts
# In apps/mobile, with a newly built development client:
EXPO_PUBLIC_CONTENT_API_URL=http://localhost:4410 \
EXPO_PUBLIC_DELIVERY_LAB_PROXY=http://localhost:4411 \
EXPO_PUBLIC_SHARED_AUDIO_CACHE=1 EXPO_PUBLIC_DELIVERY_LAB_AUTORUN=shared \
npx expo start --dev-client
```

The lab resets only its development clip, asserts startup before full transfer, counts
origin bytes per asset, validates checksum promotion, then checks file playback/seek.
Proxy `/stats` contains local numerical reports; it is a loopback-only development
process and must never be deployed.

### Explicitly unavailable/unperformed checks

- No attached Android device and no installed emulator were available. Android compilation
  is not evidence of runtime playback, background work, force quit or voice recognition.
- Physical iPhone was paired with Developer Mode enabled, but `devicectl ... lockState`
  reported `passcodeRequired: true`. No unlock, microphone permission or spoken samples
  were supplied. Physical iOS and offline/microphone-denied voice acceptance remain open.
- Both-platform slow seek beyond the sequential prefix, real network transitions,
  URL renewal while suspended, force quit, storage pressure, release update during
  listening and on-device recognition with network disabled remain unverified.
- Hosted staging/CDN, actual CPU/memory/cost measurements, cloud restore rehearsal,
  editorial approval and rollout remain open. The historical baseline checks above are
  retained as dated evidence and are not silently claimed as reruns of the new adapter.

A subsequent shared-stream background-handoff attempt could not be certified: the
Simulator UI showed a black surface and its Home action did not produce a confirmed
native transition (`foreground` remained true in the transfer journal). No new shared
background/suspension pass is claimed. The earlier baseline background-download pass
remains historical evidence for the original transport only.

## Listener and voice continuation lane (2026-09-18)

See [mobile player/voice evidence](parallel/mobile-player-voice.md) for scoped changes,
79 passing mobile tests with the optional hook runtime (38 added; 76 default tests), 12 passing backend/contracts tests, root/mobile
TypeScript checks, local signed iPhone Release build and the explicitly separate
physical speech acceptance matrix. Native delivery/cache work remains in its own lane.
