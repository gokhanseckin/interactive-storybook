import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  AssetSchema,
  ManifestSchema,
  StorySchema,
  assets as manifestAssets,
  type Asset,
} from "@story/contracts";

export const BUNDLE_VERSION = 1;
export const LOCAL_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
export const LOCAL_BUCKET_ID = "story-media-local";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(SCRIPT_DIR, "../migrations/0001_platform.sql");
const TABLES = [
  "users",
  "stories",
  "releases",
  "published_releases",
  "jobs",
  "publications",
  "audit",
  "assets",
] as const;
type TableName = (typeof TABLES)[number];
export type Row = Record<string, string | number | null>;
export type Snapshot = Record<TableName, Row[]>;

const COLUMNS: Record<TableName, string[]> = {
  users: ["id", "email", "password", "roles"],
  stories: ["id", "owner", "revision", "data"],
  releases: ["id", "story_id", "data"],
  published_releases: ["id"],
  jobs: ["id", "story_id", "key", "state", "data"],
  publications: ["id", "story_id", "state", "due", "data"],
  audit: ["id", "at", "actor", "action", "subject"],
  assets: ["id", "data", "created"],
};

type FileRecord = { file: string; count: number; sha256: string };
export type BundleManifest = {
  format: "story-platform-data";
  version: 1;
  source: "cloudflare-local" | "legacy-sqlite-filesystem";
  createdAt: string;
  tables: Record<TableName, FileRecord>;
  objects: Array<Asset & { file: string }>;
  excluded: { sessions: number; loginAttempts: number };
  restorePolicy: {
    sessions: "revoked";
    scheduledPublications: "held-after-restore";
    queuedJobs: "held-after-restore";
    runningJobs: "uncertain";
  };
};

export type VerifiedBundle = {
  root: string;
  manifest: BundleManifest;
  snapshot: Snapshot;
  assets: Map<string, Asset>;
};

const hash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

const sameAsset = (left: Asset, right: Asset) =>
  left.id === right.id &&
  left.sha256 === right.sha256 &&
  left.bytes === right.bytes &&
  left.duration === right.duration &&
  left.type === right.type;

function json(value: unknown, context: string): any {
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error(`${context} is not valid JSON`);
  }
}

function text(row: Row, key: string, context: string) {
  if (typeof row[key] !== "string")
    throw new Error(`${context}.${key} must be text`);
  return row[key] as string;
}

function integer(row: Row, key: string, context: string) {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error(`${context}.${key} must be an integer`);
  return value;
}

function uniqueRows(rows: Row[], table: TableName) {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const id = text(row, "id", `${table}[${index}]`);
    if (seen.has(id)) throw new Error(`Duplicate ${table} identifier: ${id}`);
    seen.add(id);
    for (const column of COLUMNS[table])
      if (!(column in row))
        throw new Error(`${table}[${index}] is missing ${column}`);
  }
}

