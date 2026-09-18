# Story Studio and mobile audio development plan

Date: 2026-09-17

Status: Implementation in progress on `codex/story-studio-mobile-audio`; native and hosted-environment acceptance gates remain open.

## Implementation checklist (2026-09-18)

Evidence: [implementation and device verification](verification/story-platform.md).
Checks below distinguish implementation from unperformed device/operational acceptance.

- [x] Inspect current main and reconcile library UI, timeline and existing ElevenLabs work.
- [x] Phase 0: shared schemas, graph validation, release/asset/catalog contracts.
- [x] Phase 0: local stack, environment isolation and byte-range delivery implementation.
- [ ] Phase 0: real iOS/Android baseline and coordinated native stream/download cache.
- [x] Phase 1: sessions, roles/ownership, revisions, uploads, measured MP3 metadata,
  content-addressed private media, generation jobs, stale results, catalog/delivery APIs.
- [x] Phase 2: authenticated Studio, library filters, details, JSON/scene/choice editing,
  per-clip audio, interactive preview, independent catalog controls, validation feedback.
- [x] Phase 3: exact-revision review, immutable candidates, atomic activation, schedules,
  cancellation, history/rollback, withdrawal and media retention.
- [x] Phase 4: cached catalog, one bundled welcome, local-first/progressive source resolver,
  release/locale progress keys and explicit legacy mapping.
- [x] Phase 5: persisted prioritized bounded queue, choice dependencies, constrained-network
  policy, file checksum verification, retry and progress-preserving source errors.
- [ ] Phase 5: native process-death reconciliation and stream/download byte reuse acceptance.
- [x] Phase 6: explicit complete packages, pinning, native backup-excluded storage,
  parent controls, shared references, low-space rejection and cache eviction policy.
- [ ] Phase 6: real-device airplane-mode/restart, force quit, corruption and storage pressure.
- [x] Phase 7: reproducible development fixtures and automated invariants/failure tests.
- [x] Phase 7: checksum-verified database/media backup and isolated restore rehearsal.
- [ ] Phase 7: device matrix, hosted staging/CDN and release acceptance.

First vertical flow is covered by `services/content-api/src/platform.test.ts`.
Mobile transport and queue wiring are in `apps/mobile/src/delivery`; native sources in
`apps/mobile/modules/story-storage`. No production deployment or merge is authorized.

## 1. Agreed product scope

- Authenticated web admin application, Story Studio, separate from the listener app.
- Creators prepare and manage stories; publishers/admins release stories and
  manage access. One account can hold both roles. Enforce permissions on the server.
- Content preparation and public visibility are independent. A placeholder can
  be added, opened, or hidden at any stage. It is never a prerequisite for authoring.
- Keep a permanent story ID from private draft through placeholder and publication.
- Support content-first, announcement-first, and direct-to-published workflows.
- Prepare audio before publication, with server-side generation or uploads.
- Deliver ordinary complete MP3s without DRM. Progressive playback can start
  before the entire MP3 arrives. Copied files remain playable, as accepted in ADR 002.
- Install with one small complete welcome experience, then fetch catalog metadata.
  Do not automatically download the catalog's 5–10 books or all opening chapters.
- Fetch the selected language and selected book. Download ahead of playback,
  including both responses before presenting a choice.
- Provide explicit, complete offline downloads, storage controls, and preserved progress.
- Publish content independently of app releases where the installed player supports
  the story schema. Pin ongoing listening to its release.

The 5 MB welcome-audio target, 250 MB automatic-cache budget, and buffer timings
are engineering starting points to validate, not fixed product promises.

## 2. Existing foundation and gaps

Original PR #9 assessment (historical; superseded by the implementation checklist):

The repository at that assessment had an Expo SDK 57 mobile player, validated JSON story
graphs, bundled MP3/WAV assets, local progress, and a Fastify/OpenAI audio service.
The player uses expo-audio with downloadFirst enabled and a bundled source map.
There is no remote catalog, Studio, creator authentication, release database,
durable generation queue, media delivery service, or offline download manager.
ElevenLabs preview files exist, but the current audio-api package uses OpenAI;
implement ElevenLabs generation explicitly rather than assuming it is integrated.

