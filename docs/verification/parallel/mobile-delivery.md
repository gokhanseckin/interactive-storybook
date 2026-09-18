# Mobile delivery reliability lane

2026-09-18. Branch: `codex/mobile-delivery-reliability`.
Baseline verified after `git fetch origin`:
`3d082b468cee09577c5cbf37a45da3a818c9c9d7`, an ancestor of
`origin/codex/story-studio-mobile-audio`. Worktree:
`/private/tmp/storybook-mobile-delivery`. No alternative baseline was substituted.
The shared checkout was not edited. This branch targets the implementation branch;
PR #10 was not edited by this lane.

## Changes

- iOS foreground cancellation is a synchronized writer-close barrier before pause
  resolves. Background transition includes queued foreground writers, holds a short
  UIKit background execution allowance until suffix tasks are enqueued, and avoids
  creating foreground tasks while already backgrounded. Retention is rechecked before
  an asynchronous policy cancellation. Failed background transfers retain supplied
  URLSession resume data.
- Android enqueue/adoption is serialized; WorkManager requests carry a generation
  token so an obsolete worker cannot overwrite the current journal. Cancellation
  disconnects the old connection and waits for the per-asset writer lock. Queued work
  records a paused state even if no Worker ran. Policy-changing adoption passes through
  cancellation before replacing the WorkManager constraints. This is compiled, not runtime-certified.
- Both native writers validate exact suffix start/end/total and reject encoded media;
  a server's HTTP 200 response explicitly replaces a prefix rather than appending it.
  Native file validation prevents corrupt final files from shadowing a replacement.
- Added optional native `recoverAsset(id, bytes, extension)` to verify/promote complete
  prefixes without a delivery ticket or internet connection. The existing TS wrapper
  falls back on old binaries without the method. Public source/queue interfaces remain
  compatible. Verification always checks full size and SHA-256 before offline adoption.
- Shared preparation reuses verified completed media before reserving storage or
  requesting a ticket. Corrupt final files are removed after a pause barrier. Aborted
  observers do not enqueue new work and await cancellation before releasing their slot.
  A failed queue initialization can be retried rather than caching rejection forever.
- Pausing a package preserves active playback/choice dependencies; stopping playback
  releases that exception. Loopback reads stop promptly if a completed file disappears.
- Shared audio remains opt-in: `EXPO_PUBLIC_SHARED_AUDIO_CACHE === "1"` only. No player,
  voice, library, dependency manifest, lockfile, global configuration, shared contract,
  backend publication, permission, immutable-release, or paid-generation code changed.
  Child speech remains entirely outside this lane and on-device.

## Automated checks

- `cd apps/mobile && npm test`: **49 tests passed**, including eight new regressions
  covering opt-in default, offline final/prefix adoption, same-size corruption, missing
  file replacement, low storage, retryable initialization, and preserving active shared
  dependencies while a package is paused. These mocks are not native runtime evidence.
