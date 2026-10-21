/** Управление пользователями: заведение менеджера, смена пароля, отключение ушедшего сотрудника. Используется командой `npm run users`. */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";

export const MIN_PASSWORD_LENGTH = 8;

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: "manager" | "director";
  createdAt: string;
  disabled: boolean;
}

export class UserError extends Error {}

const normalize = (email: string) => email.trim().toLowerCase();

/** Случайный пароль без похожих символов (0/O, 1/l). */
export function generatePassword(length = 12): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new UserError(`Пароль короче ${MIN_PASSWORD_LENGTH} символов`);
}

export function listUsers(db: Database.Database): UserRow[] {
  const rows = db.prepare("SELECT id, email, name, role, created_at AS createdAt, disabled_at FROM users ORDER BY id").all() as (Omit<UserRow, "disabled"> & {
    disabled_at: string | null;
  })[];
  return rows.map(({ disabled_at, ...u }) => ({ ...u, disabled: disabled_at !== null }));
}

/** Заводит пользователя. Если пароль не задан, создаётся случайный и возвращается (показывается один раз). */
export function addUser(db: Database.Database, input: { email: string; name: string; role: string; password?: string }): { id: number; password: string } {
  const email = normalize(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Некорректный e-mail");
  if (!input.name.trim()) throw new UserError("Укажите имя");
  if (input.role !== "manager" && input.role !== "director") throw new UserError("Роль: manager или director");
  if (db.prepare("SELECT 1 FROM users WHERE lower(email) = ?").get(email)) throw new UserError("Пользователь с таким e-mail уже есть");
  const password = input.password ?? generatePassword();
  checkPassword(password);
  const r = db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)").run(email, input.name.trim(), input.role, bcrypt.hashSync(password, 10));
  return { id: Number(r.lastInsertRowid), password };
}

export function setPassword(db: Database.Database, emailRaw: string, password?: string): string {
  const email = normalize(emailRaw);
  const next = password ?? generatePassword();
  checkPassword(next);
  const r = db.prepare("UPDATE users SET password_hash = ? WHERE lower(email) = ?").run(bcrypt.hashSync(next, 10), email);
  if (r.changes === 0) throw new UserError("Пользователь не найден");
  return next;
}

/** Отключает или возвращает пользователя. Отключённый не может войти, а уже открытые сессии перестают работать сразу. */
export function setDisabled(db: Database.Database, emailRaw: string, disabled: boolean): void {
  const email = normalize(emailRaw);
  const row = db.prepare("SELECT id, role FROM users WHERE lower(email) = ?").get(email) as { id: number; role: string } | undefined;
  if (!row) throw new UserError("Пользователь не найден");
  if (disabled && row.role === "director") {
    const others = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'director' AND disabled_at IS NULL AND id <> ?").get(row.id) as { n: number };
    if (others.n === 0) throw new UserError("Нельзя отключить единственного руководителя");
  }
  db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(disabled ? new Date().toISOString() : null, row.id);
}