Reuse the story graph, deterministic choice behavior, and local speech resolution.
Preserve ADR 001: never send child recordings or transcripts to the server.
Read the versioned Expo 57 documentation before changing mobile code, as required
by apps/mobile/AGENTS.md.

## 3. Intended architecture and contracts

Suggested repository boundaries (names are implementation proposals):

- apps/studio: creator/publisher web interface.
- apps/mobile: catalog, player, downloads, parent controls.
- packages/story-contracts: shared versioned schemas and graph validation.
- services/content-api: authoring, roles, catalog, releases, delivery authorization.
- services/audio-api: existing generation boundary, extended with provider adapters.
- Durable worker: generation, asset inspection, publication preparation, scheduling.
- Relational database: drafts, releases, roles, jobs, audit records, catalog pointers.
- Private object storage and CDN: originals and immutable MP3/artwork delivery files.

Choose hosting, database, identity, and queue providers in phase 0 based on current
accounts and operating cost; this plan does not commit to a vendor. Reuse services
where useful rather than requiring a separate deployment for every boundary.
Keep provider keys and storage credentials server-only. Authorize admin mutations
and media issuance server-side. Signed delivery URLs may restrict initial access;
they do not revoke downloaded MP3s. Paid billing integration is outside this scope.

Core records:

| Record | Required concepts |
| --- | --- |
| Story | Stable ID, creator/access, title, cover, description, age band, locales |
| Draft | Revision, script graph, voice settings, asset references, readiness |
| Release | Immutable ID, story ID, locale, schema compatibility, manifest, approval |
| Catalog entry | Visibility, ordering, active release per locale, coming-soon metadata |
| Asset | Stable ID/hash, path, type, bytes, measured duration, generation provenance |
| Job | Input revision, state, retry count, output/error, idempotency key |
| Publication | Target release, schedule/time zone, actor, outcome, audit history |
| Local session | Story/release/locale, node and clip position, choices |
| Local media | Asset identity, partial/verified state, bytes, pin/reference ownership |

Draft workflow: Draft → In review → Ready. Editing reviewed content invalidates
its approval as needed. Publishing creates an immutable release. A published
release and a new draft can coexist.

Catalog visibility: Hidden / Coming soon / Available. Coming soon requires card
metadata only; Available requires a complete compatible published release.
Hide from discovery separately from withdrawal of new playback access. Neither
operation can remotely erase a copied MP3 or immediately revoke an offline file.

Manifest includes graph, audio references, durations, byte sizes, checksums,
required artwork, locale, schema/player requirements, and choice dependencies.
Stable asset identity is independent of expiring URLs. Validate reachability,
termination, unique IDs, required audio, both responses, and localized voice hints.

## 4. Phase 0 — Resolve delivery risks and establish contracts

1. Extract/design shared schemas without breaking the bundled player fixtures.
2. Define authenticated API contracts for drafts, jobs, uploads, previews,
   catalog entries, immutable releases, publication, and media delivery.
3. Select infrastructure and create isolated development/staging/production environments.
4. Run a native playback spike on real iOS and Android devices using a three-minute
   MP3: progressive start, seek, range requests, URL expiry/reissue, reconnection,
   suspension, resume, and complete-file offline playback.
5. Validate storage/CDN support for byte ranges, content length, stable validators,
   and byte-preserving MP3 delivery. Never translate seconds to bytes by a fixed
   bitrate assumption for variable-bitrate files.
6. Prove how progressive playback and persistent downloads share or reuse data.
   Select an Expo-compatible native adapter if expo-audio cannot expose the
   required cache/download coordination. Do not assume its streaming buffer
   becomes a durable offline file, or that a downloadFirst flag is a full solution.

Exit: documented stack and player choice, passing device spike, shared manifest
fixtures, API contract, and measured baseline startup/rebuffer behavior. Define
numeric playback acceptance targets from this baseline before implementation.

## 5. Phase 1 — Content backend and secure media storage

1. Implement identities, creator/publisher permissions, ownership, and audit history.
2. Store independent draft and catalog state; support revision-conflict detection
   so one editor cannot silently overwrite another's changes.
3. Add authorized uploads with file validation, measured duration/size/hash,
   immutable storage paths, upload completion checks, and orphan cleanup.
4. Add provider-independent generation jobs plus an ElevenLabs adapter. Retain
   existing OpenAI generation where useful; do not force regeneration of approved audio.
