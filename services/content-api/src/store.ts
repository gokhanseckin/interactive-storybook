import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, roles TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stories(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY, story_id TEXT REFERENCES stories(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS published_releases(id TEXT PRIMARY KEY REFERENCES releases(id));
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, story_id TEXT REFERENCES stories(id), key TEXT UNIQUE NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY, story_id TEXT REFERENCES stories(id), state TEXT NOT NULL, due INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_release BEFORE UPDATE ON releases BEGIN SELECT RAISE(ABORT,'immutable release'); END;
      CREATE TRIGGER IF NOT EXISTS retained_release BEFORE DELETE ON releases BEGIN SELECT RAISE(ABORT,'retain historical release'); END;`);
  }
  one(sql: string, ...params: any[]): any {
    return this.db.prepare(sql).get(...params);
  }
  all(sql: string, ...params: any[]): any[] {
    return this.db.prepare(sql).all(...params);
  }
  run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  audit(actor: string, action: string, subject: string) {
    this.run(
      "INSERT INTO audit VALUES(?,?,?,?,?)",
      randomUUID(),
      new Date().toISOString(),
      actor,
      action,
      subject,
    );
  }
}
