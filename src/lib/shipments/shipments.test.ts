import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { AuthUser } from "@/lib/auth/authorize";

process.env.DATABASE_PATH = ":memory:";

const HOST = "app.test";
const PASSWORD = "demo12345";
const T0 = new Date("2026-10-20T09:00:00Z");
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let db: Database.Database;
let svc: typeof import("./service");
let schemas: typeof import("./schemas");
let recalc: typeof import("@/lib/recalc");
let manager: AuthUser;
let ids: { client: number; direction: number; carrier: number; terminal: number };

beforeAll(async () => {
  db = (await import("@/db")).getDb();
  (await import("@/db/seed")).seed(db);
  svc = await import("./service");
  schemas = await import("./schemas");
  recalc = await import("@/lib/recalc");
  manager = db.prepare("SELECT id, email, name, role FROM users WHERE email = 'ivan@searoute.test'").get() as AuthUser;
  ids = {
    client: (db.prepare("SELECT id FROM clients LIMIT 1").get() as { id: number }).id,
    direction: (db.prepare("SELECT id FROM directions LIMIT 1").get() as { id: number }).id,
    carrier: (db.prepare("SELECT id FROM counterparties WHERE type = 'carrier' LIMIT 1").get() as { id: number }).id,
    terminal: (db.prepare("SELECT id FROM counterparties WHERE type = 'terminal' LIMIT 1").get() as { id: number }).id,
  };
});

const changesOf = (shipmentId: number) =>
  db.prepare("SELECT field, old_value, new_value, changed_by FROM change_log WHERE shipment_id = ? ORDER BY id").all(shipmentId) as {
    field: string; old_value: string | null; new_value: string | null; changed_by: number;
  }[];

/** Проверяет, что вызов бросает ApiError с нужным кодом и (необязательно) полем/кодом в деталях. */
function expectError(fn: () => unknown, status: number, detail?: string) {
  try {
    fn();
  } catch (e) {
    const err = e as { status?: number; message?: string; details?: unknown };
    expect(err.status, `ожидался код ${status}, получено: ${err.message}`).toBe(status);
    if (detail) expect(JSON.stringify(err.details)).toContain(detail);
    return;
  }
  throw new Error(`ожидалась ошибка ${status}, но вызов прошёл`);
}

/** Перевозка в статусе «Прибыла» с контейнером: основа для сценариев с деньгами. */
function arrivedShipment() {
  const s = svc.createShipment(db, manager, {
    clientId: ids.client, directionId: ids.direction, cargoDescription: "Мебель",
    status: "arrived", plannedDeparture: "2026-09-01", actualDeparture: "2026-09-01",
    plannedArrival: "2026-10-08", actualArrival: "2026-10-10",
  }, T0);
  svc.addContainer(db, manager, s.id, { number: "MSKU1234567", type: "40" }, T0);
  return s.id;
}