5. Track per-clip jobs and errors. Make retries idempotent, prevent duplicate
   billing from repeated clicks, bound concurrency, and expose spend estimates
   where available. Paid generation must be explicitly initiated by a creator.
6. Bind outputs to the exact script/voice revision. Text or voice changes mark
   affected audio stale; late jobs cannot replace newer approved clips.
7. Serve remote catalog and versioned manifests; issue delivery URLs through
   server authorization. Draft preview assets stay out of the public catalog.

Exit: an authorized creator can create a hidden draft, upload/generate audio,
retry failures, and retrieve a validated preview. Unauthorized mutations fail.

## 6. Phase 2 — Story Studio authoring interface

Build the authenticated web panel with:

- Library: search, filters by content state/visibility, New story, ownership/access.
- Workspace details: title, cover, description, locale, age band, episode metadata.
- Content: initial JSON import/export plus editable ordered scenes and choice forms;
  maintain the existing two-option/shared-continuation story semantics.
- Audio: per-clip text/speaker/direction, upload, generate, listen, regenerate,
  stale status, queue progress/errors, and readiness counts.
- Preview: interactive playback of the exact draft revision, both options,
  guidance behavior, and a staff-only mobile preview entry point.
- Catalog: Show coming soon / Hide at any stage when card requirements are met.
- Review: actionable validation failures linked to the relevant scene or asset.

Always show content state and catalog visibility separately. Placeholder editing
opens the same underlying story; it does not create a second content record.
Keep the current published release intact while creators edit its successor.

Exit: exercise all three authoring paths without a required placeholder step.
A creator can build a complete story without editing repository source files.
A freeform visual graph canvas is a later enhancement, not a launch dependency.

## 7. Phase 3 — Review, publishing, and release operations

1. Generate a frozen release candidate with full graph and asset validation.
2. Require preview/review of the same revision that will publish. Any subsequent
   relevant edit invalidates that readiness result.
3. Present final publication details: card, locale, release, duration, total bytes,
   startup dependencies, immediate/scheduled time and explicit time zone.
4. Verify all delivery assets before atomically activating the catalog pointer.
   A failure leaves the old published release or coming-soon card intact.
5. Add idempotent scheduled publication, cancellation/rescheduling, failure status,
   release history, rollback, hide, and withdrawal of new online playback.
6. Retain older releases needed by installed clients and offline sessions. In the
   early catalog, retain published media rather than infer that an offline client
   no longer needs it. Never delete historical assets as a side effect of rollback.

Exit: publish a new story and promote a placeholder using the same stable ID;
simulate upload/publish failures, duplicate jobs, concurrent edits, and rollback.

## 8. Phase 4 — Mobile catalog and release-aware playback

1. Add a cached remote catalog, detail pages, coming-soon cards, and compatibility
   handling for unsupported releases. Refresh on launch/foreground.
2. Bundle one short complete welcome story and fallback metadata. First launch
   offline must offer that story; online launch fetches metadata rather than books.
3. Replace the bundled-only source map with a resolver: bundled → verified local
   asset → authorized remote source, maintaining immutable asset identity.
4. Add release ID and locale to progress; migrate known bundled stories using an
   explicit legacy release mapping. Never silently attach old progress to a new graph.
5. Continue existing sessions on their release; new sessions use the latest
   compatible release. Keep the choice machine independent of transport state.

Exit: a newly published story appears and plays without an app rebuild; an
existing session resumes its original release after another release is published.

## 9. Phase 5 — Progressive playback, buffering, and download scheduling

1. Integrate the phase-0 native transport/cache adapter with local-first playback.
   Start longer narration once sufficiently buffered; do not wait for the full MP3
   or require a mandatory one-minute buffer. Preserve natural clip boundaries.
2. Model preparing, playing, buffering, paused, offline-blocked, failed, and ended
   transport states without losing the story's logical node or selected option.
3. Implement one durable prioritized transfer queue with bounded concurrency and
   deduplication. Prioritize current playback, next narration, choice dependencies,
   then the rest of the selected book. Reprioritize on seek/resume/book change.
4. Before a choice prompt, require complete prompt/guidance/both responses and
   the first shared continuation clip locally. Stall at the preceding boundary
   if needed; never auto-select or hide an unavailable option.
