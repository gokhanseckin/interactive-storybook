# Story Studio acceptance lane

Date: 2026-09-18. Branch: `codex/story-studio-acceptance`.
Base: **`3d082b468cee09577c5cbf37a45da3a818c9c9d7`**, verified as a commit and
an ancestor of fetched `origin/codex/story-studio-mobile-audio`. Separate worktree:
`/private/tmp/story-studio-acceptance`. PR #10 was inspected read-only and remains
an open draft targeting main; this lane targets its implementation branch.

## Scope and implementation

Only `apps/studio/public/studio.js`, `apps/studio/public/studio.css`, new Studio
browser tests, and this report are changed. No backend, shared contracts,
dependency manifests/lockfiles, `_headers`, global configuration, central progress
files, mobile code, speech code, or audio-cache flags are changed.

Existing forms, endpoints, graph conventions and release operations are reused:

- Preserve draft/card edits and unapplied JSON across tabs. Show saved/unsaved and
  exact-revision preview/review state. Confirm discard on navigation/reload/sign-out;
  use the native unload warning for browser navigation. Export a recovery JSON
  containing revision, story, card and unapplied import text. No silent autosave.
- Keep local edits on a 409 conflict; offer export and explicit reload/reconciliation.
  Do not automatically rebase or overwrite another editor's revision. Require saved
  content for upload, generation, audition, preview, publication and catalog actions.
- Link server validation messages to clip uploads, detail fields, scene fields and
  graph links. Render reachable scenes in graph order plus disconnected scenes so
  unreachable nodes can be repaired. Entry/next-scene editing uses the existing graph
  contract. Invalid import text is retained; a minimal shape guard prevents renderer
  crashes, while the backend remains the full schema/graph authority.
- Show read-only publisher workspace controls, creator ownership/editor scope,
  publisher-only catalog/review/publication controls, and admin-only access controls.
  Publisher + creator does not grant editing access to someone else's story.
- Serialize API requests and disable the workspace during them; prevent repeated
  clicks while an action runs. Show upload/inspection status, retain failures, allow
  reselection of the same failed file, and show the shared audition audio controls.
- Store generation attempt keys in sessionStorage before dispatch. Same-attempt
  retries after a lost response reuse the key; queued/running/uncertain jobs block
  further generation. Successful/terminal known attempts can be explicitly reset.
  No automatic provider retry. Uncertain outcomes require backend/operator
  reconciliation (interface request below); no billing outcome is guessed.
- Cancel old preview sequences on navigation or new playback, retain pause/resume,
  request fresh delivery tickets on replay, and expose both choice responses,
  guidance and continuation through the existing preview.
- Disable approval/freezing until the saved revision has the necessary preview/review.
  Show active/retained release IDs, frozen title/locale/episode, unique asset bytes,
  startup scene audio bytes and duration including both responses. Confirm activation
  with its existing effects: available visibility and restored online access.
- Display the browser IANA timezone next to scheduling inputs and the exact UTC
  instant before submission. Reject invalid, past, nonexistent and ambiguous DST
  times. Render schedules in their stored timezone and UTC, with release IDs and
  terminal state. Persist retry keys; cancellation clears the key so the same instant
  can be deliberately rescheduled. Arbitrary timezone conversion is not introduced.
- Fix narrow-screen overflow from immutable IDs/validation paths and improve focus
  indication. Existing Studio visual styling is retained.

## Isolation and reproduction

Node **22.22.2** was selected explicitly; the machine's default Node executable has
an unrelated missing `simdutf` dynamic library. No system installation was changed.
Dependencies were installed only in the isolated worktree; Playwright 1.63.0 and agent-browser 0.27.0 were
installed in a separate temporary directory, without repository manifest changes.

```sh
# From the original repository, without changing its checkout:
git fetch origin
git cat-file -t 3d082b4
git show -s --format='%H %s' 3d082b4
git merge-base --is-ancestor 3d082b4 origin/codex/story-studio-mobile-audio
git worktree add /private/tmp/story-studio-acceptance \
  -b codex/story-studio-acceptance 3d082b4

cd /private/tmp/story-studio-acceptance
export PATH=/Users/gokhanseckin/.nvm/versions/node/v22.22.2/bin:$PATH
npm ci --ignore-scripts --cache /private/tmp/story-studio-npm-cache
npm install --prefix /private/tmp/story-studio-browser-tools \
  playwright agent-browser --no-package-lock --cache /private/tmp/story-studio-npm-cache
npm test
npm run typecheck
node --check apps/studio/public/studio.js
git diff --check

STUDIO_BROWSER_TOOLS=/private/tmp/story-studio-browser-tools \
STUDIO_CHROMIUM=/Users/gokhanseckin/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell \
node --import tsx apps/studio/tests/acceptance.mts
```