- `cd apps/mobile && npm run typecheck` and root `npm run typecheck`: passed.
- Android `:story-storage:compileDebugKotlin`: passed with Node 22.22.2,
  `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, isolated
  `GRADLE_USER_HOME=/private/tmp/storybook-delivery-gradle`, and `--no-daemon`.
  Generated Android prebuild files and all build output are uncommitted/isolated.
- Xcode 27 standalone simulator harness build: passed. It compiles the production
  `NativeTransfers.swift` and `SharedPlayback.swift` sources with UIKit/AVPlayer.
  It does not exercise the Expo bridge, JS app lifecycle subscription, or listener UI.
- `git diff --check`: passed.

## Simulator evidence

Dedicated iPhone 17 / iOS 26.5 simulator:
`8C908BE3-8DF9-4CF3-9DCD-BA4A6E6EFC95` (`StoryDeliveryReliability`).
No other session's simulator/process was taken over. A separate test bundle
`test.story.delivery.reliability`, Xcode DerivedData, module cache, origin port 46371,
and app-private storage were used. No content-service database or cloud resource was
needed. Fixture bytes repeat the existing development MP3 to 2,726,391 bytes; this is
transport test content, not editorial or acoustic acceptance. Fixture SHA-256:
`678fa7cf21c25438fe1386a95b3efa474243f1bb5b2669e613d24c78d11a337f`.

The native harness enqueues a transfer, explicitly enqueues it again as a package
observer, asserts task identity is unchanged, plays its loopback URL with AVPlayer,
and independently verifies the final SHA-256. Seek-ahead requests the last 16 KiB
while the prefix is incomplete and compares returned bytes to the final durable file.
It makes no bitrate-to-time assumption. Playback latency is player-clock advancement,
measured from native enqueue, excluding catalog and ticket acquisition.

Final fast matrix (8 KiB chunks every 25 ms, approximately 320 KiB/s):

| Native simulator check | Result | Origin body bytes / resume offset |
| --- | --- | --- |
| Clean playback + duplicate enqueue adoption + tail read | PASS; start 778 ms | 2,726,391, one origin request |
| Pause, stable prefix, resume, reconnect local range | PASS | 2,742,775; resume 221,184 |
| Restricted then restored native policy | PASS (not a radio test) | 2,734,583 |
| Server ignores Range with HTTP 200 | PASS; safe full replacement | 2,931,191; retransmission expected |
| Wrong Content-Range | PASS; no promotion | 229,376 before rejection |
| Whole-file checksum mismatch | PASS; prefix deleted | 2,726,391 |
| Mid-response interruption | PASS | 2,726,391 total; resume 114,688 |
| Restart: completed final and full partial | PASS; no app origin request added | counters unchanged |
| Restart: corrupt/missing final | PASS; not offline-usable | counters unchanged |
| Terminated process, partial restart | PASS; startup 450 ms | 2,734,583; resume 139,264 |
| Real background transition | PASS; native journal foreground=false | 2,734,583; resume 376,832 |

Counters measure response body chunks accepted by the local origin socket, not TCP
acknowledgments or radio traffic. Cancellation can leave one or more in-flight chunks
that the app did not durably retain; exact zero-overhead handoff is not claimed.
Completed-prefix recovery is checked after stopping the process and injecting the
pre-promotion state; it is not an assertion about exact OS kill timing.

Slow 32 KiB/s supplemental run: **2,290 ms startup at 81,920 bytes**, exactly
**2,726,391 total origin bytes / one request**, duplicate enqueue retained the same
native writer, and the final 16 KiB read matched the complete file. The range request
explicitly allows 120 seconds; the earlier default-60-second timeout remains a real
client limitation.

The final slow background run also **passed**: native `didEnterBackground` callback,
`foreground=false`, resumed `Range: bytes=49152-` with the immutable If-Range validator,
full SHA-256 completion, **2,734,583 body bytes** (one extra 8 KiB cancellation chunk).
The app's suspended observer did not report intermediate progress until native completion;
this is not foreground polling masquerading as background work. A new process then
recovered and played the verified local file with AVPlayer clock advancement, with
**no additional origin media request**. The final supplemental runner asserted the
background journal and unchanged media counters during recovery.

Final supplemental command:
`run-simulator.py --udid 8C908BE3-8DF9-4CF3-9DCD-BA4A6E6EFC95 --output /private/tmp/storybook-delivery-background-final.json --modes background-slow,recover`.
The full default runner includes the fast matrix, slow range test, and slow background
check; standalone supplemental modes avoid rerunning unrelated cases.

Earlier successful shared-path runs in this lane (not baseline direct-download tests):

- Clean native progressive start: 829 ms / 237,568 bytes; exactly 2,726,391 origin
  bytes and one request through completion. A subsequent matrix clean run started in
  722 ms at the faster 320 KiB/s fixture throttle.
- Actual `applicationDidEnterBackground` callback observed; journal changed to
  `foreground=false` and a suffix request began at 499,712 bytes. Completion passed
  full SHA-256 while backgrounded. Origin sent 2,734,583 bytes, including one extra
  8 KiB chunk during cancellation. Do not claim zero cancellation overhead.
- Pause/resume preserved a stable prefix; malformed range was rejected without
  promotion; checksum mismatch deleted the prefix; connection interruption resumed
  at 114,688 bytes and transferred exactly one file's bytes in total.
- Actual simulator process termination with incomplete prefix resumed by range in a
  new process. Offline final-file and complete-prefix recovery added no origin requests;
  the pre-promotion window was injected by renaming a verified final to `.partial` after
  termination. Missing and same-size corrupt complete files were rejected offline.

### Failures and corrections during qualification

- System `npm` initially crashed due to a missing Homebrew library. Used the documented
  Node 22.22.2 installation; no host package changes were made.
- First typecheck lacked root dependencies for linked contracts. Installing both
  locked root/mobile dependency sets resolved it without manifest or lockfile edits.
- First test origin accidentally returned its counter as metadata size; corrected the
  harness before counting any pass.
- Hand-built Swift app ran foreground tests but background URLSession rejected its
  missing daemon-visible bundle identity. Manually added signing entitlements also
  failed launch. Standard Xcode packaging via `build-harness.sh` resolved this, and
  actual background handoff then passed. Failed attempts are not acceptance evidence.
- A blocked loopback request correctly closes on intentional pause. The harness was
  corrected to reconnect to the same loopback capability after resume; it never opens
  a fallback remote player stream.
- The first slow tail-byte check hit URLSession's default 60-second client timeout
  before the approximately 83-second sequential transfer could reach the tail. The
  protocol harness now explicitly uses a 120-second request timeout (matching the
  native reader's wait bound). This does not fix or certify interactive player time
  seeking; a distant seek can still stall/time out depending on player behavior.
- A slow background harness attempt checked duplicate-enqueue task identity after
  suspension; by then the transfer could already be complete and recovery intentionally
  no longer retained a task ID. Moved that assertion immediately after the first enqueue,
  before lifecycle transition. This was a harness ordering failure, not a passing run.
- Restricting URLSession to unmetered access can wait for connectivity on a simulator.
  The policy test exercises restriction followed by restoration and checks native
  policy retention; it does not claim a real Wi-Fi/cellular radio transition.

## Reproduction

Read `apps/mobile/AGENTS.md`; Expo SDK 57 reference and audio docs were read:
https://docs.expo.dev/versions/v57.0.0/ and
https://docs.expo.dev/versions/v57.0.0/sdk/audio/ .
All eight requested design/handoff/API documents were read before edits.

Use Node 22.22.2. Install locked dependencies using `npm ci` separately in the root
and `apps/mobile`. Run tests/typecheck above. For Android compile, in `apps/mobile`:

```sh
CI=1 npx expo prebuild --platform android --no-install
cd android
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
GRADLE_USER_HOME=/private/tmp/storybook-delivery-gradle \
./gradlew :story-storage:compileDebugKotlin --no-daemon --console=plain
```

From repository root, using Xcode and `xcodegen`:

```sh
apps/mobile/modules/story-storage/tests/build-harness.sh
python3 apps/mobile/modules/story-storage/tests/origin.py \
  --fixture services/content-api/fixtures/reminder.mp3 --port 46371