export function validateSnapshot(snapshot: Snapshot) {
  for (const table of TABLES) uniqueRows(snapshot[table], table);
  const users = new Set(snapshot.users.map((r) => String(r.id)));
  const emails = new Set<string>();
  const stories = new Map(snapshot.stories.map((r) => [String(r.id), r]));
  const releases = new Map<string, ReturnType<typeof ManifestSchema.parse>>();
  const assetRecords = new Map<string, Asset>();

  for (const [index, row] of snapshot.users.entries()) {
    const email = text(row, "email", `users[${index}]`);
    if (emails.has(email)) throw new Error(`Duplicate user email: ${email}`);
    emails.add(email);
    const roles = json(row.roles, `users[${index}].roles`);
    if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string"))
      throw new Error(`users[${index}].roles must be a string array`);
  }

  for (const [index, row] of snapshot.assets.entries()) {
    const asset = AssetSchema.parse(json(row.data, `assets[${index}].data`));
    if (row.id !== asset.id)
      throw new Error(`Asset row identity mismatch: ${row.id}`);
    assetRecords.set(asset.id, asset);
  }

  for (const [index, row] of snapshot.stories.entries()) {
    const draft = json(row.data, `stories[${index}].data`);
    if (draft.id !== row.id || draft.story?.id !== row.id)
      throw new Error(`Story identity mismatch: ${row.id}`);
    if (draft.owner !== row.owner || !users.has(String(row.owner)))
      throw new Error(`Story owner reference is invalid: ${row.id}`);
    if (draft.revision !== integer(row, "revision", `stories[${index}]`))
      throw new Error(`Story revision mismatch: ${row.id}`);
    StorySchema.parse(draft.story);
    if (
      typeof draft.card?.title !== "string" ||
      typeof draft.card?.description !== "string" ||
      typeof draft.card?.ageBand !== "string" ||
      (draft.card?.cover !== null &&
        !/^[a-f0-9]{64}$/.test(String(draft.card?.cover)))
    )
      throw new Error(`Story card is invalid: ${row.id}`);
    if (
      !Array.isArray(draft.editors) ||
      draft.editors.some((id: unknown) => !users.has(String(id)))
    )
      throw new Error(`Story editor reference is invalid: ${row.id}`);
    for (const clip of Object.values(draft.clips ?? {}) as Array<any>) {
      const asset = AssetSchema.parse(clip.asset);
      const recorded = assetRecords.get(asset.id);
      if (!recorded || !sameAsset(recorded, asset))
        throw new Error(`Story ${row.id} references missing asset ${asset.id}`);
    }
    if (draft.card.cover && !assetRecords.has(draft.card.cover))
      throw new Error(
        `Story ${row.id} references missing cover ${draft.card.cover}`,
      );
  }

  for (const [index, row] of snapshot.releases.entries()) {
    const manifest = ManifestSchema.parse(
      json(row.data, `releases[${index}].data`),
    );
    if (manifest.releaseId !== row.id || manifest.storyId !== row.story_id)
      throw new Error(`Release identity mismatch: ${row.id}`);
    if (!stories.has(String(row.story_id)))
      throw new Error(
        `Release ${row.id} references missing story ${row.story_id}`,
      );
    for (const asset of manifestAssets(manifest)) {
      const recorded = assetRecords.get(asset.id);
      if (!recorded || !sameAsset(recorded, asset))
        throw new Error(
          `Release ${row.id} references missing asset ${asset.id}`,
        );
    }
    releases.set(manifest.releaseId, manifest);
  }

  const published = new Set(
    snapshot.published_releases.map((row) => String(row.id)),
  );
  for (const row of snapshot.published_releases)
    if (!releases.has(String(row.id)))
      throw new Error(`Published release reference is invalid: ${row.id}`);

  for (const [index, row] of snapshot.stories.entries()) {
    const draft = json(row.data, `stories[${index}].data`);
    for (const [locale, releaseId] of Object.entries(draft.active ?? {})) {
      const release = releases.get(String(releaseId));
      if (
        !release ||
        !published.has(String(releaseId)) ||
        release.storyId !== row.id ||
        release.locale !== locale
      )
        throw new Error(
          `Active release reference is invalid: ${row.id}/${locale}`,
        );
    }
  }

  const jobKeys = new Set<string>();
  for (const [index, row] of snapshot.jobs.entries()) {
    const job = json(row.data, `jobs[${index}].data`);
    if (
      job.id !== row.id ||
      job.storyId !== row.story_id ||
      job.state !== row.state
    )
      throw new Error(`Generation job identity/state mismatch: ${row.id}`);
    if (!stories.has(String(row.story_id)) || !users.has(String(job.actor)))
      throw new Error(`Generation job reference is invalid: ${row.id}`);
    const key = text(row, "key", `jobs[${index}]`);
    if (jobKeys.has(key))
      throw new Error(`Duplicate generation idempotency key: ${key}`);
    jobKeys.add(key);
  }

  for (const [index, row] of snapshot.publications.entries()) {
    const publication = json(row.data, `publications[${index}].data`);
    if (!stories.has(String(row.story_id)))
      throw new Error(`Publication story reference is invalid: ${row.id}`);
    const release = releases.get(String(publication.releaseId));
    if (
      !release ||
      release.storyId !== row.story_id ||
      !users.has(String(publication.actor))
    )
      throw new Error(`Publication reference is invalid: ${row.id}`);
    integer(row, "due", `publications[${index}]`);
  }

  return assetRecords;
}

function emptySnapshot(): Snapshot {
  return Object.fromEntries(
    TABLES.map((table) => [table, []]),
  ) as unknown as Snapshot;
}