describe("создание и неполные данные", () => {
  it("можно сохранить пустой черновик: номер выдаётся автоматически, ответственный — автор", () => {
    const s = svc.createShipment(db, manager, {}, T0);
    expect(s.number).toMatch(/^SR-\d{4}$/);
    expect(s.status).toBe("draft");
    expect(s.manager?.id).toBe(manager.id);
    expect(s.client).toBeNull();
    expect(s.metrics).toBeNull();
    expect(s.analyticsPending).toBe(true);
    expect(changesOf(s.id)[0]).toMatchObject({ field: "Перевозка", new_value: expect.stringContaining(s.number) });
  });

  it("номера идут по порядку без повторов", () => {
    const a = svc.createShipment(db, manager, {}, T0);
    const b = svc.createShipment(db, manager, {}, T0);
    expect(Number(b.number.slice(3))).toBe(Number(a.number.slice(3)) + 1);
  });

  it("черновик дополняется позже: меняется только присланное", () => {
    const s = svc.createShipment(db, manager, { cargoDescription: "Мебель" }, T0);
    const u = svc.updateShipment(db, manager, s.id, { clientId: ids.client, plannedDeparture: "2026-11-01" }, later(5));
    expect(u.cargoDescription).toBe("Мебель");
    expect(u.client?.id).toBe(ids.client);
    expect(u.plannedDeparture).toBe("2026-11-01");
  });

  it("пустая строка в тексте означает «не заполнено»", () => {
    expect(schemas.ShipmentInput.parse({ cargoDescription: "   " }).cargoDescription).toBeNull();
  });

  it("несуществующий клиент, направление или менеджер: 422 с указанием поля", () => {
    expectError(() => svc.createShipment(db, manager, { clientId: 999_999 }, T0), 422, "clientId");
    expectError(() => svc.createShipment(db, manager, { directionId: 999_999 }, T0), 422, "directionId");
    const director = (db.prepare("SELECT id FROM users WHERE role = 'director'").get() as { id: number }).id;
    expectError(() => svc.createShipment(db, manager, { managerId: director }, T0), 422, "managerId");
  });

  it("согласованность дат и статуса", () => {
    expectError(() => svc.createShipment(db, manager, { plannedDeparture: "2026-10-10", plannedArrival: "2026-10-01" }, T0), 422, "plannedArrival");
    expectError(() => svc.createShipment(db, manager, { status: "in_transit" }, T0), 422, "actualDeparture");
    expectError(() => svc.createShipment(db, manager, { status: "arrived", actualDeparture: "2026-10-01" }, T0), 422, "actualArrival");
    expectError(() => svc.createShipment(db, manager, { status: "booked", actualArrival: "2026-10-01" }, T0), 422, "status");
  });

  it("даты проверяются: формат и существование", () => {
    expect(schemas.ShipmentInput.safeParse({ plannedDeparture: "10.10.2026" }).success).toBe(false);
    expect(schemas.ShipmentInput.safeParse({ plannedDeparture: "2026-02-30" }).success).toBe(false);
    expect(schemas.ShipmentInput.safeParse({ plannedDeparture: "2026-02-28" }).success).toBe(true);
  });

  it("статус «Закрыта» через обычную правку поставить нельзя", () => {
    const r = schemas.ShipmentInput.safeParse({ status: "closed" });
    expect(r.success).toBe(false);
  });
});

describe("история изменений", () => {
  it("правка записывается: кто, что, было и стало; обновляется «кто и когда менял последним»", () => {
    const s = svc.createShipment(db, manager, { plannedDeparture: "2026-09-01", plannedArrival: "2026-10-10" }, T0);
    const u = svc.updateShipment(db, manager, s.id, { plannedArrival: "2026-10-15" }, later(30));
    const entry = changesOf(s.id).at(-1)!;
    expect(entry).toEqual({ field: "Плановая дата прибытия", old_value: "2026-10-10", new_value: "2026-10-15", changed_by: manager.id });
    expect(u.updatedAt).toBe("2026-10-20T09:30:00Z");
    expect(u.updatedBy).toBe(manager.name);
  });

  it("имена вместо номеров: клиент, направление, статус", () => {
    const other = svc.createClient(db, { name: "Новый клиент" });
    const s = svc.createShipment(db, manager, { clientId: ids.client }, T0);
    svc.updateShipment(db, manager, s.id, { clientId: other.id, status: "booked" }, later(1));
    const log = changesOf(s.id);
    expect(log.find((l) => l.field === "Клиент")?.new_value).toBe("Новый клиент");
    expect(log.find((l) => l.field === "Статус")).toMatchObject({ old_value: "Черновик", new_value: "Забронирована" });
  });

  it("если значение не изменилось, записи нет и время обновления не сдвигается", () => {
    const s = svc.createShipment(db, manager, { cargoDescription: "Мебель" }, T0);
    const before = changesOf(s.id).length;
    const u = svc.updateShipment(db, manager, s.id, { cargoDescription: "Мебель" }, later(60));
    expect(changesOf(s.id).length).toBe(before);
    expect(u.updatedAt).toBe("2026-10-20T09:00:00Z");
  });
});

