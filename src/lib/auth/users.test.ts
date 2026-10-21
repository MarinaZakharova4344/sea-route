import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

process.env.DATABASE_PATH = ":memory:";

const HOST = "app.test";

let db: Database.Database;
let users: typeof import("./users");
let loginRoute: typeof import("@/app/api/auth/login/route");
let meRoute: typeof import("@/app/api/auth/me/route");
let limiter: typeof import("./login");
let session: typeof import("./session");

beforeAll(async () => {
  db = (await import("@/db")).getDb();
  (await import("@/db/seed")).seed(db);
  users = await import("./users");
  loginRoute = await import("@/app/api/auth/login/route");
  meRoute = await import("@/app/api/auth/me/route");
  limiter = await import("./login");
  session = await import("./session");
});

beforeEach(() => limiter.resetLoginLimiter());

const login = (email: string, password: string) =>
  loginRoute.POST(new Request(`http://${HOST}/api/auth/login`, { method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));

const cookieOf = async (email: string, password: string) => ((await login(email, password)).headers.get("set-cookie") ?? "").split(";")[0];
const me = (cookie: string) => meRoute.GET(new Request(`http://${HOST}/api/auth/me`, { headers: { host: HOST, cookie } }), undefined);

describe("управление пользователями", () => {
  it("новый менеджер входит с созданным паролем; случайный пароль показывается один раз и достаточно длинный", async () => {
    const { password } = users.addUser(db, { email: "Новый.Менеджер@searoute.test".replace("Новый.Менеджер", "olga"), name: "Ольга Иванова", role: "manager" });
    expect(password.length).toBeGreaterThanOrEqual(users.MIN_PASSWORD_LENGTH);
    expect((await login("OLGA@searoute.test", password)).status).toBe(200); // регистр e-mail не важен
    const row = db.prepare("SELECT password_hash FROM users WHERE email = 'olga@searoute.test'").get() as { password_hash: string };
    expect(row.password_hash).not.toContain(password); // в базе только хэш
  });

  it("нельзя завести дубль, слабый пароль, неверную роль и неверный e-mail", () => {
    expect(() => users.addUser(db, { email: "olga@searoute.test", name: "Дубль", role: "manager" })).toThrow(/уже есть/);
    expect(() => users.addUser(db, { email: "a@searoute.test", name: "А", role: "manager", password: "short" })).toThrow(/короче/);
    expect(() => users.addUser(db, { email: "b@searoute.test", name: "Б", role: "admin" })).toThrow(/Роль/);
    expect(() => users.addUser(db, { email: "не-почта", name: "В", role: "manager" })).toThrow(/e-mail/);
  });

  it("смена пароля: старый перестаёт работать, новый работает", async () => {
    users.addUser(db, { email: "petr@searoute.test", name: "Пётр", role: "manager", password: "old-password-1" });
    users.setPassword(db, "petr@searoute.test", "new-password-2");
    expect((await login("petr@searoute.test", "old-password-1")).status).toBe(401);
    expect((await login("petr@searoute.test", "new-password-2")).status).toBe(200);
    expect(() => users.setPassword(db, "net@searoute.test", "whatever123")).toThrow(/не найден/);
  });

  it("отключённый сотрудник не может войти, а его уже открытая сессия перестаёт работать сразу", async () => {
    users.addUser(db, { email: "ushel@searoute.test", name: "Ушедший", role: "manager", password: "password-123" });
    const cookie = await cookieOf("ushel@searoute.test", "password-123");
    expect((await me(cookie)).status).toBe(200);
    users.setDisabled(db, "ushel@searoute.test", true);
    expect((await me(cookie)).status).toBe(401);
    expect((await login("ushel@searoute.test", "password-123")).status).toBe(401);
    users.setDisabled(db, "ushel@searoute.test", false);
    expect((await login("ushel@searoute.test", "password-123")).status).toBe(200);
  });

  it("нельзя отключить единственного руководителя (иначе аналитику никто не откроет)", () => {
    expect(() => users.setDisabled(db, "director@searoute.test", true)).toThrow(/единственного руководителя/);
  });

  it("список показывает отключённых", () => {
    users.setDisabled(db, "olga@searoute.test", true);
    const list = users.listUsers(db);
    expect(list.find((u) => u.email === "olga@searoute.test")?.disabled).toBe(true);
    expect(list.find((u) => u.email === "ivan@searoute.test")?.disabled).toBe(false);
    users.setDisabled(db, "olga@searoute.test", false);
    expect(session.SESSION_COOKIE).toBeTruthy();
  });
});
