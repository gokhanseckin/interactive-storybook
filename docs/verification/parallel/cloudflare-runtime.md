# Cloudflare runtime hardening lane

Date: 2026-09-18

Branch: `codex/cloudflare-runtime-hardening`

Baseline: `3d082b468cee09577c5cbf37a45da3a818c9c9d7` on
`codex/story-studio-mobile-audio`

Status: local implementation and automated verification complete; not deployed

## Scope and outcome

This lane continued the existing Workers Static Assets/API, D1, private R2 and
Workflows adapter. It did not replace the adapter, change the schema, edit shared
contracts/dependencies, provision resources, deploy, enable paid generation or call a
paid provider.

Implemented hardening:

- Replaced whole-request upload buffering with bounded 5 MiB multipart staging in
  private R2. The Worker accepts up to `99,999,999` bytes, one byte below Cloudflare's
  current 100 MB Free/Pro request-body limit, including requests without a
  `Content-Length` header.
- MP3 ingestion now scans every MPEG Layer III frame in bounded 64 KiB validation
  slices, rejects malformed/truncated ID3, frames and end tags, derives duration from
  frame timing, and hashes every byte server-side. PNG/JPEG retain the existing complete
  upload checks.
- Promotion rereads the staged object, independently recomputes SHA-256, and completes
  the content-addressed R2 object only when byte count and digest match. Final objects
  retain their server-computed SHA-256 metadata; publication and delivery continue to
  verify size plus checksum. Completed and failed normal-path staging objects are
  deleted.
- Existing D1 full-value/role guards, transactional batches, immutable release
  triggers, atomic catalog activation, scheduled-publication fencing and generation
  claims remain intact. Cancellation now also guards that the publication is still
  scheduled, missing role-update targets fail transactionally, and collaborators must
  currently hold creator permission.
- Cron recovery rotates deterministic ten-job windows across queued and running jobs,
  avoiding permanent starvation behind the same live first page while preserving the
  per-invocation Workflow/subrequest bound.
- Cookie-authenticated mutations now require the exact configured Origin; bearer
  clients remain usable without an Origin. Supplied foreign Origins are denied for
  both. Login rate-limit keys now HMAC the connecting IP with the session secret instead
  of storing an unsalted IP hash. Scrypt strength is unchanged.
- The Studio static CSP now denies base injection and foreign form targets. Permissions
  Policy disables camera, geolocation and microphone, and HSTS is configured for hosted
  HTTPS. This lane does not touch listener voice handling; child speech remains entirely
  on-device.
- Wrangler observability is prepared with sampled logs/traces. No remote logging or
  deployment was activated. Runtime binding types now extend generated Wrangler types
  instead of duplicating them by hand.

The generation fence remains: the D1 `queued -> running` compare-and-swap commits before
the provider call, the Workflow step has zero retries, and a replay sees `running` or
`uncertain` and cannot call the provider again. After a response, only metadata CAS is
retried. Local mocks prove concurrent authorization, duplicate requests, a provider
failure after one call, and Workflow replay do not produce a second provider call. No
real provider request was made.

## Read-only Cloudflare access recheck

Cloudflare MCP OpenAPI discovery was performed before the read calls. All calls below
were `GET`; no resource was created, changed or repurposed.

| Surface    | Result on 2026-09-18                                         |
| ---------- | ------------------------------------------------------------ |
| Workers    | HTTP 200; 2 existing scripts                                 |
| D1         | HTTP 200; 0 databases                                        |
| R2         | HTTP 200; 1 existing unrelated bucket, `linkgrid-covers`     |
| Workflows  | HTTP 200; 0 workflows                                        |
| R2 privacy | HTTP 200; managed `r2.dev` access disabled, 0 custom domains |

This proves current read access only. It does not prove write/deploy permission, billing
entitlement or availability of isolated Story Studio resources.

## Automated and measured local evidence

Node `v22.22.2` was selected explicitly. Tests used Miniflare/workerd with isolated local
D1, R2 and Workflow state and loopback sockets.

| Check                    | Command                                                                                                             | Result                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Exact baseline           | `git cat-file -e '3d082b4^{commit}'`; `git merge-base --is-ancestor 3d082b4 origin/codex/story-studio-mobile-audio` | pass; exact SHA recorded above                                                |
| Worker types             | `npm pack @cloudflare/workers-types` to `/private/tmp`                                                              | latest retrieved `5.20260918.1`; R2/D1/Workflow signatures reviewed           |
| Worker typecheck         | `npm run cloudflare:check`                                                                                          | pass                                                                          |
| Root typecheck           | `npm run typecheck`                                                                                                 | pass                                                                          |
| Shared backend/contracts | `npm test`                                                                                                          | 12/12 pass                                                                    |
| Worker integration       | `npm run cloudflare:test`                                                                                           | 12/12 pass in 3.98 s                                                          |
| Dry-run bundle           | `npm run cloudflare:build`                                                                                          | pass; 1,396.27 KiB raw / 240.52 KiB gzip                                      |
| Large ingestion          | focused verbose Worker test                                                                                         | 11,578,140-byte MP3, pass in 741 ms test time; staging prefix empty afterward |
| Scrypt local sample      | five `passwordMatches` calls under Node 22                                                                          | mean 23.14 ms; 22.59-23.50 ms range                                           |
| Formatting/diff          | Prettier on owned sources; `git diff --check`                                                                       | pass                                                                          |