function resultRow(result: D1Result): Row | undefined {
  return result.results?.[0] as Row | undefined;
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicStage(target: string) {
  const final = resolve(target);
  if (await exists(final)) throw new Error(`Target already exists: ${final}`);
  const stage = join(
    dirname(final),
    `.${basename(final)}.partial-${randomUUID()}`,
  );
  await mkdir(stage, { recursive: false, mode: 0o700 });
  return { final, stage };
}

function rejectNestedTarget(source: string, target: string) {
  const sourceRoot = resolve(source);
  const targetRoot = resolve(target);
  if (targetRoot === sourceRoot || targetRoot.startsWith(sourceRoot + "/"))
    throw new Error(`Target must be outside the source: ${targetRoot}`);
}

export async function openLocalData(
  persistenceRoot: string,
  databaseId = LOCAL_DATABASE_ID,
  bucketId = LOCAL_BUCKET_ID,
) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "",
      resourcePersistencePath: join(resolve(persistenceRoot), "v3"),
      d1Databases: { DB: databaseId },
      r2Buckets: { MEDIA: bucketId },
    }),
  );
  return {
    mf,
    db: (await mf.getD1Database("DB")) as unknown as D1Database,
    bucket: (await mf.getR2Bucket("MEDIA")) as unknown as R2Bucket,
  };
}

export async function applyCurrentMigration(db: D1Database) {
  const source = await readFile(MIGRATION, "utf8");
  const statements = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--"));
  await db.batch(statements.map((sql) => db.prepare(sql)));
}

export async function snapshotD1(db: D1Database) {
  const results = await db.batch(
    TABLES.map((table) =>
      db.prepare(
        `SELECT ${COLUMNS[table].join(",")} FROM ${table} ORDER BY id`,
      ),
    ),
  );
  const snapshot = emptySnapshot();
  TABLES.forEach((table, index) => {
    snapshot[table] = (results[index].results ?? []) as Row[];
  });
  const excluded = await db.batch([
    db.prepare("SELECT count(*) AS count FROM sessions"),
    db.prepare("SELECT count(*) AS count FROM login_attempts"),
  ]);
  return {
    snapshot,
    excluded: {
      sessions: Number(resultRow(excluded[0])?.count ?? 0),
      loginAttempts: Number(resultRow(excluded[1])?.count ?? 0),
    },
  };
}

export function snapshotLegacy(databasePath: string) {
  const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
  const snapshot = emptySnapshot();
  try {
    database.exec("BEGIN");
    const integrity = database.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok")
      throw new Error("Legacy database failed integrity_check");
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Legacy database has broken foreign keys");
    for (const table of TABLES)
      snapshot[table] = database
        .prepare(`SELECT ${COLUMNS[table].join(",")} FROM ${table} ORDER BY id`)
        .all() as Row[];
    const sessions = Number(
      (database.prepare("SELECT count(*) AS count FROM sessions").get() as any)
        .count,
    );
    database.exec("COMMIT");
    return { snapshot, excluded: { sessions, loginAttempts: 0 } };
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    database.close();
  }
}

type ExportInput = {
  output: string;
  source: BundleManifest["source"];
  snapshot: Snapshot;
  excluded: BundleManifest["excluded"];
  readObject: (asset: Asset) => Promise<Uint8Array>;
};

