import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Overview } from "./overview";

const TODAY = "2026-10-21"; // среда

let db: Database.Database;
let o: Overview;
let predictOrders: typeof import("./overview").predictOrders;

beforeAll(async () => {
  process.env.SEED_TODAY = TODAY;
  const { openDb, applySchema } = await import("../db");
  const { seed } = await import("../db/seed");
  const { recalcAll } = await import("./recalc");
  const mod = await import("./overview");
  predictOrders = mod.predictOrders;
  db = openDb(":memory:");
  applySchema(db);
  seed(db);
  recalcAll(db, new Date(`${TODAY}T10:00:00Z`));
  o = mod.getOverview(db, TODAY);
});

describe("графики: заказы по дням", () => {
  it("в данных есть заказы сегодня и вчера, а день на графике один на каждую дату без пропусков", () => {
    const today = o.days.find((d) => d.date === TODAY)!;
    const yesterday = o.days.find((d) => d.date === "2026-10-20")!;
    expect(today.count).toBeGreaterThanOrEqual(2);
    expect(yesterday.count).toBeGreaterThanOrEqual(4);
    expect(o.days).toHaveLength(56);
    expect(new Set(o.days.map((d) => d.date)).size).toBe(56);
    expect(o.days.at(-1)!.date).toBe(TODAY);
  });

  it("у каждого дня список заказов согласован с числом (не больше предела) и ведёт к реальным перевозкам", () => {
    for (const d of o.days) {
      expect(d.orders.length).toBe(Math.min(d.count, 40));
      for (const r of d.orders) expect(db.prepare("SELECT 1 FROM shipments WHERE id = ?").get(r.id)).toBeTruthy();
    }
    const total = o.days.reduce((s, d) => s + d.count, 0);
    const inDb = (db.prepare("SELECT COUNT(*) n FROM shipments WHERE substr(created_at,1,10) BETWEEN ? AND ?").get("2026-08-27", TODAY) as { n: number }).n;
    expect(total).toBe(inDb);
  });

  it("заказы приходят в рабочие дни: в выходные в демо-данных их нет", () => {
    expect(o.days.filter((d) => d.weekday === 0 || d.weekday === 6).every((d) => d.count === 0)).toBe(true);
  });
});

describe("графики: прогноз", () => {
  it("семь дней от сегодняшнего, коридор вокруг ожидания, выходные ниже будней", () => {
    expect(o.forecast).toHaveLength(7);
    expect(o.forecast[0].date).toBe(TODAY);
    for (const f of o.forecast) {
      expect(f.low).toBeLessThanOrEqual(f.expected);
      expect(f.expected).toBeLessThanOrEqual(f.high);
      expect(f.low).toBeGreaterThanOrEqual(0);
    }
    const saturday = o.forecast.find((f) => f.weekday === 6)!;
    const thursday = o.forecast.find((f) => f.weekday === 4)!;
    expect(saturday.expected).toBeLessThan(thursday.expected);
  });

  it("точность прогноза проверяется на прошлых 28 днях, показатели конечные", () => {
    expect(o.accuracy.days).toBe(28);
    expect(Number.isFinite(o.accuracy.mae)).toBe(true);
    expect(o.accuracy.rmse).toBeGreaterThanOrEqual(o.accuracy.mae);
    expect(o.accuracy.withinBandPct).toBeGreaterThan(40);
  });

  it("равномерный ряд прогнозируется этим же числом", () => {
    const counts = new Map<string, number>();
    for (let k = 0; k < 60; k++) counts.set(new Date(Date.UTC(2026, 8, 1 + k)).toISOString().slice(0, 10), 4);
    expect(predictOrders(counts, "2026-10-21", "2026-10-20")).toBeCloseTo(4, 5);
  });
});

describe("графики: остальные срезы сходятся с базой", () => {
  it("статусы: сумма равна числу перевозок", () => {
    const total = (db.prepare("SELECT COUNT(*) n FROM shipments").get() as { n: number }).n;
    expect(o.statuses.reduce((s, b) => s + b.count, 0)).toBe(total);
  });

  it("накопление за месяц: не убывает, текущий месяц обрезан по сегодня", () => {
    expect(o.month.current).toHaveLength(21);
    expect(o.month.previous).toHaveLength(30);
    for (const arr of [o.month.current, o.month.previous]) for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThanOrEqual(arr[i - 1]);
  });

  it("опоздания: доли считаются от доставленных, «вовремя» не больше всех", () => {
    const sum = o.delays.buckets.reduce((s, b) => s + b.count, 0);
    expect(sum).toBe(o.delays.total);
    expect(o.delays.onTimePct).not.toBeNull();
    expect(o.delays.onTimePct!).toBeLessThanOrEqual(100);
  });

  it("возраст долгов: итог по просроченным совпадает с плиткой «Клиенты не заплатили в срок»", async () => {
    const { getAttention } = await import("./analytics");
    const a = getAttention(db, TODAY);
    expect(o.aging.totalOverdue).toBe(a.receivables.amount);
  });

  it("клиенты: не больше шести, по убыванию оборота", () => {
    expect(o.clients.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < o.clients.length; i++) expect(o.clients[i - 1].revenue).toBeGreaterThanOrEqual(o.clients[i].revenue);
  });
});

describe("графики: сегодняшний день", () => {
  it("ожидаемый итог сегодняшнего дня не меньше того, что уже пришло", () => {
    const today = o.days.find((d) => d.date === TODAY)!;
    const f = o.forecast[0];
    expect(f.expected).toBeGreaterThanOrEqual(today.count);
    expect(f.low).toBeGreaterThanOrEqual(today.count);
    expect(f.high).toBeGreaterThanOrEqual(f.expected);
  });
});