The integration suite covers authenticated author/upload/preview/review/publish/delivery,
exact byte ranges and HEAD, corrupt/expired/missing media, D1 rollback of guard plus audit,
immutable/retained releases, cancellation and role revocation races, scheduled failure,
generation deduplication, uncertain outcomes, replay fencing, stale generation, disabled
generation, and a real local disabled Workflow instance. The new tests cover missing-Origin
cookie mutation denial and ingestion above the former 10 MiB cap.

The 741 ms large-ingestion result is local end-to-end workerd/R2 emulation wall time, not
hosted CPU time. The Node scrypt sample is local CPU evidence, not a Workers measurement.

## Current official allowance assessment

Official documentation checked on 2026-09-18:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 transactional batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [R2 upload limits](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [R2 Workers binding](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- [Workflows correctness rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)

Published Free allowances currently include 100,000 Worker requests/day, 10 ms CPU per
invocation and 128 MB memory; static-asset requests that bypass the Worker are free and
unlimited. D1 lists 5 million rows read/day, 100,000 rows written/day and 5 GB total
storage, with a 500 MB per-database Free limit. Standard R2 lists 10 GB-month storage,
1 million Class A and 10 million Class B operations/month, with free direct egress.
Workflows Free lists 3,000 steps/day, 1 GB-month storage and 10 ms CPU per invocation,
sharing the 100,000/day Workers request allowance.

Assessment, clearly separated from hosted evidence:

- **Plausible estimate:** static Studio assets, a small metadata catalog and low-volume
  D1 control-plane traffic can fit the published Free allowances during development.
- **Not suitable to certify on Free:** authentication and full media ingestion. The local
  scrypt sample already exceeds 10 ms by more than 2x, before D1 or request overhead. The
  11.58 MB validation path took 741 ms wall time locally. Password strength and complete
  validation were deliberately not weakened to chase the Free CPU ceiling.
- **Capacity estimate only:** an initial 5-10-book catalog can fit 10 GB only if retained
  immutable releases remain below that total. Range playback increases Class B operations;
  multipart staging and promotion increase Class A operations. Actual narration sizes,
  listening traffic and release retention decide suitability.
- **Generation estimate only:** provider waiting time does not consume CPU, but request
  preparation and returned-audio validation do. The provider itself is separately billed.
  Paid generation remains disabled in every checked-in environment.

No hosted CPU, memory, latency, D1 row, R2 operation/storage, Workflow or billing
measurement was made. A zero-cost claim is therefore unsupported. Isolated staging on a
plan with enough CPU is the next qualification gate and requires explicit authorization.

## Simulator, physical-device and unavailable checks

- **Simulator:** not run in this backend lane. No mobile files or shared-cache flags changed.
- **Physical device:** not run; no device ownership or listener behavior was in scope.
- **Unavailable/not authorized:** hosted staging, deployment, provisioning, remote runtime
  profiling, cloud import/backup/restore, paid provider reconciliation and real generation.
- **Preserved gate:** `EXPO_PUBLIC_SHARED_AUDIO_CACHE` remains opt-in; this lane did not
  change it or claim any acceptance result.

## Remaining gaps and integration requests

1. **Backup/migration session:** add an operational cleanup/reconciliation procedure for
   completed `_ingest/` R2 objects older than a conservative threshold. Normal failures
   abort multipart work and delete completed staging objects, and R2 auto-aborts incomplete
   multipart uploads after seven days, but an isolate termination after completion and
   before `finally` can leave a private staged object.
2. **Integration session:** decide whether the Studio should display the 99,999,999-byte
   Cloudflare upload ceiling and the additional staging/promotion work. Studio JavaScript
   was outside this lane's ownership.
3. **Integration session:** consider updating shared Wrangler/workers-types dependencies
   after normal review. The locked Wrangler is 4.134.0 (4.135.0 was available) and the
   committed generated runtime types are one daily release behind the retrieved
   `@cloudflare/workers-types` package. No signature used here differed, so this is not a
   blocker and manifests/lockfiles were intentionally untouched.
4. **Product/integration decision before enabling generation:** define an explicit operator
   reconciliation action for `uncertain` jobs. Automatic replay is fenced, but a new paid
   attempt must remain a deliberate action after checking provider usage.
5. **Hosted gate after authorization:** use isolated staging resources to capture Worker
   CPU/wall time, D1 row metrics, R2 Class A/B operations, large-file memory behavior and
   Workflow usage. Do not reuse the account resources listed above.
