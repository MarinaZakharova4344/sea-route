import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "sr_session";
/** Обычный вход: сессия до закрытия браузера, но не дольше 12 часов. */
export const SESSION_TTL_SECONDS = 60 * 60 * 12;
/** «Запомнить меня на этом устройстве»: 30 дней. */
export const REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30;

const DEV_SECRET = "dev-only-secret-change-me-in-env-0123456789";

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET не задан. Скопируйте .env.example в .env и задайте значение.");
    }
    return new TextEncoder().encode(DEV_SECRET);
  }
  return new TextEncoder().encode(value);
}

/** Токен хранит только id пользователя: роль каждый раз берётся из базы. */
export async function signSession(userId: number, ttlSeconds: number = SESSION_TTL_SECONDS): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

/** Возвращает id пользователя или null, если токен неверный, подделан или просрочен. */
export async function verifySession(token: string | undefined | null): Promise<number | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

const secureFlag = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

/** Без `remember` кука «сессионная» и исчезает при закрытии браузера; с ним живёт 30 дней. */
export function sessionCookie(token: string, remember = false): string {
  const maxAge = remember ? `; Max-Age=${REMEMBER_TTL_SECONDS}` : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${maxAge}${secureFlag()}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}
