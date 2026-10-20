import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

// База в памяти; задаётся до загрузки модулей приложения.
process.env.DATABASE_PATH = ":memory:";

const HOST = "app.test";
const PASSWORD = "demo12345";

let db: Database.Database;
let loginRoute: typeof import("@/app/api/auth/login/route");
let logoutRoute: typeof import("@/app/api/auth/logout/route");
let meRoute: typeof import("@/app/api/auth/me/route");
let authz: typeof import("./authorize");
let session: typeof import("./session");
let limiter: typeof import("./login");

beforeAll(async () => {
  const dbModule = await import("@/db");
  db = dbModule.getDb();
  const { seed } = await import("@/db/seed");
  seed(db);
  loginRoute = await import("@/app/api/auth/login/route");
  logoutRoute = await import("@/app/api/auth/logout/route");
  meRoute = await import("@/app/api/auth/me/route");
  authz = await import("./authorize");
  session = await import("./session");
  limiter = await import("./login");
});

beforeEach(() => limiter.resetLoginLimiter());

function req(method: string, path: string, init: { body?: unknown; cookie?: string; origin?: string } = {}): Request {
  const headers: Record<string, string> = { host: HOST, "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  return new Request(`http://${HOST}${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function login(email: string, password = PASSWORD, remember?: boolean): Promise<Response> {
  return loginRoute.POST(req("POST", "/api/auth/login", { body: { email, password, remember } }));
}

async function cookieFor(email: string): Promise<string> {
  const res = await login(email);
  expect(res.status).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const MANAGER = "ivan@searoute.test";
const DIRECTOR = "director@searoute.test";

describe("вход", () => {
  it("верный пароль: 200, в ответе пользователь без хэша пароля, кука httpOnly", async () => {
    const res = await login(MANAGER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: MANAGER, role: "manager" });
    expect(JSON.stringify(body)).not.toMatch(/password|hash|\$2/i);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("без «запомнить меня» кука сессионная (без срока), с ним живёт 30 дней", async () => {
    const plain = (await login(MANAGER)).headers.get("set-cookie") ?? "";
    expect(plain).not.toContain("Max-Age");
    const remembered = (await login(MANAGER, PASSWORD, true)).headers.get("set-cookie") ?? "";
    expect(remembered).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
    // токен «запомненной» сессии действительно работает
    const cookie = remembered.split(";")[0];
    expect((await meRoute.GET(req("GET", "/api/auth/me", { cookie }), undefined)).status).toBe(200);
  });

  it("e-mail без учёта регистра и пробелов", async () => {
    expect((await login("  IVAN@SeaRoute.test ")).status).toBe(200);
  });

  it("неверный пароль и несуществующий e-mail дают одинаковый ответ 401", async () => {
    const wrong = await login(MANAGER, "wrong-password");
    const unknown = await login("nobody@searoute.test");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("пустое тело или без пароля: 400", async () => {
    const res = await loginRoute.POST(req("POST", "/api/auth/login", { body: { email: MANAGER } }));
    expect(res.status).toBe(400);
  });

  it("после 5 неудачных попыток вход блокируется (429), даже с верным паролем", async () => {
    for (let i = 0; i < 5; i++) expect((await login(MANAGER, "bad")).status).toBe(401);
    expect((await login(MANAGER)).status).toBe(429);
    // другой пользователь не затронут
    expect((await login(DIRECTOR)).status).toBe(200);
  });

  it("выход очищает куку", async () => {
    const res = await logoutRoute.POST(req("POST", "/api/auth/logout"));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("кто я: /api/auth/me", () => {
  it("без входа: 401", async () => {
    expect((await meRoute.GET(req("GET", "/api/auth/me"), undefined)).status).toBe(401);
  });

  it("с действующей сессией: 200 и данные пользователя", async () => {
    const cookie = await cookieFor(DIRECTOR);
    const res = await meRoute.GET(req("GET", "/api/auth/me", { cookie }), undefined);
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ email: DIRECTOR, role: "director" });
  });

  it("подделанный токен: 401", async () => {
    const cookie = await cookieFor(MANAGER);
    const forged = cookie.slice(0, -3) + "abc";
    expect((await meRoute.GET(req("GET", "/api/auth/me", { cookie: forged }), undefined)).status).toBe(401);
  });

  it("случайная строка вместо токена: 401", async () => {
    const res = await meRoute.GET(req("GET", "/api/auth/me", { cookie: `${session.SESSION_COOKIE}=not-a-jwt` }), undefined);
    expect(res.status).toBe(401);
  });

  it("просроченный токен: 401", async () => {
    const id = (db.prepare("SELECT id FROM users WHERE email = ?").get(MANAGER) as { id: number }).id;
    const token = await session.signSession(id, -10);
    const res = await meRoute.GET(req("GET", "/api/auth/me", { cookie: `${session.SESSION_COOKIE}=${token}` }), undefined);
    expect(res.status).toBe(401);
  });

  it("токен несуществующего пользователя: 401", async () => {
    const token = await session.signSession(99_999);
    const res = await meRoute.GET(req("GET", "/api/auth/me", { cookie: `${session.SESSION_COOKIE}=${token}` }), undefined);
    expect(res.status).toBe(401);
  });
});

describe("разграничение ролей на сервере", () => {
  // Обработчики собираются при первом обращении: модули подгружаются в beforeAll.
  const make = (roles: Parameters<typeof authz.withAuth>[0]) =>
    (r: Request, c: unknown) => authz.withAuth(roles, (_r, user) => authz.json({ ok: true, as: user.role }))(r, c);
  const managerOnly = make(["manager"]);
  const directorOnly = make(["director"]);
  const anyRole = make(undefined);

  it("без входа любой защищённый обработчик отвечает 401", async () => {
    for (const h of [managerOnly, directorOnly, anyRole]) {
      expect((await h(req("GET", "/x"), undefined)).status).toBe(401);
    }
  });

  it("менеджер: действия менеджера разрешены, руководителя запрещены (403)", async () => {
    const cookie = await cookieFor(MANAGER);
    expect((await managerOnly(req("POST", "/x", { cookie }), undefined)).status).toBe(200);
    expect((await directorOnly(req("GET", "/x", { cookie }), undefined)).status).toBe(403);
    expect((await anyRole(req("GET", "/x", { cookie }), undefined)).status).toBe(200);
  });

  it("руководитель: может смотреть, но не может выполнять действия менеджера (403)", async () => {
    const cookie = await cookieFor(DIRECTOR);
    expect((await directorOnly(req("GET", "/x", { cookie }), undefined)).status).toBe(200);
    const res = await managerOnly(req("POST", "/x", { cookie, body: { any: 1 } }), undefined);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/прав/);
  });

  it("роль берётся из базы, а не из токена: после смены роли старая сессия получает новые права", async () => {
    const cookie = await cookieFor(MANAGER);
    expect((await managerOnly(req("POST", "/x", { cookie }), undefined)).status).toBe(200);
    db.prepare("UPDATE users SET role = 'director' WHERE email = ?").run(MANAGER);
    try {
      expect((await managerOnly(req("POST", "/x", { cookie }), undefined)).status).toBe(403);
    } finally {
      db.prepare("UPDATE users SET role = 'manager' WHERE email = ?").run(MANAGER);
    }
  });

  it("изменяющий запрос с чужого сайта отклоняется (403), со своего проходит", async () => {
    const cookie = await cookieFor(MANAGER);
    const foreign = await managerOnly(req("POST", "/x", { cookie, origin: "https://evil.example" }), undefined);
    expect(foreign.status).toBe(403);
    const own = await managerOnly(req("POST", "/x", { cookie, origin: `http://${HOST}` }), undefined);
    expect(own.status).toBe(200);
  });
});