describe("доходы и расходы построчно", () => {
  it("расход добавляется с планом, факт появляется позже, это попадает в историю", () => {
    const id = svc.createShipment(db, manager, {}, T0).id;
    const withLine = svc.addLine(db, manager, id, { kind: "expense", description: "Морской фрахт", counterpartyId: ids.carrier, plannedAmount: 6000 }, T0);
    const line = withLine.lines[0];
    expect(line).toMatchObject({ plannedAmount: 6000, actualAmount: null, paymentStatus: "unpaid", paidAmount: 0 });

    const updated = svc.updateLine(db, manager, line.id, { actualAmount: 6200 }, later(10));
    expect(updated.lines[0].actualAmount).toBe(6200);
    const entry = changesOf(id).at(-1)!;
    expect(entry.field).toContain("фактическая сумма");
    expect(entry.old_value).toBeNull();
    expect(entry.new_value).toMatch(/6\D?200/);
  });

  it("«оплачено»: сумма и дата оплаты проставляются сами; возврат в «не оплачено» их обнуляет", () => {
    const id = svc.createShipment(db, manager, {}, T0).id;
    const lineId = svc.addLine(db, manager, id, { kind: "income", description: "Фрахт клиенту", plannedAmount: 10_000, actualAmount: 10_000 }, T0).lines[0].id;
    const paid = svc.updateLine(db, manager, lineId, { paymentStatus: "paid" }, later(5)).lines[0];
    expect(paid).toMatchObject({ paymentStatus: "paid", paidAmount: 10_000, paidAt: "2026-10-20" });
    const back = svc.updateLine(db, manager, lineId, { paymentStatus: "unpaid" }, later(6)).lines[0];
    expect(back).toMatchObject({ paymentStatus: "unpaid", paidAmount: 0, paidAt: null });
  });

  it("частичная оплата: сумма больше нуля и меньше суммы строки", () => {
    const id = svc.createShipment(db, manager, {}, T0).id;
    const lineId = svc.addLine(db, manager, id, { kind: "expense", description: "Терминал", plannedAmount: 1000 }, T0).lines[0].id;
    expectError(() => svc.updateLine(db, manager, lineId, { paymentStatus: "partial", paidAmount: 0 }, T0), 422, "paidAmount");
    expectError(() => svc.updateLine(db, manager, lineId, { paymentStatus: "partial", paidAmount: 1000 }, T0), 422, "paidAmount");
    expect(svc.updateLine(db, manager, lineId, { paymentStatus: "partial", paidAmount: 400 }, T0).lines[0].paidAmount).toBe(400);
  });

  it("тип строки менять нельзя; суммы только целые и не отрицательные", () => {
    const id = svc.createShipment(db, manager, {}, T0).id;
    const lineId = svc.addLine(db, manager, id, { kind: "expense", description: "Терминал", plannedAmount: 1000 }, T0).lines[0].id;
    expectError(() => svc.updateLine(db, manager, lineId, { kind: "income" }, T0), 422, "kind");
    expect(schemas.LineInput.safeParse({ plannedAmount: -5 }).success).toBe(false);
    expect(schemas.LineInput.safeParse({ plannedAmount: 10.5 }).success).toBe(false);
  });

  it("новая строка требует тип и описание; строку можно удалить, это попадает в историю", () => {
    expect(schemas.LineCreate.safeParse({ description: "x" }).success).toBe(false);
    expect(schemas.LineCreate.safeParse({ kind: "income" }).success).toBe(false);
    const id = svc.createShipment(db, manager, {}, T0).id;
    const lineId = svc.addLine(db, manager, id, { kind: "expense", description: "Брокер", plannedAmount: 250 }, T0).lines[0].id;
    expect(svc.deleteLine(db, manager, lineId, later(1)).lines).toHaveLength(0);
    expect(changesOf(id).at(-1)?.new_value).toBe("удалено");
  });

  it("контейнеры: номер проверяется, контейнер можно добавить и удалить", () => {
    expect(schemas.ContainerInput.safeParse({ number: "ABC123" }).success).toBe(false);
    expect(schemas.ContainerInput.parse({ number: "msku1234567" }).number).toBe("MSKU1234567");
    expect(schemas.ContainerInput.parse({ number: "  " }).number).toBeNull();
    const id = svc.createShipment(db, manager, {}, T0).id;
    const withC = svc.addContainer(db, manager, id, { number: "MSKU1234567", type: "40" }, T0);
    expect(withC.containers).toHaveLength(1);
    expect(svc.deleteContainer(db, manager, withC.containers[0].id, later(1)).containers).toHaveLength(0);
  });
});

