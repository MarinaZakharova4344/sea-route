import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";
import { getDb } from "@/db";
import type { AuthUser } from "./authorize";

// Хэш для сравнения, когда пользователя с таким e-mail нет: время ответа не выдаёт, существует ли адрес.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, number[]>();

export function resetLoginLimiter(): void {
  failures.clear();
}

function recent(key: string, now: number): number[] {
  return (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
}

export function isLocked(email: string, now = Date.now()): boolean {
  return recent(email, now).length >= MAX_FAILURES;
}

function registerFailure(email: string, now: number): void {
  failures.set(email, [...recent(email, now), now]);
}

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: "invalid" | "locked" };

export async function checkCredentials(
  rawEmail: string,
  password: string,
  db: Database.Database = getDb(),
  now = Date.now(),
): Promise<LoginResult> {
  const email = rawEmail.trim().toLowerCase();
  if (isLocked(email, now)) return { ok: false, reason: "locked" };

  const row = db
    .prepare("SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = ?")
    .get(email) as (AuthUser & { password_hash: string }) | undefined;

  const match = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !match) {
    registerFailure(email, now);
    return { ok: false, reason: "invalid" };
  }
  failures.delete(email);
  const { password_hash: _omit, ...user } = row;
  void _omit;
  return { ok: true, user };
}
