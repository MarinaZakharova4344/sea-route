import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";
import { getDb } from "@/db";
import type { AuthUser } from "./authorize";

// Хэш для сравнения, когда пользователя с таким e-mail нет: время ответа не выдаёт, существует ли адрес.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const WINDOW_MS = 15 * 60 * 1000;
/** Неудачных попыток за 15 минут: с одного адреса на один e-mail / с одного адреса на любые e-mail / на один e-mail со всех адресов. */
const LIMIT_PAIR = 5;
const LIMIT_IP = 20;
const LIMIT_EMAIL_ANY_IP = 30;
/** Если адрес клиента неизвестен (нет прокси, который его передаёт), считаем только по e-mail и допускаем больше попыток. */
const LIMIT_EMAIL_UNKNOWN_IP = 10;
const failures = new Map<string, number[]>();

export function resetLoginLimiter(): void {
  failures.clear();
}

function recent(key: string, now: number): number[] {
  return (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
}

const keys = (email: string, ip: string | null) => ({
  pair: ip ? `p:${ip}|${email}` : `e0:${email}`,
  ip: ip ? `i:${ip}` : null,
  email: `e:${email}`,
});

/**
 * Блокировка по паре «адрес + e-mail», а не по одному e-mail: иначе любой, кто знает адрес почты руководителя,
 * мог бы закрыть ему вход, просто вводя неверные пароли. Подбор пароля всё равно ограничен: на адрес, на e-mail со
 * всех адресов вместе.
 */
export function isLocked(email: string, ip: string | null = null, now = Date.now()): boolean {
  const k = keys(email, ip);
  if (recent(k.pair, now).length >= (ip ? LIMIT_PAIR : LIMIT_EMAIL_UNKNOWN_IP)) return true;
  if (k.ip && recent(k.ip, now).length >= LIMIT_IP) return true;
  return recent(k.email, now).length >= LIMIT_EMAIL_ANY_IP;
}

function registerFailure(email: string, ip: string | null, now: number): void {
  const k = keys(email, ip);
  for (const key of [k.pair, k.ip, k.email]) if (key) failures.set(key, [...recent(key, now), now]);
}

function clearFailures(email: string, ip: string | null): void {
  const k = keys(email, ip);
  failures.delete(k.pair);
}

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: "invalid" | "locked" };

export async function checkCredentials(
  rawEmail: string,
  password: string,
  db: Database.Database = getDb(),
  now = Date.now(),
  ip: string | null = null,
): Promise<LoginResult> {
  const email = rawEmail.trim().toLowerCase();
  if (isLocked(email, ip, now)) return { ok: false, reason: "locked" };

  const row = db
    .prepare("SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = ?")
    .get(email) as (AuthUser & { password_hash: string }) | undefined;

  const match = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !match) {
    registerFailure(email, ip, now);
    return { ok: false, reason: "invalid" };
  }
  clearFailures(email, ip);
  const { password_hash: _omit, ...user } = row;
  void _omit;
  return { ok: true, user };
}
