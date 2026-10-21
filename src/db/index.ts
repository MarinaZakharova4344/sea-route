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

/** Колонки, добавленные после первой версии схемы: для баз, созданных раньше (CREATE TABLE IF NOT EXISTS их не добавит). */
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "users", column: "disabled_at", ddl: "ALTER TABLE users ADD COLUMN disabled_at TEXT" },
];

function ensureColumns(db: Database.Database): void {
  for (const c of ADDED_COLUMNS) {
    const has = (db.prepare(`PRAGMA table_info(${c.table})`).all() as { name: string }[]).some((x) => x.name === c.column);
    if (!has) db.exec(c.ddl);
  }
}

export function applySchema(db: Database.Database): void {
  const sql = fs.readFileSync(path.join(process.cwd(), "src", "db", "schema.sql"), "utf8");
  db.exec(sql);
  ensureColumns(db);
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
