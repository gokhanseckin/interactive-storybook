# Cloudflare data operations lane

Date: 2026-09-18

Branch: `codex/cloudflare-data-operations`

Required baseline: `3d082b468cee09577c5cbf37a45da3a818c9c9d7`
(`Prepare Cloudflare runtime and shared native audio byte reuse`)

## Scope and result

Implemented local-only operational tooling under `services/cloudflare/scripts/` for:

- transactional D1 metadata export plus checksum-addressed private-R2 object export;
- portable, checksum-sealed backup bundles with an explicit completion marker;
- migration from the existing `content.sqlite` and filesystem `media/` layout;
- validation of story/release identities, immutable manifest contracts, asset metadata and
  bytes, active/published release references, owners/editors, publication actors, and
  generation idempotency records;
- restore into a new isolated Miniflare persistence target through a sibling partial target,
  followed by logical row/reference/schema-guard checks and atomic rename;
- replay-safe restore policy: copied sessions and login throttles are omitted, scheduled
  publications and queued generation jobs are held, and in-flight generation jobs become
  `uncertain` while their IDs, keys, attempts, provider request IDs, and provenance remain;
- a second backup/restore cycle from the restored D1/R2 target to demonstrate replay safety.

No runtime code, migration, `local-user.ts`, dependency manifest, lockfile, global
configuration, or central progress document was changed. No source record/object is deleted.
No remote resource, production data, deployment, provisioning, paid generation, orphan
cleanup, simulator, or physical device was used. Child speech and the opt-in shared audio
cache were untouched.

## Operator interface

The documented entry point is:

```sh
node --import tsx services/cloudflare/scripts/data-operations.ts backup \
  --source cloudflare-local --persist-to LOCAL_STATE --output NEW_BUNDLE
node --import tsx services/cloudflare/scripts/data-operations.ts verify --input BUNDLE
node --import tsx services/cloudflare/scripts/data-operations.ts restore \
  --input BUNDLE --persist-to NEW_LOCAL_STATE
```

For migration, use `--source legacy --data-dir LEGACY_DATA_DIR`. `export` aliases `backup`,
and `import` aliases `restore`. The CLI deliberately has no remote mode. Existing output and
restore targets are rejected. A final bundle is not visible until tables, objects,
`manifest.json`, and `COMPLETE` are sealed; incomplete or altered input is rejected before a
restore target is created. Abrupt operations may leave only a hidden sibling `.partial-*`
directory, which is not accepted as complete input and can be removed after confirming that
no local operation uses it.

## Automated evidence

Node: `/Users/gokhanseckin/.nvm/versions/node/v22.22.2/bin/node` (`v22.22.2`).

Commands and results:

```text
npm run cloudflare:check
PASS: TypeScript completed with no errors.

npx vitest run services/cloudflare/scripts/data-operations.test.ts
PASS: 1 file, 3 tests.

npm run cloudflare:test
PASS: Wrangler local dry-run build; 2 files, 14 tests.
Dry-run bundle: 1386.02 KiB / 238.27 KiB gzip.

npm test
PASS: 2 files, 12 tests.

npm run typecheck
PASS: TypeScript completed with no errors.

wrangler d1 migrations apply DB --local --persist-to TEMP_STATE ...
data-operations.ts backup ...; verify ...; restore ...
PASS: installed Wrangler 4.134.0 state was exported, verified, and restored into a new
local target through the documented CLI; all eight empty tables and exclusion counts matched.

git diff --check
PASS: no whitespace errors.
```

The dedicated rehearsal created a legacy SQLite/filesystem fixture containing a published
immutable release, two users with distinct roles, a session, one scheduled publication, one
queued job, one running job with a provider request ID, audit history, and a real MP3 asset.
It then performed:

1. legacy export and complete bundle verification;
2. isolated D1/R2 restore with exact media SHA-256 verification;
3. confirmation that sessions/login attempts are empty;
4. confirmation that the queued job is held, the running job is uncertain, the schedule is
   held, and both original idempotency keys remain;
5. confirmation that the active release remains in retained publication membership and the
   D1 immutable-release trigger rejects an update;
6. D1/R2 re-export and restore into a second isolated target, confirming the safety states and
   idempotency keys remain stable;
7. rejection of a bundle missing its `COMPLETE` marker and rejection of restore over an
   existing target.

The fixture also contains an incomplete hidden draft with an empty card description to prove
backup validation does not incorrectly require draft publication readiness.

## Check classification

- Automated: TypeScript, portable bundle validation, legacy migration, two isolated local
  restores, immutable trigger, R2 checksums, session revocation, held work, replay safety,
  complete Cloudflare integration suite, and existing backend/contracts suite passed.
- Simulator: not applicable and not run; this lane changes no mobile/runtime playback code.
- Physical device: not applicable and not run; this lane changes no device code.
- Unavailable/not authorized: remote D1/R2 export or restore, hosted staging rehearsal,
  production access, resource provisioning, deployment, provider reconciliation, paid
  generation, and Cloudflare-managed backup API evaluation.

## Remaining gaps

- A hosted backup/restore adapter and rehearsal require separate authorization, actual isolated
  resource identifiers, an agreed maintenance/quiescence window, and Cloudflare runtime/cost
  qualification. This lane intentionally cannot contact remote D1 or R2.
- The current local export reads all metadata in one D1 transactional batch, suitable for the
  initial data scale. Operational pagination/retention thresholds should be revisited with
  measured hosted volume before rollout.
- D1's Worker API rejects `PRAGMA integrity_check`; local D1 restore therefore verifies row
  counts, schema guards, contracts, references, uniqueness constraints during insertion, and
  every R2 checksum. Legacy SQLite input additionally runs native `integrity_check` and
  `foreign_key_check` before export.
- Held schedules/jobs require an explicit later reconciliation procedure before an operator
  starts any restored environment. This tooling intentionally does not provide an automatic
  resume command.

## Integration/interface requests

1. Cloudflare runtime session: confirm that future runtime queries continue to execute only
   `publications.state='scheduled'` and only explicitly invoked `jobs.state='queued'`; treat
   `held-after-restore` as inert and `uncertain` as requiring provider reconciliation. Do not
   broaden these selectors without updating restore safety tests.
2. Cloudflare runtime session: preserve the current table columns, release immutability and
   retention triggers, R2 key=`sha256`, and asset JSON contract, or version this bundle format
   and add a migration before changing them.
3. Integration session: optionally add root package scripts for the documented CLI and its
   dedicated test. `package.json` and lockfiles were intentionally left unchanged in this lane.
4. Integration session: decide whether held-work reconciliation needs a separately authorized
   operational command or an admin UI. It must never blindly retry a `running`/`uncertain`
   provider request or automatically re-enable a restored schedule.
