import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_PATH = ":memory:";

const HOST = "app.test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: any) => Promise<Response>;
const routes: Record<string, Handler> = {};
let managerCookie = "";
let directorCookie = "";

beforeAll(async () => {
  const db = (await import("@/db")).getDb();
  (await import("@/db/seed")).seed(db);
  routes.attention = (await import("@/app/api/analytics/attention/route")).GET;
  routes.profit = (await import("@/app/api/analytics/profit/route")).GET;
  routes.dynamics = (await import("@/app/api/analytics/dynamics/route")).GET;
  routes.attentionDetail = (await import("@/app/api/analytics/attention/[kind]/route")).GET;
  routes.profitDetail = (await import("@/app/api/analytics/profit/details/[metric]/route")).GET;
  routes.dynamicsDetail = (await import("@/app/api/analytics/dynamics/details/[kind]/route")).GET;
  const login = (await import("@/app/api/auth/login/route")).POST;
  const cookieOf = async (email: string) => {
    const res = await login(
      new Request(`http://${HOST}/api/auth/login`, {
        method: "POST",
        headers: { host: HOST, "content-type": "application/json" },
        body: JSON.stringify({ email, password: "demo12345" }),
      }),
    );
    return (res.headers.get("set-cookie") ?? "").split(";")[0];
  };
  managerCookie = await cookieOf("ivan@searoute.test");
  directorCookie = await cookieOf("director@searoute.test");
});

const call = (name: string, query = "", cookie?: string, param?: string) =>
  routes[name](new Request(`http://${HOST}/api/analytics/${name}${query}`, { headers: cookie ? { host: HOST, cookie } : { host: HOST } }), param ? { params: Promise.resolve({ kind: param, metric: param }) } : undefined);

describe("API аналитики: только для руководителя", () => {
  it("без входа: 401", async () => {
    for (const n of ["attention", "profit", "dynamics"]) expect((await call(n)).status, n).toBe(401);
  });

  it("менеджер аналитику не видит: 403", async () => {
    for (const n of ["attention", "profit", "dynamics"]) expect((await call(n, "", managerCookie)).status, n).toBe(403);
  });

  it("руководитель получает данные, в ответе есть время обновления", async () => {
    for (const n of ["attention", "profit", "dynamics"]) {
      const res = await call(n, "", directorCookie);
      expect(res.status, n).toBe(200);
      expect((await res.json()).freshness.refreshedAt, n).toBeTruthy();
    }
  });

  it("параметры проверяются", async () => {
    expect((await call("profit", "?days=3", directorCookie)).status).toBe(422);
    expect((await call("profit", "?groupBy=weather", directorCookie)).status).toBe(422);
    expect((await call("dynamics", "?weeks=0", directorCookie)).status).toBe(422);
    expect((await call("profit", "?days=30&groupBy=direction", directorCookie)).status).toBe(200);
  });
});

describe("API подробностей: только для руководителя", () => {
  const cases: [string, string][] = [
    ["attentionDetail", "receivables"],
    ["attentionDetail", "overrun"],
    ["profitDetail", "margin"],
    ["dynamicsDetail", "rate"],
  ];

  it("без входа 401, менеджеру 403", async () => {
    for (const [name, param] of cases) {
      expect((await call(name, "", undefined, param)).status, name).toBe(401);
      expect((await call(name, "", managerCookie, param)).status, name).toBe(403);
    }
  });

  it("руководитель получает подробности с пояснением и группами", async () => {
    for (const [name, param] of cases) {
      const res = await call(name, "", directorCookie, param);
      expect(res.status, `${name}/${param}`).toBe(200);
      const body = await res.json();
      expect(body.title).toBeTruthy();
      expect(body.lead.length).toBeGreaterThan(40);
      expect(Array.isArray(body.groups)).toBe(true);
    }
  });

  it("неизвестный раздел 404, неверные параметры 422", async () => {
    expect((await call("attentionDetail", "", directorCookie, "unknown")).status).toBe(404);
    expect((await call("profitDetail", "", directorCookie, "unknown")).status).toBe(404);
    expect((await call("dynamicsDetail", "", directorCookie, "unknown")).status).toBe(404);
    expect((await call("profitDetail", "?days=2", directorCookie, "margin")).status).toBe(422);
    expect((await call("dynamicsDetail", "?weeks=99", directorCookie, "rate")).status).toBe(422);
  });
});