On other machines, set `STUDIO_BROWSER_TOOLS` to a directory with Playwright
installed and use its matching Chromium, or set `STUDIO_CHROMIUM` explicitly.
The test uses loopback **4493**, overrideable with `STUDIO_TEST_PORT`; an occupied
port fails rather than taking over a process. Every run creates a new OS temporary
SQLite/media directory and isolated browser contexts. The test prints its evidence
path and closes its own browser/server. `STUDIO_KEEP_SERVER=1` optionally holds the
server for inspection until SIGTERM. `STUDIO_REMOVE_EVIDENCE=1` removes test artifacts.
No shared checkout runtime or simulator is used.

The local accounts are disposable author, shared editor, publisher, and combined-role
outsider accounts. All narration uses existing `services/content-api/fixtures/reminder.mp3`.
The fixture is workflow test content, not approval of the newly authored text/audio
pairings. A tiny PNG tests cover upload. The Worker receives an explicit mock generator
returning the existing MP3; provider keys and paid calls are unnecessary and unused.

## Automated evidence

- `npm test`: **12/12 contracts/backend tests passed** (existing suite).
- `npm run typecheck`: **passed** (existing root scope; the browser script is run
  through tsx and is not included by the root TypeScript configuration).
- Studio JavaScript syntax, formatting and `git diff --check`: **passed**.
- New real-Chromium browser suite: **14 acceptance groups passed**, zero uncaught
  page errors, **one mocked provider invocation**, zero real provider invocations.

Browser acceptance coverage:

| Group | Assertions |
| --- | --- |
| Creation/editing | New hidden draft, details, cover upload, tab retention, cancelled discard |
| Audio | Missing MP3 link focuses upload, binary inspection/readiness, actual audio clock advancement on audition |
| Validation/import | Missing graph link and empty narration focus the correct field; malformed JSON survives tab changes and can be discarded |
| Concurrent edits | Shared editor saves; stale author gets 409, keeps local text, reloads deliberately; server winner is preserved |
| Permissions | Author cannot approve; publisher cannot edit/create; shared creator editor can edit; combined creator/publisher outsider cannot edit; direct HTTP attempts also return 403 |
| Releases | Preview → acknowledge → approve → freeze → activate; later narration edit resets review/preview and marks audio stale; replacement and rollback retain immutable old narration |
| Scheduling | Past time rejected; Istanbul 10:00 becomes 07:00Z; lost-response retry reuses one key/one schedule; cancellation and same-time new schedule; mocked due-time worker activation |
| Catalog | Coming-soon before publication, hiding independent of historical playback, withdrawal returns 403, restore keeps releases |
| Generation | Lost response after server acceptance; retry uses same key and one job; reload shows queued lock; one mock completes; uncertain state prevents another attempt |
| Upload failures | Unsaved content blocks audition; invalid MP3 fails without replacing the saved asset |
| Publication failures | Corrupted media fails activation and scheduled publication while the old active pointer remains; failed schedule is visible |
| Timezones | America/New_York spring nonexistent and autumn ambiguous times rejected before request |
| Branching preview | Add choice, edit localized hint/label, expose and focus unreachable imported scene, six clip uploads, narration/prompt/both responses/guidance/continuation playback, pause/resume |
| Responsive | 390px viewport has no document horizontal overflow |

Audition/preview evidence is browser media clock advancement, **not an acoustic
listening assessment**. Worker due times are advanced in the isolated fixture database;
the tests do not wait until 2030 or exercise a deployed cron service.

## Visual check and failures corrected

A separate named `agent-browser` session (`story-studio-acceptance`) inspected login,
library, publisher read-only details and release review. The rendered review shows
release identity, active state, readiness, schedule zone/UTC and retained history.
Screenshot: `/private/tmp/studio-acceptance-review.png` (local, not a portable artifact).
The session and its held test server were closed; no other session was stopped.
Native automation tab clicks reported success without changing the tab; the observed
DOM control was used for the final visual capture. Playwright's browser interactions
passed independently; the native click behavior is not claimed as a product pass.

