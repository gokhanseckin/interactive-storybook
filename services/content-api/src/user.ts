import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Store } from "./store.ts";
import { passwordHash } from "./auth.ts";
const [email, roleList = "creator,publisher"] = process.argv.slice(2);
const password = process.env.STUDIO_PASSWORD;
if (!email || !password || password.length < 12)
  throw new Error(
    "Usage: STUDIO_PASSWORD=<12+ characters> npm run studio:user -- email creator,publisher",
  );
const roles = roleList.split(",");
if (roles.some((r) => !["creator", "publisher", "admin"].includes(r)))
  throw new Error("Invalid roles");
const store = new Store(
  join(
    process.env.DATA_DIR ?? join(".data", process.env.APP_ENV ?? "development"),
    "content.sqlite",
  ),
);
const old = store.one(
  "SELECT id FROM users WHERE email=?",
  email.toLowerCase(),
);
store.transaction(() => {
  const id = old?.id ?? randomUUID();
  store.run(
    "INSERT INTO users VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET password=excluded.password,roles=excluded.roles",
    id,
    email.toLowerCase(),
    passwordHash(password),
    JSON.stringify(roles),
  );
  store.run("DELETE FROM sessions WHERE user_id=?", id);
  store.audit("operator", "user.provision", id);
});
console.log("User provisioned; existing sessions revoked.");
