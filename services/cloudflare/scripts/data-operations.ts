import {
  exportCloudflareLocal,
  exportLegacy,
  restoreLocal,
  verifyBundle,
} from "./data-operations-lib.ts";

function usage(): never {
  throw new Error(`Usage:
  data-operations.ts export|backup --source cloudflare-local --persist-to PATH --output NEW_BUNDLE
  data-operations.ts export|backup --source legacy --data-dir PATH --output NEW_BUNDLE
  data-operations.ts verify --input BUNDLE
  data-operations.ts import|restore --input BUNDLE --persist-to NEW_LOCAL_TARGET

Optional local binding identifiers: --database-id ID --bucket-id ID
Remote operations are deliberately unsupported.`);
}

function argumentsOf(values: string[]) {
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--"))
      usage();
    if (options.has(key)) throw new Error(`Duplicate option: ${key}`);
    options.set(key, value);
  }
  return options;
}

const [command, ...values] = process.argv.slice(2);
if (!command) usage();
const options = argumentsOf(values);
const required = (name: string) => options.get(name) ?? usage();
const databaseId = options.get("--database-id");
const bucketId = options.get("--bucket-id");
const allowed = new Set<string>();
const permit = (...names: string[]) =>
  names.forEach((name) => allowed.add(name));
const rejectUnsupported = () => {
  for (const key of options.keys())
    if (!allowed.has(key)) throw new Error(`Unsupported option: ${key}`);
};

let result: unknown;
if (command === "export" || command === "backup") {
  permit(
    "--source",
    "--output",
    "--persist-to",
    "--data-dir",
    "--database-id",
    "--bucket-id",
  );
  rejectUnsupported();
  const source = required("--source");
  if (source === "legacy") {
    if (databaseId || bucketId || options.has("--persist-to"))
      throw new Error("Legacy export accepts only --data-dir and --output");
    result = await exportLegacy(required("--data-dir"), required("--output"));
  } else if (source === "cloudflare-local") {
    if (options.has("--data-dir"))
      throw new Error("Cloudflare local export does not accept --data-dir");
    result = await exportCloudflareLocal(
      required("--persist-to"),
      required("--output"),
      databaseId,
      bucketId,
    );
  } else throw new Error("--source must be legacy or cloudflare-local");
} else if (command === "verify") {
  permit("--input");
  rejectUnsupported();
  const verified = await verifyBundle(required("--input"));
  result = {
    source: verified.manifest.source,
    tables: Object.fromEntries(
      Object.entries(verified.manifest.tables).map(([name, record]) => [
        name,
        record.count,
      ]),
    ),
    objects: verified.manifest.objects.length,
  };
} else if (command === "import" || command === "restore") {
  permit("--input", "--persist-to", "--database-id", "--bucket-id");
  rejectUnsupported();
  result = await restoreLocal(
    required("--input"),
    required("--persist-to"),
    databaseId,
    bucketId,
  );
} else usage();
console.log(JSON.stringify(result, null, 2));
