# Cloudflare runtime adaptation

Prepared locally on 2026-09-18 on PR #10. **Not deployed or approved for rollout.**
The existing Fastify/SQLite implementation remains available; the Worker serves the
same Studio and mobile API contracts with D1 metadata and private R2 objects.

## Implemented

- `services/cloudflare/wrangler.jsonc`: Workers Static Assets for the existing Studio,
  Worker-first `/api/*` and `/media/*`, D1 migrations, private R2 binding, generation
  Workflow, and minute cron for scheduled releases/outbox reconciliation.
- Separate local/staging/production bindings, names and origin settings. The remote
  IDs are deliberate placeholders, not provisioned resources. There is no deploy script.
- Reused story contracts, permission/readiness/fingerprint logic, manifest assembly,
  MP3 frame inspection, scrypt password validation and ElevenLabs request validation.
- D1 batch transactions begin with CHECK-constrained guards for current actor roles
  and the complete stored story value. Conflicts roll back all metadata/audit writes.
  Checking the entire value also protects visibility, editor and review changes that
  do not increment content revision. Release rows have update/delete rejection triggers.
- Atomic release activation includes catalog pointer, retained publication membership
  and audit. Scheduled activation guards the current schedule state and publisher role,
  so cancellation/revocation racing activation cannot silently publish.
- Content-addressed R2 objects are conditionally created and uploaded with their SHA-256
  checksum. Publication checks R2 size and stored checksum. R2 must remain private and
  write access restricted to verified ingestion; out-of-band replacement is unsupported.
  Signed delivery rechecks release publication/withdrawal or the preview revision,
  supports HEAD, single byte ranges, suffixes, If-Range and byte-preserving streaming.
- Uploads stream through bounded 5 MiB private multipart staging up to 99,999,999 bytes.
  The Worker hashes every byte, validates complete MP3 frame structure in bounded slices,
  rereads and rehashes staged content before content-addressed promotion, and deletes normal
  staging objects on success/failure. A conservative orphan reconciliation procedure remains
  necessary for isolate termination after multipart completion.
- Paid generation is **disabled** in every checked-in environment. If later authorized,
  the request also requires the explicit generation checkbox. A unique active-job index
  deduplicates concurrent requests; the D1 row is the Workflow outbox and Workflow ID.
  A durable `queued → running` claim fences billing. Workflow retries are disabled around
  the provider call, and replay of running/uncertain work never resubmits it. Terminal
  failed Workflows with running claims become uncertain; only metadata CAS retries occur
  after a provider result. Late results cannot replace changed text or an attached clip.
- Login attempts live in D1, keyed by an HMAC of the connecting IP. Existing scrypt
  strength is preserved. Studio cookies remain HttpOnly/SameSite=Strict and use Secure
  outside local development; cookie mutations require the exact configured Origin. Static
  headers deny base/form injection, disable unused sensitive permissions and enable HSTS.
- Local data operations export checksum-sealed D1/private-R2 bundles and restore only into
  new isolated targets. Sessions/throttles are omitted; scheduled/queued work is held and
  running generation becomes uncertain without losing idempotency/provenance.

## Local commands

Use Node 22.13 or later. From the repository root:

```sh
npm ci
npm run cloudflare:migrate
cp services/cloudflare/.dev.vars.example services/cloudflare/.dev.vars
# Set a random SESSION_SECRET in that ignored local file.
# Supply STUDIO_PASSWORD through your shell environment (12+ characters).
npm run cloudflare:user -- author@example.test creator,publisher
npm run cloudflare:dev
```

Open `http://localhost:8787`. Create/import a story using Studio and upload existing
approved MP3s. No provider keys are needed for uploads. The user provisioning command
always uses `--local` and revokes prior sessions. It does not contact D1 remotely.

```sh
npm run cloudflare:check
npm run cloudflare:test
npm run cloudflare:data:test
# npm run cloudflare:data -- backup|verify|restore ...
npm run studio:acceptance
```

The test command builds with `wrangler deploy --dry-run`, then runs actual local
workerd/D1/R2/Workflow emulation. It does not deploy. It requires loopback sockets.
Generated runtime types are committed; regenerate after binding changes with
`wrangler types --config services/cloudflare/wrangler.jsonc services/cloudflare/worker-configuration.d.ts`.
Wrangler 4.134.0 currently depends on Miniflare 5 alpha; tests use its exported V4
configuration adapter. Both versions are locked in package-lock.json.

## Cost and rollout gates

Static assets bypass Worker execution where possible; delivery streams R2 bodies without
buffering them in the Worker. D1 indexes bound schedule/job/release lookups; cron batches
are capped. There is no paid plan setting, public R2 bucket, remote local binding, or
provider key in the configuration. Free allowance suitability is not yet demonstrated.

Preserving scrypt and full-file MP3 inspection takes precedence over meeting a free CPU
budget. Worker uploads now stream up to **99,999,999 bytes**, including bodies without
Content-Length; an 11,578,140-byte MP3 passed local workerd validation. Workerd functional
tests do not establish hosted CPU or memory usage. Hosted profiling, large-file throughput,
D1 row/read/write usage and real R2 billing need a staging decision.
Do not advertise a guaranteed zero-cost service from these local checks.

Still pending before hosted rollout:

- User authorization to provision isolated staging resources and deploy; production
  authorization is separate. Never reuse unrelated account resources.
- Actual resource IDs/domains/secrets, hosted CPU/memory/latency measurements, CDN/native
  acceptance and an explicit cost decision if free allowances do not fit.
- Remote D1/R2 export/import plus a cloud restore rehearsal. Local D1/R2 and legacy
  SQLite/filesystem migration/restore are implemented; remote mode is deliberately absent.
  Cloud orphan cleanup is deliberately unavailable; historical releases/media remain retained.
- Hosted large-upload qualification and operational pagination/retention tuning at scale.
- Explicit paid-run authorization and provider reconciliation rehearsal with real billing.

Read-only Cloudflare MCP checks on 2026-09-18 returned HTTP 200 for Workers, D1, R2,
Workflows and Pages. No resource was created or repurposed; write access and billing
entitlements were not tested.

Current implementation references (retrieved 2026-09-18):

- [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [R2 bindings, checksums, conditions and ranges](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Workflow retry behavior](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
