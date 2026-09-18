# Local data operations

These scripts create and verify portable backups for the current Story Platform D1 and
private-R2 model, restore them only into a new local persistence directory, and migrate
the earlier SQLite/filesystem model. They never accept a remote flag, account identifier,
or production resource URL.

Use Node 22.13 or later from the repository root. Stop writers to the selected local
source before taking an operational backup. D1 rows are read as one transactional batch;
R2 objects are immutable and checksum-addressed.

```sh
node --import tsx services/cloudflare/scripts/data-operations.ts backup \
  --source cloudflare-local \
  --persist-to .wrangler/state \
  --output /tmp/story-backup

node --import tsx services/cloudflare/scripts/data-operations.ts verify \
  --input /tmp/story-backup

node --import tsx services/cloudflare/scripts/data-operations.ts restore \
  --input /tmp/story-backup \
  --persist-to /tmp/story-restore-state
```

`export` is an alias for `backup`; `import` is an alias for `restore`. The default local
database and bucket identifiers match `wrangler.jsonc`. Override them only for an isolated
local fixture with `--database-id` and `--bucket-id`.

To migrate the original service's `.data` directory:

```sh
node --import tsx services/cloudflare/scripts/data-operations.ts export \
  --source legacy \
  --data-dir .data/development \
  --output /tmp/story-legacy-export

node --import tsx services/cloudflare/scripts/data-operations.ts import \
  --input /tmp/story-legacy-export \
  --persist-to /tmp/story-migrated-state
```

## Safety and recovery behavior

- The final bundle appears only after its tables, objects, manifest hashes, and `COMPLETE`
  marker are written. Verification rejects missing, altered, duplicated, or incomplete input.
- Restore uses a sibling `.partial-*` persistence directory and renames it into place only
  after D1 row-count/schema-guard checks, contract/reference validation, and R2 checksum checks.
  An existing destination is rejected; source data is never modified or deleted.
- Sessions and login-attempt state are not copied. Pending schedules become
  `held-after-restore`; queued jobs become `held-after-restore`; running jobs become
  `uncertain`. Identifiers, job idempotency keys, provider request/provenance data, roles,
  story access, audit entries, immutable releases, and published-release membership remain.
- A restore does not start a Worker, cron trigger, Workflow, server, or generation provider.
  Inspect `RESTORE.json` and explicitly reconcile held/uncertain work before any later startup.
- Object keys remain their SHA-256 identifiers. Every asset record and release manifest is
  validated, every referenced asset must exist, and every copied byte stream must match its
  declared size and checksum.

Abrupt termination can leave a hidden sibling `.partial-*` directory. It is never treated as
a completed bundle or restore target. After confirming no process is using it, an operator may
remove that isolated partial directory and rerun the command; the source remains untouched.