Failures encountered, retained here rather than silently omitted:

1. Sandbox initially blocked Git metadata, dependency network access and loopback bind;
   authorized isolated operations succeeded with scoped escalation.
2. `.ts` test loaded as CommonJS because Studio's existing package lacks `type:module`;
   renamed the new test to `.mts`, without editing the shared manifest.
3. Temporary Playwright expected an unavailable newer browser; explicitly selected an
   already installed Chromium executable instead of taking over another session.
4. First complete browser run caught narrow-screen horizontal overflow; fixed wrapping
   and grid minimum widths, then the 390px assertion passed.
5. New test wrongly tried to click a correctly disabled queued-job control after reload;
   corrected the order to test same-key retry first and queued lock after reload.
6. Unreachable-scene test locator matched multiple inputs; narrowed it to the actual
   first focused input. Production scene navigation remained correct.

## Interface requests for Cloudflare / integration

These are explicit requests, **not backend or contract changes in this branch**:

1. **Uncertain generation reconciliation:** expose an authorized audited operation to
   record provider-usage reconciliation and close/supersede an uncertain job. Existing
   GET jobs + POST jobs do not represent reconciliation. Studio conservatively blocks
   generation for clips with uncertain outcomes rather than blindly authorizing another
   paid request. Preserve the durable billing fence and never auto-retry provider calls.
2. **Schedule failure detail:** Fastify `publishDue()` catches failures and stores only
   `state='failed'`; the publication response has no failure reason/attempt timestamp.
   Return a safe failure code/message and reconciliation status, with equivalent Worker
   semantics. Studio can show the failed state but cannot invent the cause.
3. **Structured validation paths:** errors are newline strings. Frontend maps known paths
   to existing fields/scenes, but custom graph issues sometimes use segment IDs where
   schema issues use array indices. Add a backward-compatible structured issue list
   (`path`, code, message) with consistent identities. Keep full validation server-side.
4. **Idempotent draft creation:** POST `/stories` has no client attempt key or lookup.
   A lost create response can leave a created draft; the author must refresh the library
   before intentionally trying again. No automatic create retry was added. Integration
   should add a deduplication contract before promising exactly-once creation.
5. **Browser test ownership:** integrate this runner into central CI and pin a compatible
   browser tool version in the centrally owned dependency/configuration files. This lane
   deliberately did not edit those files. Parameterize against the local Worker adapter
   in integration to qualify D1/R2/Workflow/browser parity.
6. **Publication metadata semantics:** release manifests freeze story/audio/artwork but
   not the full catalog card; catalog description/title can change on draft save through
   the current API. Clarify whether a reviewed release should freeze/publish a card
   snapshot. Studio displays frozen story metadata and current independent visibility
   without asserting catalog-card immutability.

## Remaining acceptance / unavailable checks

- **Automated local:** covered above against Fastify/SQLite and real Chromium. No claim
  of rerunning the Cloudflare, native mobile or audio-provider suites in this lane.
- **Simulator:** not run or controlled; not applicable to these Studio frontend edits.
- **Physical devices:** not run. Browser audio checks do not certify iOS/Android speech,
  suspension, offline restart, media delivery or shared native audio-cache behavior.
- **Unavailable/unperformed:** hosted Cloudflare/D1/R2/Workflows parity, real scheduled
  cron timing, Safari/Firefox, real provider billing/reconciliation, session-storage
  denial and cross-tab lost-response reconciliation. Browser shutdown can lose unsaved
  edits if the user overrides the unload warning; recovery export is explicit.
- Arbitrary-zone scheduling remains the existing browser-zone model, now clearly shown;
  DST ambiguity is rejected rather than guessed. Job refresh is explicit (no polling).
- No merge, deployment, provisioning, paid infrastructure, paid generation, PR #10 edit,
  or push to the implementation branch. Shared native cache remains opt-in and child
  speech remains entirely on-device; this lane did not touch either implementation.

Final successful browser evidence directory:
`/var/folders/79/wnvfyx9s78b26m96q6xf1hcm0000gn/T/studio-acceptance-miqX7R`.
It contains `results.json` (14 groups, `generatorCalls: 1`, `failures: []`) and
`studio-review.png`. These temporary artifacts are local-only; the committed runner
and assertions above provide reproducible evidence. The final run exited successfully
and closed its browser/server.