describe("сценарий из ответа заказчику: 10 000 → 2 800 → 2 300 → окончательно", () => {
  it("правки менеджера попадают в аналитику после пересчёта, закрытие делает результат окончательным", () => {
    const id = arrivedShipment();
    const income = svc.addLine(db, manager, id, { kind: "income", description: "Фрахт клиенту", plannedAmount: 10_000, actualAmount: 10_000, paymentStatus: "paid" }, T0);
    const freight = svc.addLine(db, manager, id, { kind: "expense", description: "Морской фрахт", counterpartyId: ids.carrier, plannedAmount: 6000, actualAmount: 6200 }, T0);
    const terminalLine = svc.addLine(db, manager, id, { kind: "expense", description: "Терминал", counterpartyId: ids.terminal, plannedAmount: 1000 }, T0);
    expect(income.lines).toHaveLength(1);
    expect(freight.lines).toHaveLength(2);
    const terminalId = terminalLine.lines.find((l) => l.description === "Терминал")!.id;

    // 1. Груз прибыл, терминал без факта
    recalc.recalcAll(db, later(10));
    let s = svc.getShipment(db, id);
    expect(s.metrics).toMatchObject({ revenue: 10_000, cost: 7_200, margin: 2_800, isPreliminary: true });
    expect(s.analyticsPending).toBe(false);

    // 2. Менеджер вносит факт по терминалу и внеплановое хранение: аналитика пока старая, это видно
    svc.updateLine(db, manager, terminalId, { actualAmount: 1000 }, later(20));
    svc.addLine(db, manager, id, { kind: "expense", description: "Хранение в порту", plannedAmount: 0, actualAmount: 500, isUnplanned: true }, later(21));
    s = svc.getShipment(db, id);
    expect(s.metrics?.margin).toBe(2_800);
    expect(s.analyticsPending).toBe(true);

    // 3. После пересчёта аналитика видит изменение
    recalc.recalcAll(db, later(30));
    s = svc.getShipment(db, id);
    expect(s.metrics).toMatchObject({ cost: 7_700, margin: 2_300, isPreliminary: true });
    expect(s.analyticsPending).toBe(false);

    // 4. Финансовое закрытие (фрахт и терминал не оплачены, нужно подтверждение)
    expectError(() => svc.closeFinance(db, manager, id, false, later(40)), 409, "unpaid_lines");
    const closed = svc.closeFinance(db, manager, id, true, later(41));
    expect(closed.status).toBe("closed");
    expect(closed.financeClosedAt).toBe("2026-10-20");
    recalc.recalcAll(db, later(50));
    s = svc.getShipment(db, id);
    expect(s.metrics).toMatchObject({ margin: 2_300, isPreliminary: false });
  });
});

