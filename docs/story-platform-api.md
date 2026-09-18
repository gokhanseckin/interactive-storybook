# Story platform API v1

The same-origin Studio is served by `services/content-api`. JSON endpoints live under
`/api`. Errors return `{error:string}` with 400 validation, 401 authentication,
403 permission/withdrawal, 404 missing/private release, or 409 revision/readiness conflict.
All mutations reject foreign browser Origins. Staff sessions expire after eight hours.
Roles and story access are checked on every request; clients cannot assign their own roles.
An admin is a superset of creator/publisher. Publisher access does not imply creator edits.

| Method / path | Access and request | Result |
| --- | --- | --- |
| POST /login | email, password; optional mobile:true | HttpOnly SameSite=Strict cookie; mobile gets an in-memory bearer token |
| POST /logout | authenticated session | Revoke session |
| GET /me | authenticated | Identity and server roles |
| GET /stories | staff | Owned/shared drafts; publishers/admins may review all |
| POST /stories | creator; `{story}` | Hidden draft with new permanent ID |
| GET /stories/:id | ownership/shared or publisher | Draft, readiness errors, clip jobs, releases, schedules |
| PUT /stories/:id | creator with access; `{revision,story?,card?}` | New revision; clears preview/review |
| POST /stories/:id/assets | creator; binary MP3/PNG/JPEG; revision and optional segmentId query | Measured, checksum-addressed asset attached to exact revision |
| POST /stories/:id/jobs | creator; revision, segmentId, provider, key, authorizePaidGeneration:true | Deduplicated durable job |
| POST /stories/:id/preview | authorized staff; revision | Complete draft manifest after file verification |
| POST /stories/:id/previewed | authorized staff; revision | Audited acknowledgment of preview |
| POST /stories/:id/review | publisher; revision | Approval only if exact revision was previewed |
| POST /stories/:id/releases | publisher; revision | Frozen candidate; existing candidate returned for same revision |
| POST /releases/:id/activate | publisher | Verify all assets, then atomically activate; also rollback |
| POST /releases/:id/schedule | publisher; at ISO timestamp with offset, timeZone IANA, key | Idempotent schedule |
| POST /publications/:id/cancel | publisher | Cancel a pending schedule; reschedule by creating a new one |
| POST /stories/:id/visibility | publisher; visibility and optional withdrawn | Change discovery independently of drafts and online access |
| POST /stories/:id/access | admin; editors (user IDs) | Set story collaborators |
| GET /users; PUT /users/:id/roles | admin | Manage roles; changes revoke sessions |
| GET /catalog | public | Metadata only; visible cards and locale release pointers |
| GET /releases/:id | published, not withdrawn | Immutable compatible manifest; historical published releases retained |
| POST /delivery | published, not withdrawn; releaseId, assetId | 15-minute signed media URL; membership checked |
| POST /stories/:id/delivery | authorized staff; revision, assetId | Exact draft preview URL |
| POST /stories/:id/clip-delivery | authorized staff; revision, segmentId | Audition a clip before the entire draft is ready |
| GET /covers/:id | visible catalog cover | Public cover bytes |
| GET /audit | admin | Recent operations, no child audio/transcripts |
| POST /maintenance/orphans | admin | Delete unreferenced assets older than 24h; retain release assets |

`GET /media/:sha256` requires a signed scope, expiration and signature. Supports GET/HEAD,
byte ranges (including suffix), Content-Length, SHA-based ETag, If-Range and 416. No seconds
are converted to byte offsets. MP3 bytes are served unchanged. Withdrawal denies new
online requests; it cannot revoke ordinary MP3 copies or offline files.

The first catalog is free-to-listen: publication is the server authorization for initial
listener access. Drafts/candidates are not listener-accessible. Billing/paid entitlements
are deliberately outside scope. Studio and provider credentials are never shipped to listeners.

Worker states: queued → running → complete / stale / uncertain. Native provider calls
are not automatically retried after an uncertain outcome. A new explicitly authorized
attempt may be made after checking provider usage. Input text, voice settings, provider
request ID, output checksum and initiating actor are retained as generation provenance.