# In another terminal, create/boot YOUR OWN simulator and capture its UUID.
xcrun simctl create StoryDeliveryReliability \
  com.apple.CoreSimulator.SimDeviceType.iPhone-17 \
  com.apple.CoreSimulator.SimRuntime.iOS-26-5
xcrun simctl boot "$DELIVERY_SIMULATOR_ID"
xcrun simctl bootstatus "$DELIVERY_SIMULATOR_ID" -b
xcrun simctl install "$DELIVERY_SIMULATOR_ID" \
  /private/tmp/storybook-delivery-xcode/derived/Build/Products/Debug-iphonesimulator/StoryDeliveryHarness.app
python3 apps/mobile/modules/story-storage/tests/run-simulator.py \
  --udid "$DELIVERY_SIMULATOR_ID" --output /private/tmp/delivery-results.json
```

The runner intentionally resets only its dedicated fixture/app, opens Settings on
that simulator for background transition, and terminates only that test bundle for
process-death scenarios. Never supply another lane's device UUID. The origin is
local-only development fault injection and must not be deployed.

## Remaining gates and explicit interface requests

- **Android runtime unavailable:** `adb devices -l` returned no devices; no emulator
  binary/system image was installed. Kotlin compilation is not WorkManager, ExoPlayer,
  background, offline restart, process-death, storage-pressure, or network acceptance.
- **Physical-device delivery not run:** the physical iPhone was reserved by the mobile
  player/voice session. Its speech results are not evidence for this shared delivery
  path. Physical iOS suspension/force-quit, Android OEM task behavior, airplane mode,
  constrained radios, real disk exhaustion, and expiring/reissued hosted URLs remain open.
- **Full Expo app lifecycle remains a gate:** this lane proves native UIKit callback
  wiring in a standalone harness using production transfer code, not the full Expo
  subscriber/JS UI interaction. The small Expo subscriber addition requires a native
  app rebuild and full-client integration acceptance.
- **Seeking:** exact tail-byte blocking/reuse is tested. The slow protocol test uses an explicit 120-second client timeout. Interactive AVPlayer/ExoPlayer
  time seeking beyond an incomplete prefix, long stall UI, and physical acoustic
  playback remain open; no fixed byte/time mapping is introduced.
- **Storage:** automatic low-space rejection and offline recovery are covered by
  automated checks; the host/simulator disk was not filled to force ENOSPC. Pinned
  content is not evicted to make room.
- **Integration request:** retain the default-off flag until Android and physical/full
  app gates pass. Rebuild native clients to include optional `recoverAsset`; no shared
  contract/global configuration/dependency changes are requested.
- **UX coordination:** existing source/queue signatures remain intact. A package pause
  stops speculative work but permits active shared playback/choice dependencies until
  `stop()`. Queue initialization retry is now recoverable. Preview-cache purge/logout
  policy requires an explicit integration decision and was not expanded in this lane.
- **Progress documents:** integration session should update central plan/verification
  documents with this report's precise native-simulator scope, without promoting it
  to physical/Android or full Expo acceptance.

No merge, deployment, cloud provisioning, paid infrastructure, or paid generation
was performed. No older direct-download result is counted as shared-path evidence.