describe("финансовое закрытие", () => {
  it("только для прибывших и отменённых перевозок", () => {
    const id = svc.createShipment(db, manager, { status: "booked" }, T0).id;
    expectError(() => svc.closeFinance(db, manager, id, true, T0), 422);
  });

  it("нельзя закрыть, пока по строке нет фактической суммы", () => {
    const id = arrivedShipment();
    svc.addLine(db, manager, id, { kind: "expense", description: "Терминал", plannedAmount: 1000 }, T0);
    expectError(() => svc.closeFinance(db, manager, id, true, T0), 422, "missing_actual");
  });

  it("закрытая перевозка доступна только для чтения, пока её не откроют заново", () => {
    const id = arrivedShipment();
    const lineId = svc.addLine(db, manager, id, { kind: "income", description: "Фрахт", plannedAmount: 100, actualAmount: 100, paymentStatus: "paid" }, T0).lines[0].id;
    svc.closeFinance(db, manager, id, false, later(1));
    expectError(() => svc.updateShipment(db, manager, id, { cargoDescription: "Другое" }, later(2)), 409);
    expectError(() => svc.updateLine(db, manager, lineId, { actualAmount: 120 }, later(2)), 409);
    expectError(() => svc.addLine(db, manager, id, { kind: "expense", description: "Новый счёт", plannedAmount: 5 }, later(2)), 409);
    expectError(() => svc.closeFinance(db, manager, id, false, later(2)), 409);

    const reopened = svc.reopenFinance(db, manager, id, later(3));
    expect(reopened.status).toBe("arrived");
    expect(reopened.financeClosedAt).toBeNull();
    expect(svc.updateLine(db, manager, lineId, { actualAmount: 120 }, later(4)).lines[0].actualAmount).toBe(120);
    const fields = changesOf(id).map((c) => c.field);
    expect(fields).toContain("Финансовое закрытие");
  });

  it("отменённую перевозку можно закрыть финансово, статус остаётся «Отменена»", () => {
    const id = svc.createShipment(db, manager, { status: "cancelled" }, T0).id;
    svc.addLine(db, manager, id, { kind: "expense", description: "Штраф", plannedAmount: 0, actualAmount: 45_000, paymentStatus: "paid" }, T0);
    const closed = svc.closeFinance(db, manager, id, false, later(1));
    expect(closed.status).toBe("cancelled");
    expect(closed.financeClosedAt).toBe("2026-10-20");
  });
});

describe("список перевозок", () => {
  it("фильтры, поиск и постраничный вывод", () => {
    recalc.recalcAll(db, later(60));
    const all = svc.listShipments(db, schemas.ListQuery.parse({}));
    expect(all.total).toBeGreaterThan(58);
    expect(all.items).toHaveLength(50);

    const closed = svc.listShipments(db, schemas.ListQuery.parse({ status: "closed" }));
    expect(closed.items.every((i) => i.status === "closed")).toBe(true);

    const byClient = svc.listShipments(db, schemas.ListQuery.parse({ clientId: String(ids.client) }));
    expect(byClient.items.every((i) => i.client?.id === ids.client)).toBe(true);

    const page2 = svc.listShipments(db, schemas.ListQuery.parse({ limit: "10", offset: "10" }));
    expect(page2.items).toHaveLength(10);
    expect(page2.items[0].id).not.toBe(all.items[0].id);

    const search = svc.listShipments(db, schemas.ListQuery.parse({ q: "SR-0001" }));
    expect(search.items.map((i) => i.number)).toContain("SR-0001");
  });

  it("фильтр «требует внимания» отдаёт только перевозки с причинами", () => {
    const any = svc.listShipments(db, schemas.ListQuery.parse({ attention: "any", limit: "200" }));
    expect(any.total).toBeGreaterThan(0);
    expect(any.items.every((i) => (i.metrics?.attentionReasons.length ?? 0) > 0)).toBe(true);
    const delay = svc.listShipments(db, schemas.ListQuery.parse({ attention: "delay", limit: "200" }));
    expect(delay.items.every((i) => i.metrics?.attentionReasons.some((r) => r.code === "delay"))).toBe(true);
  });

  it("недопустимые параметры отклоняются", () => {
    expect(schemas.ListQuery.safeParse({ limit: "500" }).success).toBe(false);
    expect(schemas.ListQuery.safeParse({ status: "unknown" }).success).toBe(false);
  });

  it("несуществующая перевозка: 404", () => {
    expectError(() => svc.getShipment(db, 999_999), 404);
  });
});

describe("аналитика обновляется с задержкой", () => {
  it("пересчёт при чтении запускается, только если прошло больше заданного срока", () => {
    recalc.recalcAll(db, T0);
    const info1 = recalc.ensureFresh(db, later(3));
    expect(info1.refreshedAt).toBe("2026-10-20T09:00:00.000Z");
    const info2 = recalc.ensureFresh(db, later(6));
    expect(info2.refreshedAt).toBe("2026-10-20T09:06:00.000Z");
  });
});

