import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "sea-route.db");

export function openDb(file: string = process.env.DATABASE_PATH ?? DEFAULT_DB_PATH): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function applySchema(db: Database.Database): void {
  const sql = fs.readFileSync(path.join(process.cwd(), "src", "db", "schema.sql"), "utf8");
  db.exec(sql);
}

let shared: Database.Database | undefined;

/** Общее подключение для серверного кода приложения. */
export function getDb(): Database.Database {
  if (!shared) {
    shared = openDb();
    applySchema(shared);
  }
  return shared;
}
