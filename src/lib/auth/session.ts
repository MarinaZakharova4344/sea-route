import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "sr_session";
/** Обычный вход: сессия до закрытия браузера, но не дольше 12 часов. */
export const SESSION_TTL_SECONDS = 60 * 60 * 12;
/** «Запомнить меня на этом устройстве»: 30 дней. */
export const REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30;

const DEV_SECRET = "dev-only-secret-change-me-in-env-0123456789";

const PLACEHOLDER = /change-me|example|your-secret|secret-here/i;
const encode = (v: string) => new TextEncoder().encode(v);

/**
 * Секрет подписи сессий. В рабочей среде секрет из образца (`change-me…`) или слишком короткий (меньше 32 символов)
 * нельзя использовать: его знает любой, кто видел `.env.example`, и сессию можно было бы подделать. Вместо этого создаётся
 * случайный секрет на время работы процесса (после перезапуска придётся войти заново), а в журнал пишется предупреждение.
 */
function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 32 && !PLACEHOLDER.test(value)) return encode(value);
  if (process.env.NODE_ENV !== "production") return encode(value || DEV_SECRET);

  // Один и тот же секрет для всех частей приложения в процессе (страницы и API собираются отдельно).
  const shared = globalThis as { __seaRouteSecret?: string };
  if (!shared.__seaRouteSecret) {
    shared.__seaRouteSecret = crypto.randomUUID() + crypto.randomUUID();
    console.warn("ВНИМАНИЕ: SESSION_SECRET не задан или слишком простой. Использован временный случайный секрет: после перезапуска все войдут заново. Задайте длинную случайную строку в .env.");
  }
  return encode(shared.__seaRouteSecret);
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

/**
 * Запрос пришёл по защищённому соединению (https напрямую или через туннель/прокси).
 * Флаг Secure ставится только тогда: по обычному http://, например с телефона по адресу из локальной сети,
 * браузер такую куку не сохранит, и вход бы «не держался».
 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

const secureFlag = (secure: boolean) => (secure ? "; Secure" : "");

/** Без `remember` кука «сессионная» и исчезает при закрытии браузера; с ним живёт 30 дней. */
export function sessionCookie(token: string, remember = false, secure = false): string {
  const maxAge = remember ? `; Max-Age=${REMEMBER_TTL_SECONDS}` : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${maxAge}${secureFlag(secure)}`;
}

export function clearedSessionCookie(secure = false): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(secure)}`;
}