// ---------- права на уровне API ----------

describe("API: права ролей и проверка данных", () => {
  // Контекст маршрутов разный (с id и без): в тестах передаём его как есть
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Handler = (req: Request, ctx: any) => Promise<Response>;
  const routes: Record<string, Record<string, Handler>> = {};
  let managerCookie = "";
  let directorCookie = "";

  beforeAll(async () => {
    routes.shipments = await import("@/app/api/shipments/route");
    routes.shipment = await import("@/app/api/shipments/[id]/route");
    routes.lines = await import("@/app/api/shipments/[id]/lines/route");
    routes.containers = await import("@/app/api/shipments/[id]/containers/route");
    routes.close = await import("@/app/api/shipments/[id]/close-finance/route");
    routes.reopen = await import("@/app/api/shipments/[id]/reopen-finance/route");
    routes.line = await import("@/app/api/lines/[id]/route");
    routes.container = await import("@/app/api/containers/[id]/route");
    routes.reference = await import("@/app/api/reference/route");
    routes.clients = await import("@/app/api/clients/route");
    routes.refresh = await import("@/app/api/analytics/refresh/route");
    const login = (await import("@/app/api/auth/login/route")).POST;
    const cookieOf = async (email: string) => {
      const res = await login(new Request(`http://${HOST}/api/auth/login`, {
        method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
      }));
      return (res.headers.get("set-cookie") ?? "").split(";")[0];
    };
    managerCookie = await cookieOf("anna@searoute.test");
    directorCookie = await cookieOf("director@searoute.test");
  });

  const call = (h: Handler, method: string, path: string, opts: { cookie?: string; body?: unknown; raw?: string; id?: string } = {}) => {
    const headers: Record<string, string> = { host: HOST, "content-type": "application/json" };
    if (opts.cookie) headers.cookie = opts.cookie;
    const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    return h(new Request(`http://${HOST}${path}`, { method, headers, body }), { params: Promise.resolve({ id: opts.id ?? "1" }) });
  };

  it("без входа любой запрос: 401", async () => {
    expect((await call(routes.shipments.GET, "GET", "/api/shipments")).status).toBe(401);
    expect((await call(routes.shipments.POST, "POST", "/api/shipments", { body: {} })).status).toBe(401);
    expect((await call(routes.shipment.GET, "GET", "/api/shipments/1")).status).toBe(401);
    expect((await call(routes.reference.GET, "GET", "/api/reference")).status).toBe(401);
  });

  it("руководитель может смотреть перевозки, справочники и обновлять аналитику", async () => {
    const list = await call(routes.shipments.GET, "GET", "/api/shipments?limit=5", { cookie: directorCookie });
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.items).toHaveLength(5);
    expect(body.analytics.refreshedAt).toBeTruthy();
    expect((await call(routes.shipment.GET, "GET", "/api/shipments/1", { cookie: directorCookie, id: "1" })).status).toBe(200);
    expect((await call(routes.reference.GET, "GET", "/api/reference", { cookie: directorCookie })).status).toBe(200);
    expect((await call(routes.refresh.POST, "POST", "/api/analytics/refresh", { cookie: directorCookie })).status).toBe(200);
  });

  it("руководитель не может ничего менять: 403 на каждое изменяющее действие, данные не меняются", async () => {
    const before = (db.prepare("SELECT COUNT(*) n FROM shipments").get() as { n: number }).n;
    const attempts: [Handler, string, string, unknown?][] = [
      [routes.shipments.POST, "POST", "/api/shipments", {}],
      [routes.shipment.PATCH, "PATCH", "/api/shipments/1", { cargoDescription: "Взлом" }],
      [routes.lines.POST, "POST", "/api/shipments/1/lines", { kind: "expense", description: "x" }],
      [routes.containers.POST, "POST", "/api/shipments/1/containers", {}],
      [routes.close.POST, "POST", "/api/shipments/1/close-finance", {}],
      [routes.reopen.POST, "POST", "/api/shipments/1/reopen-finance"],
      [routes.line.PATCH, "PATCH", "/api/lines/1", { actualAmount: 1 }],
      [routes.line.DELETE, "DELETE", "/api/lines/1"],
      [routes.container.PATCH, "PATCH", "/api/containers/1", { comment: "x" }],
      [routes.container.DELETE, "DELETE", "/api/containers/1"],
      [routes.clients.POST, "POST", "/api/clients", { name: "Чужой клиент" }],
    ];
    for (const [h, method, path, body] of attempts) {
      const res = await call(h, method, path, { cookie: directorCookie, body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect((db.prepare("SELECT COUNT(*) n FROM shipments").get() as { n: number }).n).toBe(before);
    expect((db.prepare("SELECT cargo_description c FROM shipments WHERE id = 1").get() as { c: string }).c).not.toBe("Взлом");
  });

  it("менеджер создаёт и правит перевозку; изменение записывается от его имени", async () => {
    const created = await call(routes.shipments.POST, "POST", "/api/shipments", { cookie: managerCookie, body: { cargoDescription: "Мебель" } });
    expect(created.status).toBe(201);
    const s = await created.json();
    expect(s.manager.name).toBe("Анна Смирнова");

    const patched = await call(routes.shipment.PATCH, "PATCH", `/api/shipments/${s.id}`, { cookie: managerCookie, id: String(s.id), body: { plannedDeparture: "2026-11-01" } });
    expect(patched.status).toBe(200);
    const detail = await (await call(routes.shipment.GET, "GET", `/api/shipments/${s.id}`, { cookie: directorCookie, id: String(s.id) })).json();
    expect(detail.changes[0]).toMatchObject({ changedBy: "Анна Смирнова", field: "Плановая дата отправления" });
    expect(detail.analyticsPending).toBe(true);
  });

  it("некорректные данные: понятные ошибки 400 и 422", async () => {
    const badJson = await call(routes.shipments.POST, "POST", "/api/shipments", { cookie: managerCookie, raw: "не json" });
    expect(badJson.status).toBe(400);

    const badDate = await call(routes.shipments.POST, "POST", "/api/shipments", { cookie: managerCookie, body: { plannedDeparture: "вчера" } });
    expect(badDate.status).toBe(422);
    expect((await badDate.json()).details[0].field).toBe("plannedDeparture");

    const unknownKey = await call(routes.shipments.POST, "POST", "/api/shipments", { cookie: managerCookie, body: { number: "SR-9999" } });
    expect(unknownKey.status).toBe(422);

    const closedViaPatch = await call(routes.shipment.PATCH, "PATCH", "/api/shipments/1", { cookie: managerCookie, body: { status: "closed" } });
    expect(closedViaPatch.status).toBe(422);
    expect(JSON.stringify(await closedViaPatch.json())).toContain("Закрыть финансово");

    expect((await call(routes.shipments.GET, "GET", "/api/shipments?limit=999", { cookie: managerCookie })).status).toBe(422);
    expect((await call(routes.shipment.GET, "GET", "/api/shipments/abc", { cookie: managerCookie, id: "abc" })).status).toBe(404);
    expect((await call(routes.shipment.GET, "GET", "/api/shipments/999999", { cookie: managerCookie, id: "999999" })).status).toBe(404);
  });

  it("закрытие: пустое тело допустимо, подтверждение неоплаченных передаётся в теле", async () => {
    const created = await (await call(routes.shipments.POST, "POST", "/api/shipments", {
      cookie: managerCookie,
      body: { status: "cancelled" },
    })).json();
    await call(routes.lines.POST, "POST", `/api/shipments/${created.id}/lines`, {
      cookie: managerCookie, id: String(created.id),
      body: { kind: "expense", description: "Штраф", plannedAmount: 0, actualAmount: 45_000 },
    });
    const needConfirm = await call(routes.close.POST, "POST", `/api/shipments/${created.id}/close-finance`, { cookie: managerCookie, id: String(created.id) });
    expect(needConfirm.status).toBe(409);
    const ok = await call(routes.close.POST, "POST", `/api/shipments/${created.id}/close-finance`, { cookie: managerCookie, id: String(created.id), body: { confirmUnpaid: true } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).financeClosedAt).toBeTruthy();
  });
});

describe("два менеджера правят одну перевозку одновременно", () => {
  let anna: AuthUser;
  beforeAll(() => {
    anna = db.prepare("SELECT id, email, name, role FROM users WHERE email = 'anna@searoute.test'").get() as AuthUser;
  });

  const draft = () => svc.createShipment(db, manager, { cargoDescription: "Мебель" }, T0).id;

  it("правка поля, которое уже изменил другой, отклоняется и чужое значение не затирается", () => {
    const id = draft();
    // Иван открыл карточку (груз «Мебель»), Анна успела поменять груз
    svc.updateShipment(db, anna, id, { cargoDescription: "Техника" }, later(1));
    try {
      svc.updateShipment(db, manager, id, { cargoDescription: "Одежда", expect: { cargoDescription: "Мебель" } }, later(2));
      throw new Error("ожидался конфликт");
    } catch (e) {
      const err = e as { status?: number; details?: { code?: string; fields?: string[] }; message: string };
      expect(err.status).toBe(409);
      expect(err.details).toMatchObject({ code: "conflict", fields: ["cargoDescription"] });
      expect(err.message).toContain("Анна");
    }
    expect(svc.getShipment(db, id).cargoDescription).toBe("Техника");
  });

  it("правка другого поля проходит, чужая правка остаётся; а если чужое значение совпало с вводимым, конфликта нет", () => {
    const id = draft();
    svc.updateShipment(db, anna, id, { cargoDescription: "Техника" }, later(1));
    // Иван меняет только статус: груз у него в запросе нет, значит и чужой груз не трогается
    svc.updateShipment(db, manager, id, { status: "booked", expect: { status: "draft" } }, later(2));
    const s = svc.getShipment(db, id);
    expect(s.status).toBe("booked");
    expect(s.cargoDescription).toBe("Техника");
    // Иван вводит то же значение, что уже поставила Анна: это не конфликт
    expect(() => svc.updateShipment(db, manager, id, { cargoDescription: "Техника", expect: { cargoDescription: "Мебель" } }, later(3))).not.toThrow();
  });

  it("строка: изменение суммы не затирает оплату, которую успел отметить другой; а смена оплаты поверх чужой отклоняется", () => {
    const id = draft();
    const line = svc.addLine(db, manager, id, { kind: "income", description: "Счёт", plannedAmount: 100_000, actualAmount: 100_000 }, T0).lines[0];
    // Анна отметила счёт оплаченным
    svc.updateLine(db, anna, line.id, { paymentStatus: "paid", paidAmount: 100_000, paidAt: "2026-10-20" }, later(1));
    // Иван открывал строку до этого и правит только плановую сумму
    svc.updateLine(db, manager, line.id, { plannedAmount: 110_000, expect: { plannedAmount: 100_000 } }, later(2));
    const after = svc.getShipment(db, id).lines[0];
    expect(after.plannedAmount).toBe(110_000);
    expect(after.paymentStatus).toBe("paid");
    // Иван пытается сменить статус оплаты по устаревшей карточке (он видел «не оплачено»)
    try {
      svc.updateLine(db, manager, line.id, { paymentStatus: "partial", paidAmount: 40_000, expect: { paymentStatus: "unpaid", paidAmount: 0 } }, later(4));
      throw new Error("ожидался конфликт");
    } catch (e) {
      expect((e as { status?: number }).status).toBe(409);
    }
    expect(svc.getShipment(db, id).lines[0].paymentStatus).toBe("paid");
  });

  it("без expect поведение прежнее (программный вызов API): правка применяется", () => {
    const id = draft();
    svc.updateShipment(db, anna, id, { cargoDescription: "Техника" }, later(1));
    svc.updateShipment(db, manager, id, { cargoDescription: "Одежда" }, later(2));
    expect(svc.getShipment(db, id).cargoDescription).toBe("Одежда");
  });
});