export async function createBundle(input: ExportInput) {
  const assetRecords = validateSnapshot(input.snapshot);
  const { final, stage } = await atomicStage(input.output);
  try {
    await mkdir(join(stage, "tables"), { mode: 0o700 });
    await mkdir(join(stage, "objects"), { mode: 0o700 });
    const tableRecords = {} as Record<TableName, FileRecord>;
    for (const table of TABLES) {
      const bytes = Buffer.from(
        JSON.stringify(input.snapshot[table], null, 2) + "\n",
      );
      const file = `tables/${table}.json`;
      await writeFile(join(stage, file), bytes, { mode: 0o600 });
      tableRecords[table] = {
        file,
        count: input.snapshot[table].length,
        sha256: hash(bytes),
      };
    }
    const objects: BundleManifest["objects"] = [];
    for (const asset of [...assetRecords.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const bytes = await input.readObject(asset);
      if (bytes.byteLength !== asset.bytes || hash(bytes) !== asset.sha256)
        throw new Error(`Asset missing or corrupt: ${asset.id}`);
      const file = `objects/${asset.id}`;
      await writeFile(join(stage, file), bytes, { mode: 0o600 });
      objects.push({ ...asset, file });
    }
    const manifest: BundleManifest = {
      format: "story-platform-data",
      version: BUNDLE_VERSION,
      source: input.source,
      createdAt: new Date().toISOString(),
      tables: tableRecords,
      objects,
      excluded: input.excluded,
      restorePolicy: {
        sessions: "revoked",
        scheduledPublications: "held-after-restore",
        queuedJobs: "held-after-restore",
        runningJobs: "uncertain",
      },
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(join(stage, "manifest.json"), manifestBytes, {
      mode: 0o600,
    });
    await writeFile(join(stage, "COMPLETE"), hash(manifestBytes) + "\n", {
      mode: 0o600,
    });
    await rename(stage, final);
    return manifest;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function exportLegacy(dataDir: string, output: string) {
  const root = resolve(dataDir);
  rejectNestedTarget(root, output);
  const source = snapshotLegacy(join(root, "content.sqlite"));
  return createBundle({
    ...source,
    output,
    source: "legacy-sqlite-filesystem",
    readObject: (asset) => readFile(join(root, "media", asset.id)),
  });
}

export async function exportCloudflareLocal(
  persistenceRoot: string,
  output: string,
  databaseId = LOCAL_DATABASE_ID,
  bucketId = LOCAL_BUCKET_ID,
) {
  rejectNestedTarget(persistenceRoot, output);
  const local = await openLocalData(persistenceRoot, databaseId, bucketId);
  try {
    const source = await snapshotD1(local.db);
    return await createBundle({
      ...source,
      output,
      source: "cloudflare-local",
      readObject: async (asset) => {
        const object = await local.bucket.get(asset.id);
        if (!object) throw new Error(`R2 object is missing: ${asset.id}`);
        return new Uint8Array(await object.arrayBuffer());
      },
    });
  } finally {
    await local.mf.dispose();
  }
}

function safeBundleFile(root: string, relative: string) {
  if (!relative || relative.startsWith("/") || relative.includes(".."))
    throw new Error(`Unsafe bundle path: ${relative}`);
  const path = resolve(root, relative);
  if (!path.startsWith(resolve(root) + "/"))
    throw new Error(`Unsafe bundle path: ${relative}`);
  return path;
}

export async function verifyBundle(input: string): Promise<VerifiedBundle> {
  const root = resolve(input);
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const completion = (await readFile(join(root, "COMPLETE"), "utf8")).trim();
  if (completion !== hash(manifestBytes))
    throw new Error("Bundle is incomplete or manifest hash differs");
  const manifest = JSON.parse(manifestBytes.toString()) as BundleManifest;
  if (
    manifest.format !== "story-platform-data" ||
    manifest.version !== BUNDLE_VERSION
  )
    throw new Error("Unsupported data bundle format/version");
  if (
    !["cloudflare-local", "legacy-sqlite-filesystem"].includes(
      manifest.source,
    ) ||
    !Number.isSafeInteger(manifest.excluded?.sessions) ||
    manifest.excluded.sessions < 0 ||
    !Number.isSafeInteger(manifest.excluded?.loginAttempts) ||
    manifest.excluded.loginAttempts < 0
  )
    throw new Error("Bundle manifest metadata is invalid");
  const snapshot = emptySnapshot();
  for (const table of TABLES) {
    const record = manifest.tables?.[table];
    if (!record) throw new Error(`Bundle manifest is missing table ${table}`);
    const bytes = await readFile(safeBundleFile(root, record.file));
    if (hash(bytes) !== record.sha256)
      throw new Error(`Table checksum differs: ${table}`);
    const rows = JSON.parse(bytes.toString());
    if (!Array.isArray(rows) || rows.length !== record.count)
      throw new Error(`Table count differs: ${table}`);
    snapshot[table] = rows;
  }
  const assetRecords = validateSnapshot(snapshot);
  const listedObjects = new Set<string>();
  for (const object of manifest.objects ?? []) {
    const asset = AssetSchema.parse(object);
    if (!assetRecords.has(asset.id) || listedObjects.has(asset.id))
      throw new Error(`Unexpected or duplicate object: ${asset.id}`);
    const bytes = await readFile(safeBundleFile(root, object.file));
    if (bytes.byteLength !== asset.bytes || hash(bytes) !== asset.sha256)
      throw new Error(`Object checksum differs: ${asset.id}`);
    listedObjects.add(asset.id);
  }
  for (const id of assetRecords.keys())
    if (!listedObjects.has(id))
      throw new Error(`Bundle object is missing: ${id}`);
  return { root, manifest, snapshot, assets: assetRecords };
}

export function applyRestoreSafety(snapshot: Snapshot) {
  const safe = structuredClone(snapshot);
  let heldJobs = 0,
    uncertainJobs = 0,
    heldPublications = 0;
  safe.jobs = safe.jobs.map((row) => {
    let state = String(row.state);
    if (state === "queued") {
      state = "held-after-restore";
      heldJobs++;
    } else if (state === "running") {
      state = "uncertain";
      uncertainJobs++;
    }
    const data = json(row.data, `job ${row.id}`);
    data.state = state;
    return { ...row, state, data: JSON.stringify(data) };
  });
  safe.publications = safe.publications.map((row) => {
    if (row.state !== "scheduled") return row;
    heldPublications++;
    return { ...row, state: "held-after-restore" };
  });
  validateSnapshot(safe);
  return { snapshot: safe, heldJobs, uncertainJobs, heldPublications };
}

function insertStatement(db: D1Database, table: TableName, row: Row) {
  const columns = COLUMNS[table];
  return db
    .prepare(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    )
    .bind(...columns.map((column) => row[column]));
}

async function insertSnapshot(db: D1Database, snapshot: Snapshot) {
  const statements = TABLES.flatMap((table) =>
    snapshot[table].map((row) => insertStatement(db, table, row)),
  );
  for (let offset = 0; offset < statements.length; offset += 50)
    await db.batch(statements.slice(offset, offset + 50));
}

export async function restoreLocal(
  input: string,
  persistenceRoot: string,
  databaseId = LOCAL_DATABASE_ID,
  bucketId = LOCAL_BUCKET_ID,
) {
  const bundle = await verifyBundle(input);
  rejectNestedTarget(bundle.root, persistenceRoot);
  const safety = applyRestoreSafety(bundle.snapshot);
  const { final, stage } = await atomicStage(persistenceRoot);
  let local: Awaited<ReturnType<typeof openLocalData>> | undefined;
  try {
    local = await openLocalData(stage, databaseId, bucketId);
    await applyCurrentMigration(local.db);
    const objectFiles = new Map(
      bundle.manifest.objects.map((object) => [object.id, object.file]),
    );
    for (const asset of bundle.assets.values()) {
      const bytes = await readFile(
        safeBundleFile(bundle.root, objectFiles.get(asset.id)!),
      );
      await local.bucket.put(asset.id, bytes, {
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: asset.sha256,
        httpMetadata: { contentType: asset.type },
      });
      const head = await local.bucket.head(asset.id);
      const digest = head?.checksums.sha256
        ? Buffer.from(head.checksums.sha256).toString("hex")
        : "";
      if (!head || head.size !== asset.bytes || digest !== asset.sha256)
        throw new Error(`Restored R2 object failed verification: ${asset.id}`);
    }
    await insertSnapshot(local.db, safety.snapshot);
    const checks = await local.db.batch([
      local.db.prepare("SELECT count(*) AS count FROM sessions"),
      local.db.prepare("SELECT count(*) AS count FROM login_attempts"),
      local.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('immutable_release','retained_release') ORDER BY name",
      ),
    ]);
    if (
      Number(resultRow(checks[0])?.count) ||
      Number(resultRow(checks[1])?.count)
    )
      throw new Error(
        "Restored local target contains sessions or login attempts",
      );
    if (checks[2].results?.length !== 2)
      throw new Error("Restored D1 is missing immutable release guards");
    const restored = await snapshotD1(local.db);
    validateSnapshot(restored.snapshot);
    for (const table of TABLES)
      if (restored.snapshot[table].length !== safety.snapshot[table].length)
        throw new Error(`Restored D1 row count differs: ${table}`);
    await local.mf.dispose();
    local = undefined;
    await writeFile(
      join(stage, "RESTORE.json"),
      JSON.stringify(
        {
          bundleManifestSha256: (
            await readFile(join(bundle.root, "COMPLETE"), "utf8")
          ).trim(),
          restoredAt: new Date().toISOString(),
          sessionsRevoked: bundle.manifest.excluded.sessions,
          ...safety,
          snapshot: undefined,
          automaticExecutionEnabled: false,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await chmod(stage, 0o700);
    await rename(stage, final);
    return {
      target: final,
      sessionsRevoked: bundle.manifest.excluded.sessions,
      heldJobs: safety.heldJobs,
      uncertainJobs: safety.uncertainJobs,
      heldPublications: safety.heldPublications,
    };
  } catch (error) {
    await local?.mf.dispose().catch(() => {});
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
