import type Database from "better-sqlite3";
import { getDb } from "@/db";
import { readCookie, SESSION_COOKIE, verifySession } from "./session";

export type Role = "manager" | "director";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

/** Права по ролям: что разрешено каждой роли. Используется и серверными страницами, и API. */
export const ROLES: Record<Role, readonly Role[]> = {
  manager: ["manager"],
  director: ["director"],
};

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export async function getUserByToken(token: string | undefined, db: Database.Database = getDb()): Promise<AuthUser | null> {
  const id = await verifySession(token);
  if (id === null) return null;
  // Роль берётся из базы, а не из токена: изменение роли, отключение или удаление пользователя действует сразу.
  const row = db.prepare("SELECT id, email, name, role FROM users WHERE id = ? AND disabled_at IS NULL").get(id) as AuthUser | undefined;
  return row ?? null;
}

export function getUserFromRequest(request: Request, db?: Database.Database): Promise<AuthUser | null> {
  return getUserByToken(readCookie(request.headers.get("cookie"), SESSION_COOKIE), db);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Адрес клиента для ограничения попыток входа. Его передаёт прокси или туннель в заголовке X-Forwarded-For;
 * без прокси адрес неизвестен (null), и ограничение считается только по e-mail.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const ip = forwarded || real || null;
  return ip && ip.length <= 64 ? ip : null;
}

/** Защита от подделки запроса с чужого сайта: изменяющий запрос должен прийти с нашего адреса. */
export function isForeignOrigin(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; response: Response };

/**
 * Проверка на сервере: кто делает запрос и разрешено ли ему это.
 * 401: не вошёл; 403: вошёл, но роль не подходит (или запрос пришёл с чужого сайта).
 */
export async function authorize(request: Request, roles?: readonly Role[], db?: Database.Database): Promise<AuthResult> {
  if (isForeignOrigin(request)) {
    return { ok: false, response: json({ error: "Запрос с недопустимого источника" }, 403) };
  }
  const user = await getUserFromRequest(request, db);
  if (!user) return { ok: false, response: json({ error: "Требуется вход в систему" }, 401) };
  if (roles && !roles.includes(user.role)) {
    return { ok: false, response: json({ error: "Недостаточно прав для этого действия" }, 403) };
  }
  return { ok: true, user };
}

type Handler<C> = (request: Request, user: AuthUser, context: C) => Response | Promise<Response>;

/** Обёртка для обработчиков API: `export const POST = withAuth(["manager"], async (req, user) => ...)`. */
export function withAuth<C = unknown>(roles: readonly Role[] | undefined, handler: Handler<C>) {
  return async (request: Request, context: C): Promise<Response> => {
    const auth = await authorize(request, roles);
    if (!auth.ok) return auth.response;
    return handler(request, auth.user, context);
  };
}