5. On Wi-Fi, fetch the selected book to completion. On constrained networks,
   limit speculative fetches to upcoming playback and choice dependencies; expose
   parent consent for whole-book download. Check policy again after network changes.
6. Handle interrupted ranges using stable asset validators, URL refresh, bounded
   retry/backoff, safe restart if resume is unsupported, and seek beyond buffer.
7. Persist files and queue state safely. A whole-file checksum is checked at
   completion; a progressive buffer is not a verified offline download. Avoid
   switching a playing remote source to local in a way that restarts narration.
8. Use native background transfer facilities; reconcile after suspension, process
   death, and force quit. Background downloading and background audio playback
   are separate features; retain current playback lifecycle behavior unless changed.

Exit: a long MP3 starts before completion; a connection loss preserves progress;
both choice responses play immediately once the choice is offered; restarting
the app resumes queued work without corrupt files or duplicate transfer jobs.

## 10. Phase 6 — Offline library and storage management

1. Add Download for offline with total/remaining bytes, progress, pause/resume,
   cancel/retry, and completion verification across every branch and required asset.
2. Pin complete books in persistent app-private storage outside purgeable cache,
   excluding re-downloadable media from backup. Reserve Downloaded for verified
   pinned content; partial books explicitly require internet for the remainder.
3. Manage automatic cache with a tunable 250 MB soft limit and least-recently-used
   inactive-book eviction. Protect active playback dependencies and pinned media.
4. Track shared asset references so deleting one package cannot break another.
   Check disk space including partial downloads and update overhead; stop new work
   and offer cleanup rather than silently evict pinned books.
5. Add parent Downloads/storage controls, cellular policy, clear cache, and remove
   book actions. Deleting audio retains progress and choices.
6. Make updates transactional: reuse matching checksums, verify replacements,
   then switch packages. Retain the old working package on failure and preserve
   releases needed by active sessions.

Exit: every option works in airplane mode after download and app restart; partial
downloads never claim full offline availability; cache cleanup and low storage
cannot delete a pinned book or break active playback.

## 11. Phase 7 — Launch verification and operations

Seed staging with 5–10 representative books, varied lengths and file sizes,
multiple choices, a coming-soon card, an updated release, and a failed draft.

Automated coverage: schema/graph and publication invariants; role authorization;
job idempotency/stale results; queue priority/deduplication; progress migration;
offline completeness; reference-counted cleanup; rollback and scheduled activation.

Real iOS/Android acceptance: first install offline; slow/variable connection;
loss before/during choices; seek beyond downloaded audio; Wi-Fi-to-cellular;
URL expiry; corrupted or missing clips; pause/resume; suspension/force quit;
storage pressure; offline restart and both responses; updates during listening.
Test on-device voice choices with network disabled and microphone permission denied.

Measure startup latency, buffering frequency/duration, downloaded vs played bytes,
download failures, offline availability failures, generation cost, and publication
failures. Use operational events without child audio or transcripts; avoid
unnecessary collection of children's detailed choice histories.

Deployment: schema/backward-compatible backend first, Studio and worker next,
then the mobile build enabling remote content. Deploy compatible content only
after that client is available. Test database restore, rollback, worker recovery,
and media retention. Use a limited initial rollout before general availability.

Exit: agreed phase-0 performance targets and correctness checks pass on both
platforms; the complete author → review → publish → listen → offline flow works.

## 12. Delivery order and scope control

Dependency path: phase 0 → 1 → 2 → 3 for authoring/publication, and phase 0 → 1
→ 4 → 5 → 6 for mobile delivery; both join at phase 7. Work can be scheduled
concurrently once contracts are stable, but no delegation is required by this plan.

First vertical milestone: one private draft with uploaded narration, authenticated
preview, publication, remote catalog discovery, and progressive mobile playback.
Then complete generated narration/review/scheduling and offline robustness before
the agreed full release. Each phase should produce a reviewable working increment.

Deferred: DRM/license servers, watermarking, paid billing integration, automatic
download of the full catalog, arbitrary one-minute audio slicing, and a freeform
visual graph editor. Do not introduce these as prerequisites for this release.

## References

- [ADR 001: On-device choices](adr-001-on-device-voice-choices.md)
- [ADR 002: MP3 without DRM](adr-002-mp3-delivery-without-drm.md)
- [Accepted download design](story-download-design.md)
