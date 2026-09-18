// Local D1 only. No deployment, remote flag or cloud account credentials are used.
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { passwordHash } from "../../content-api/src/auth.ts";
const [email, roleList = "creator,publisher"] = process.argv.slice(2),
  password = process.env.STUDIO_PASSWORD;
const roles = roleList.split(",");
if (
  !email?.includes("@") ||
  !password ||
  password.length < 12 ||
  roles.some((r) => !["creator", "publisher", "admin"].includes(r))
)
  throw new Error(
    "Set STUDIO_PASSWORD (12+ characters), then cloudflare:user -- email creator,publisher",
  );
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const directory = mkdtempSync(join(tmpdir(), "story-local-user-")),
  file = join(directory, "user.sql");
try {
  writeFileSync(
    file,
    `INSERT INTO users VALUES(${[randomUUID(), email.toLowerCase(), passwordHash(password), JSON.stringify(roles)].map(quote).join(",")}) ON CONFLICT(email) DO UPDATE SET password=excluded.password,roles=excluded.roles;\nDELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE email=${quote(email.toLowerCase())});`,
    { mode: 0o600 },
  );
  execFileSync(
    process.execPath,
    [
      resolve("node_modules/wrangler/bin/wrangler.js"),
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "services/cloudflare/wrangler.jsonc",
      "--file",
      file,
    ],
    { stdio: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  console.log("Local D1 user provisioned; previous sessions revoked.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
