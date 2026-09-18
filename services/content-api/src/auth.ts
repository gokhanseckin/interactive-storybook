import { Buffer } from "node:buffer";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const tokenHash = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const actual = scryptSync(password, salt, 64);
  return (
    actual.length === Buffer.from(key, "hex").length &&
    timingSafeEqual(actual, Buffer.from(key, "hex"))
  );
}
export type Actor = {
  id: string;
  email: string;
  roles: ("creator" | "publisher" | "admin")[];
};
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireRole(actor: Actor, role: Actor["roles"][number]) {
  if (!actor.roles.includes(role) && !actor.roles.includes("admin"))
    throw new HttpError(403, `${role} permission required`);
}
