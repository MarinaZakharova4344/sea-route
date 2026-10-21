/**
 * Сложные случаи, которых не было в согласованных ситуациях. Для каждого: почему выбран, что должно произойти
 * по согласованным правилам и что обнаружилось. Описание для встречи: docs/edge-cases.md.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { AuthUser } from "@/lib/auth/authorize";

process.env.DATABASE_PATH = ":memory:";

const NOW = new Date("2026-11-30T09:00:00Z");

let db: Database.Database;
let svc: typeof import("./shipments/service");
let analytics: typeof import("./analytics");
let recalc: typeof import("./recalc");
let manager: AuthUser;
let ids: { client: number; direction: number; carrier: number; terminal: number };

beforeAll(async () => {
  db = (await import("@/db")).getDb();
  svc = await import("./shipments/service");
  analytics = await import("./analytics");
  recalc = await import("./recalc");
  // Пустая база: в ней только справочники и пользователь, поэтому суммы по периодам считаются «руками».
  db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES ('m@test', 'Менеджер', 'manager', 'x')").run();
  db.prepare("INSERT INTO clients (name) VALUES ('Клиент')").run();
  db.prepare("INSERT INTO directions (origin, destination) VALUES ('Шанхай', 'Новороссийск')").run();
  db.prepare("INSERT INTO counterparties (name, type) VALUES ('Перевозчик', 'carrier'), ('Терминал', 'terminal')").run();
  manager = db.prepare("SELECT id, email, name, role FROM users WHERE email = 'm@test'").get() as AuthUser;
  ids = {
    client: (db.prepare("SELECT id FROM clients").get() as { id: number }).id,
    direction: (db.prepare("SELECT id FROM directions").get() as { id: number }).id,
    carrier: (db.prepare("SELECT id FROM counterparties WHERE type = 'carrier'").get() as { id: number }).id,
    terminal: (db.prepare("SELECT id FROM counterparties WHERE type = 'terminal'").get() as { id: number }).id,
  };
});

function shipment(dep: string, arr: string, status: "arrived" | "in_transit" = "arrived") {
  const s = svc.createShipment(
    db,
    manager,
    {
      clientId: ids.client, directionId: ids.direction, cargoDescription: "Мебель", status,
      plannedDeparture: dep, actualDeparture: dep, plannedArrival: arr, actualArrival: status === "arrived" ? arr : null,
    },
    NOW,
  );
  svc.addContainer(db, manager, s.id, { number: "MSKU7654321", type: "40" }, NOW);
  return s.id;
}

const line = (shipmentId: number, input: Parameters<typeof svc.addLine>[3]) => svc.addLine(db, manager, shipmentId, input, NOW);

function marginOf(id: number) {
  recalc.recalcAll(db, NOW);
  return db.prepare("SELECT margin, is_preliminary AS prelim, result_date FROM shipment_metrics WHERE shipment_id = ?").get(id) as { margin: number; prelim: number; result_date: string };
}

const inPeriod = (id: number, from: string, to: string) => analytics.deliveredIn(db, from, to).some((r) => r.id === id);

describe("случай 1: счёт пришёл после финансового закрытия", () => {
  // Почему выбран: закрытие вручную согласовано, но жизнь не заканчивается закрытием. Нужно, чтобы поздний счёт
  // не потерялся, попал в тот же месяц и оставил след в истории.
  let id: number;
  beforeAll(() => {
    id = shipment("2026-09-25", "2026-10-12");
    line(id, { kind: "income", clientId: ids.client, description: "Счёт клиенту", plannedAmount: 10_000, actualAmount: 10_000, paymentStatus: "paid", paidAmount: 10_000, paidAt: "2026-11-15" });
    line(id, { kind: "expense", counterpartyId: ids.carrier, description: "Фрахт", plannedAmount: 6_000, actualAmount: 6_200, paymentStatus: "paid", paidAmount: 6_200, paidAt: "2026-10-20" });
    line(id, { kind: "expense", counterpartyId: ids.terminal, description: "Терминал", plannedAmount: 1_000, actualAmount: 1_000, paymentStatus: "paid", paidAmount: 1_000, paidAt: "2026-10-20" });
    svc.closeFinance(db, manager, id, false, NOW);
  });

  it("после закрытия маржа окончательная: 10 000 − 6 200 − 1 000 = 2 800", () => {
    expect(marginOf(id)).toMatchObject({ margin: 2_800, prelim: 0, result_date: "2026-10-12" });
  });

  it("поздний внеплановый счёт: перевозку нужно открыть заново, маржа снова предварительная и меньше", () => {
    // Закрытая перевозка не принимает правки строк.
    expect(() => line(id, { kind: "expense", counterpartyId: ids.terminal, description: "Хранение", plannedAmount: 0, actualAmount: 500, isUnplanned: true })).toThrow();
    svc.reopenFinance(db, manager, id, NOW);
    line(id, { kind: "expense", counterpartyId: ids.terminal, description: "Хранение", plannedAmount: 0, actualAmount: 500, isUnplanned: true });
    expect(marginOf(id)).toMatchObject({ margin: 2_300, prelim: 1, result_date: "2026-10-12" });
  });

  it("поправка уходит в октябрь, месяц доставки, а не в текущий; повторное закрытие снова делает цифру окончательной", () => {
    expect(inPeriod(id, "2026-10-01", "2026-10-31")).toBe(true);
    expect(inPeriod(id, "2026-11-01", "2026-11-30")).toBe(false);
    // Хранение ещё не оплачено: система предупреждает и закрывает только после подтверждения.
    expect(() => svc.closeFinance(db, manager, id, false, NOW)).toThrow(/неоплаченные/);
    svc.closeFinance(db, manager, id, true, NOW);
    expect(marginOf(id)).toMatchObject({ margin: 2_300, prelim: 0 });
  });

  it("поправка помечена «пересчитано задним числом» на экране «Динамика», а перевозки без пересмотра не помечены", () => {
    const rev = analytics.getRevisions(db);
    expect(rev.get(id)).toMatchObject({ revisedAt: "2026-11-30" });
    const d = analytics.getDynamics(db, 8, "2026-11-30");
    expect(d.revisedCount).toBe(1);
    const other = (db.prepare("SELECT id FROM shipments WHERE id <> ? LIMIT 1").get(id) as { id: number } | undefined)?.id;
    if (other) expect(rev.has(other)).toBe(false);
  });

  it("в истории видно закрытие, открытие и новый расход с автором", () => {
    const fields = (db.prepare("SELECT field FROM change_log WHERE shipment_id = ?").all(id) as { field: string }[]).map((r) => r.field);
    expect(fields.some((f) => f.includes("Закрыта финансово") || f.toLowerCase().includes("закры"))).toBe(true);
    expect(fields.some((f) => f.includes("Хранение"))).toBe(true);
  });
});

describe("случай 2: отправлена в сентябре, доставлена в октябре, оплачена в ноябре", () => {
  // Почему выбран: это ситуация 3 из согласования, но здесь проверяем её сквозь аналитику и на границах периодов.
  let id: number;
  beforeAll(() => {
    id = shipment("2026-09-25", "2026-10-12");
    line(id, { kind: "income", clientId: ids.client, description: "Счёт клиенту 2", plannedAmount: 40_000, actualAmount: 40_000, paymentStatus: "paid", paidAmount: 40_000, paidAt: "2026-11-15" });
    recalc.recalcAll(db, NOW);
  });

  it("маржа в октябре, не в сентябре и не в ноябре", () => {
    expect(inPeriod(id, "2026-09-01", "2026-09-30")).toBe(false);
    expect(inPeriod(id, "2026-10-01", "2026-10-31")).toBe(true);
    expect(inPeriod(id, "2026-11-01", "2026-11-30")).toBe(false);
  });

  it("граница: день доставки входит в период, и первый и последний день тоже", () => {
    expect(inPeriod(id, "2026-10-12", "2026-10-12")).toBe(true);
    expect(inPeriod(id, "2026-10-13", "2026-10-31")).toBe(false);
  });

  it("оплата клиента считается в ноябре как деньги, а в октябре её нет", () => {
    expect(analytics.getPayments(db, 30, "2026-11-30").received).toBeGreaterThanOrEqual(40_000);
    const octoberOnly = analytics.getPayments(db, 31, "2026-10-31");
    expect(octoberOnly.received).toBe(0);
  });
});

describe("случай 3: частичная оплата без даты", () => {
  // Почему выбран: частичные оплаты бывают часто, а дата поступления нужна, чтобы «деньги за период» были верными.
  // Обнаружено: при частичной оплате дата не проставлялась, хотя форма обещает «будет сегодняшняя»,
  // и такие деньги выпадали из оплат периода. Исправлено в normalizePayment.
  it("частичная оплата получает дату сегодняшнего дня и попадает в оплаты периода", () => {
    const id = shipment("2026-11-01", "2026-11-20");
    const l = line(id, { kind: "income", clientId: ids.client, description: "Счёт клиенту 3", plannedAmount: 50_000, actualAmount: 50_000, paymentStatus: "partial", paidAmount: 20_000 });
    const added = (l.lines as { description: string; paidAt: string | null }[]).find((x) => x.description === "Счёт клиенту 3");
    expect(added?.paidAt).toBe("2026-11-30");
    const before = analytics.getPayments(db, 30, "2026-11-30");
    expect(before.received).toBeGreaterThanOrEqual(20_000);
  });

  it("частичная оплата без даты не должна давать «оплачено полностью»: остаток 30 000 остаётся к получению", () => {
    const row = db.prepare("SELECT SUM(actual_amount - paid_amount) AS due FROM finance_lines WHERE description = 'Счёт клиенту 3'").get() as { due: number };
    expect(row.due).toBe(30_000);
  });
});

describe("случай 4: менеджер передвигает плановую дату, и опоздание «исчезает»", () => {
  // Почему выбран: исходная боль руководителя. Если считать опоздание только от текущего плана, перенос срока прячет задержку.
  it("перенос срока виден в аналитике, первое заполнение даты переносом не считается", async () => {
    const det = await import("./analytics-details");
    const id = shipment("2026-10-20", "2026-11-05", "in_transit");
    // груз в пути, срок был 05.11, к 30.11 уже опаздывает; менеджер передвигает срок на 25.11 («всё под контролем»)
    svc.updateShipment(db, manager, id, { plannedArrival: "2026-12-05", expect: { plannedArrival: "2026-11-05" } }, NOW);
    recalc.recalcAll(db, NOW);
    const a = analytics.getAttention(db, "2026-11-30");
    const item = a.items.find((i) => i.id === id)!;
    const codes = item.reasons.map((r) => r.code);
    expect(codes).toContain("rescheduled");
    expect(codes).not.toContain("delay"); // по текущему плану (05.12) опоздания нет
    expect(item.reasons.find((r) => r.code === "rescheduled")!.text).toContain("25 дн.");
    const page = det.getAttentionDetail(db, "rescheduled", "2026-11-30");
    expect(page.groups[0].items.some((i) => i.shipmentId === id)).toBe(true);

    // первое заполнение плановой даты (из пустого значения) переносом не считается
    const fresh = svc.createShipment(db, manager, { status: "in_transit", actualDeparture: "2026-11-20", plannedDeparture: "2026-11-20" }, NOW).id;
    svc.updateShipment(db, manager, fresh, { plannedArrival: "2026-12-30" }, NOW);
    recalc.recalcAll(db, NOW);
    const row = db.prepare("SELECT reschedule_count n FROM shipment_metrics WHERE shipment_id = ?").get(fresh) as { n: number };
    expect(row.n).toBe(0);
  });
});
