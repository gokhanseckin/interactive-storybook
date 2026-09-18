# Mobile listener and on-device voice continuation

Date: 2026-09-18. Branch: `codex/mobile-player-voice`.
Base: PR #10 head `3d082b4`, `codex/story-studio-mobile-audio`.
Fetched main: `ab7e2d7876a93581a9f6cfe898a75afeeeb17edd` (already an ancestor).
PR review inspection: no reviews/inline comments; CodeRabbit skipped the draft.

## Scope and checklist

- [x] Read `apps/mobile/AGENTS.md`, handoff, development plan, verification,
  download design and ADRs 001/002. Read exact [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
  and [expo-audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/) docs before editing.
  Also inspected installed `expo-speech-recognition@57.0.0` types/README and upstream docs.
- [x] Reuse delivery APIs; do not edit DeliveryLab, delivery layer, native storage,
  App.tsx, configuration or dependency manifests.
- [x] Speech attempts now fence asynchronous locale/model/permission results after
  cancellation, tap, navigation, interruption and unmount. Duplicate starts are blocked.
  A previous native recognizer must emit `end` before a new attempt can start.
- [x] Recognition always requires on-device processing and explicitly sets
  `recordingOptions.persist: false`. Only up to five alternatives are passed to the
  local resolver; the controller retains only a selected option ID until native end.
  Audio and transcripts have no persistence, logging, analytics or upload path here.
- [x] Both tap options stay enabled during microphone preparation, recording and
  resolution. Explicit cancel and a bounded timeout return to taps. Late speech events
  cannot replace a tapped answer or turn narration into a waiting choice.
- [x] Unsupported locale, absent Android model, permission denial/API rejection and
  native errors fail closed. Android can request a supported model download; recognition
  does not start automatically after it. Native failure never enables cloud recognition.
- [x] Player reports preparation until native load completes; invalidates old source readiness on
  replacement; ignores stale progress/finish events during preparation; waits for resume
  seeks before playing; shows failed seeks with retry; forces an actual reload on restart.
  Backgrounding while the resume prompt is open does not overwrite saved progress.
- [x] Resume restores an unanswered choice as a waiting choice. Saved missing nodes are
  rejected. Progress writes/removals and active-release pointers are serialized; state
  persistence strips unknown fields. Legacy migration is restricted to its known locale.
  Clearing migrated progress cannot resurrect the old legacy snapshot.
- [x] Staff previews do not write public listening progress or replace an active release.
  Preview requests are serialized, check exact story/revision, ignore results after
  unmount and offer draft refresh after revision conflicts. Private preview packages are
  excluded from ordinary library/download lists.
- [x] Library detail resolves the active immutable release before fetching a newer one;
  a failed old release does not silently migrate to latest. Metadata failures offer retry.
  Downloads exposes offline listening to complete packages, including retained old releases.
- [x] Offline status distinguishes pinned verified, evictable complete cache, partial,
  downloading, paused, failed and Wi-Fi waiting. Required artwork counts toward the total.
  Verified paths are rechecked through the existing `local()` API on foreground without
  resetting in-flight native transfers. Controls expose pause/resume, retry, cancel/remove,
  pinning, cache clearing and cellular preference; delivery's active-release protection stays intact.
- [x] Cloudflare MCP rechecked read-only: Workers scripts, D1 databases, R2 buckets,
  Workflows and Pages list endpoints each returned HTTP 200 / success=true. No mutations.
- [x] Physical iOS airplane-mode playback and voice choice: user-observed pass on corrected build.
- [ ] Physical iOS permission denial, cancellation/interruption and unavailable-model acceptance: in progress; see below.
- [ ] Physical Android speech acceptance: no device reserved/available in this session.
- [ ] Hosted Cloudflare/free-allowance measurements and production rollout: not performed.

## Automated evidence

`npm test --prefix apps/mobile`: **76 default tests passed**; three optional React hook
integration tests also ran using a temporary external renderer, for **79 passed** (12 files)
in that invocation, versus 41 at the PR base. Default runs skip those three tests unless
`STORY_REACT_TEST_RENDERER` is supplied (see integration instructions below).
38 added behavioral cases cover recognition permission/model/cancellation races, native
end fencing, tap fallback and late events, immutable release continuity, progress ordering,
legacy cleanup, private-preview isolation, and verified offline status including missing artwork/files.
These tests use fake recognizers/storage/transport; they prove application behavior, not
native speech availability or recognition accuracy in airplane mode.

Root `npm test`: **12 tests passed**. Root and mobile `npm run typecheck`: passed. The isolated initial check failed because
reused dependency symlinks pointed at the shared checkout's missing contracts package;
worktree-local package resolution fixed it. A subsequent locked mobile dependency install
initially failed under sandbox DNS restrictions, then succeeded with network access.
No dependency manifests or lockfiles changed.

## Native acceptance and coordination

The delivery task uses its own `StoryDeliveryReliability` simulator. This task reserved
only the paired iPhone 16 Pro Max after coordinating with that task. Initial sandboxed
CoreDevice enumeration timed out; an unsandboxed read succeeded and reported the phone
locked. The user agreed to unlock/help, and a second check reported `passcodeRequired: false`.
A local development-signed Release build with bundled JavaScript and welcome audio
**passed** (`xcodebuild`, Xcode 27, SDK iPhoneOS 27.0, iPhone 16 Pro Max destination).
Native sources/configuration are unchanged from PR #10. Build logs: `/private/tmp/story-voice-ios-build.log` and `/private/tmp/story-voice-ios-build-fixed.log`. A build alone does not establish any speech or physical acceptance.

| Check | Evidence/status |
| --- | --- |
| Airplane mode playback and Turkish voice selection | **Passed, user-observed** on corrected iPhone 16 Pro Max / iOS 26.7 build; user reported both play and voice-based option selection successful in airplane mode |
| Microphone permission denied, both tap options still work | Pending physical observation; app logic covered automatically |
| Cancellation during permission/recording/resolution | App logic covered automatically; physical observation pending |
| Home/lock/interruption and return, tap fallback | **Failed** on second build: user reported option 2 was accepted (choices disappeared) but response stayed silent. Fix and third-build retest pending |
| Unsupported locale/unavailable model on physical devices | Pending; mocked cases are not native evidence |
| No child audio/transcript uploads or persistence | Explicit native options and code/persistence regression coverage; no device traffic/storage audit claimed |
| Android airplane-mode/permission/model matrix | `adb devices -l` returned an empty attached-device list; unavailable |
| Shared streaming/download byte reuse | Owned by delivery task; no new measurements claimed here |

## Integration notes and remaining limits

No App.tsx, production configuration/dependency, native-storage or delivery-interface
changes are required for these listener fixes. The new optional Downloads `onListen` prop is wired
inside LibraryScreen using the existing parent callback. Keep shared audio opt-in off
until the delivery lane's acceptance gates pass. Do not treat this lane's speech work as
shared-cache qualification.

Delivery integration follow-ups (reported, not edited):

- `downloads()` memoizes a rejected initialization promise. A screen retry can retry UI
  subscription but cannot recover a native initialization failure until the delivery
  singleton can be reset/reinitialized (or the app restarts). The delivery lane reports
  this fixed in its separate branch; that change is not included in this listener build.
- Cancelling/removing the active package is intentionally rejected by the current API;
  the parent must stop listening first. No UI workaround cancels active dependencies.
- Staff previews still use the existing delivery inventory/cache. They are hidden from
  ordinary lists and excluded from progress; a separate private-preview cache purge and
  logout retention policy would require coordinated delivery work.

No merge, production deployment, paid infrastructure or paid generation was performed.

### Physical failure found during acceptance

The user reported that the first Release build exited when tapping “Dinlemeye başla”
in airplane mode. Device crash `MasalYolu-2026-09-18-184130.ips` showed SIGABRT via
`RCTExceptionsManager reportFatal`. Inspection found an introduced `player.replace(null)`
startup call: Expo's TypeScript `AudioSource` includes null, but SDK 57's iOS replace
binding takes non-optional `AudioSource`. The call was removed. Preparation now pauses
without clearing native media, invalidates readiness refs, and replaces only a resolved
non-null source inside a catchable promise chain. Three regression tests cover a native
adapter rejecting null, cancelled late preparation and native replacement errors.
The second local signed Release build **passed**, was installed and launched successfully.
The user then reported: “I tested play and voice based option selection successfully in airplane mode.”
This is user-observed physical iPhone evidence, not a simulator or fake recognizer result.
The requested procedure included Wi-Fi off; no independent radio-state/traffic measurement
was taken. Permission denial, cancellation/interruption and unavailable-model checks remain
separate rows above. The initial successful build
and install did **not** imply successful playback; the pass is based only on the subsequent user observation.

### Physical interruption failure and hook regressions

The user next reported a failed Home/lock/return check: option 2 was selected and the
choice buttons disappeared, but its response stayed silent. Two independently reproduced
hook races explain this failure mode: source readiness was only a mutable ref, so a native
status update that preserved `isLoaded=true` did not rerun Play; a late recognition `end`
restored the audio category without rerunning Play after native recording teardown.
Readiness now publishes a React state revision, and completed playback-mode restoration
publishes another revision. Both retrigger Play only when logical mode is still playing;
background-paused narration is not automatically resumed.

`useStoryPlayer.lifecycle.test.tsx` renders the actual React hook with controlled native
status/AppState/speech events. Against commit `145d725`, **two tests failed and one passed**.
With the fix, **all three pass**, and the full invocation passes **79 tests**. This is
behavioral regression evidence, not physical interruption acceptance. The third signed
Release build passed and was installed/launched. Its physical interruption retest is pending.

The user restricted shared dependency edits. Therefore the three hook-renderer tests use
an **optional test-only external runtime**, not a package.json change. A permanent test
integration should add `react-test-renderer@19.2.3` to mobile devDependencies (or migrate
the harness to the project's chosen React Native testing library) and wire the test
runtime in CI. React emits a deprecation notice for this renderer; it is not shipped in
the app. This session installed it only in `/private/tmp/story-voice-hook-runtime` and
linked its React dependency to the app's React to avoid duplicate hook dispatchers.

Reproduce the optional integration invocation after supplying that runtime:

```sh
STORY_REACT_TEST_RENDERER=/private/tmp/story-voice-hook-runtime/node_modules/react-test-renderer/index.js \
  npm test --prefix apps/mobile
```

Ordinary `npm test --prefix apps/mobile` runs the 76 tests that use existing dependencies
and explicitly reports the three hook-renderer tests as skipped. No native recognition
is mocked and then claimed as a physical pass anywhere in this report.
