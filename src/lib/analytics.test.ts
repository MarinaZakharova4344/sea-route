import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

process.env.DATABASE_PATH = ":memory:";
process.env.SEED_TODAY = "2026-10-20";

const TODAY = "2026-10-20";
const NOW = new Date(`${TODAY}T14:05:00Z`);

let applySchema: typeof import("@/db").applySchema;
let openDb: typeof import("@/db").openDb;
let recalcAll: typeof import("@/lib/recalc").recalcAll;
let an: typeof import("./analytics");

beforeAll(async () => {
  ({ applySchema, openDb } = await import("@/db"));
  ({ recalcAll } = await import("@/lib/recalc"));
  an = await import("./analytics");
});

// ---------- маленькая база с числами, которые можно проверить вручную ----------

interface Spec {
  client: number;
  direction?: number;
  arrived: string;
  revenue: number;
  cost: number;
  /** по умолчанию перевозка закрыта финансово, то есть результат окончательный */
  prelim?: boolean;
  delayDays?: number;
}

function smallDb(specs: Spec[]): Database.Database {
  const db = openDb(":memory:");
  applySchema(db);
  db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES ('m@t', 'Менеджер', 'x', 'manager')").run();
  for (const [i, n] of ["Клиент А", "Клиент Б", "Клиент В"].entries()) db.prepare("INSERT INTO clients (id, name) VALUES (?, ?)").run(i + 1, n);
  db.prepare("INSERT INTO directions (id, origin, destination) VALUES (1, 'Шанхай', 'Новороссийск'), (2, 'Пусан', 'Владивосток')").run();
  specs.forEach((s, i) => {
    const plannedArrival = s.delayDays ? new Date(Date.parse(`${s.arrived}T00:00:00Z`) - s.delayDays * 86_400_000).toISOString().slice(0, 10) : s.arrived;
    const id = Number(
      db
        .prepare(
          `INSERT INTO shipments (number, client_id, direction_id, manager_id, cargo_description, status, planned_departure, actual_departure,
             planned_arrival, actual_arrival, finance_closed_at, updated_at)
           VALUES (?, ?, ?, 1, 'Груз', ?, '2026-01-01', '2026-01-01', ?, ?, ?, ?)`,
        )
        .run(`T-${i + 1}`, s.client, s.direction ?? 1, s.prelim ? "arrived" : "closed", plannedArrival, s.arrived, s.prelim ? null : s.arrived, `${s.arrived}T10:00:00Z`)
        .lastInsertRowid,
    );
    db.prepare("INSERT INTO containers (shipment_id, number, type) VALUES (?, 'MSKU1234567', '40')").run(id);
    const line = (kind: string, amount: number, desc: string) =>
      db
        .prepare("INSERT INTO finance_lines (shipment_id, kind, description, planned_amount, actual_amount, payment_status, paid_amount, due_date) VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)")
        .run(id, kind, desc, amount, amount, amount, s.arrived);
    line("income", s.revenue, "Доход");
    line("expense", s.cost, "Расход");
  });
  recalcAll(db, NOW);
  return db;
}

describe("доходность: числа проверяются вручную", () => {
  const db = () =>
    smallDb([
      { client: 1, arrived: "2026-10-10", revenue: 1000, cost: 900 }, // А: маржа 100
      { client: 1, arrived: "2026-10-12", revenue: 1000, cost: 900 }, // А: маржа 100
      { client: 2, arrived: "2026-10-05", revenue: 500, cost: 200 }, // Б: маржа 300
      { client: 2, arrived: "2026-10-06", revenue: 500, cost: 200 }, // Б: маржа 300
      { client: 3, arrived: "2026-08-01", revenue: 9999, cost: 1 }, // вне периода 30 дней
    ]);

  it("итоги за период: в расчёт попадают только перевозки, доставленные в этом периоде", () => {
    const p = an.getProfit(db(), 30, "client", TODAY);
    expect(p.totals).toMatchObject({ count: 4, revenue: 3000, cost: 2200, margin: 800, marginPct: 26.7 });
    expect(p.from).toBe("2026-09-21");
  });

  it("границы периода: день начала входит, день перед началом нет", () => {
    const d = smallDb([
      { client: 1, arrived: "2026-09-21", revenue: 100, cost: 50 },
      { client: 1, arrived: "2026-09-20", revenue: 100, cost: 50 },
    ]);
    const p = an.getProfit(d, 30, "client", TODAY);
    expect(p.totals.count).toBe(1);
  });

  it("клиенты: оборот, маржа и доля оборота; сумма по клиентам равна итогу", () => {
    const p = an.getProfit(db(), 30, "client", TODAY);
    const a = p.groups.find((g) => g.name === "Клиент А")!;
    const b = p.groups.find((g) => g.name === "Клиент Б")!;
    expect(a).toMatchObject({ count: 2, revenue: 2000, margin: 200, marginPct: 10, revenueShare: 66.7 });
    expect(b).toMatchObject({ count: 2, revenue: 1000, margin: 600, marginPct: 60, revenueShare: 33.3 });
    expect(p.groups.reduce((s, g) => s + g.margin, 0)).toBe(p.totals.margin);
    expect(p.groups.reduce((s, g) => s + g.revenue, 0)).toBe(p.totals.revenue);
    expect(p.groups[0].name).toBe("Клиент А"); // сортировка по обороту
  });

  it("«выглядит лучше, чем работает»: большой оборот при маржевой вдвое ниже средней; «работает хорошо»: маржа выше средней и без проблем", () => {
    const p = an.getProfit(db(), 30, "client", TODAY);
    expect(p.groups.find((g) => g.name === "Клиент А")!.verdict?.kind).toBe("looks_better");
    expect(p.groups.find((g) => g.name === "Клиент Б")!.verdict?.kind).toBe("works_well");
  });

  it("предварительная и окончательная маржа считаются раздельно", () => {
    const d = smallDb([
      { client: 1, arrived: "2026-10-10", revenue: 1000, cost: 900 },
      { client: 1, arrived: "2026-10-11", revenue: 1000, cost: 800, prelim: true },
    ]);
    const p = an.getProfit(d, 30, "client", TODAY);
    expect(p.totals).toMatchObject({ margin: 300, finalMargin: 100, preliminaryMargin: 200, preliminaryCount: 1 });
  });

  it("направления считаются так же, как клиенты", () => {
    const d = smallDb([
      { client: 1, direction: 1, arrived: "2026-10-10", revenue: 1000, cost: 900 },
      { client: 2, direction: 2, arrived: "2026-10-11", revenue: 400, cost: 100 },
    ]);
    const p = an.getProfit(d, 30, "direction", TODAY);
    expect(p.groups.map((g) => [g.name, g.margin])).toEqual([
      ["Шанхай → Новороссийск", 100],
      ["Пусан → Владивосток", 300],
    ]);
  });

  it("раскрытие до перевозок: у клиента видны конкретные перевозки, из которых сложилась цифра", () => {
    const d = db();
    const detail = an.getGroupDetail(d, "client", 1, 30, TODAY);
    expect(detail.name).toBe("Клиент А");
    expect(detail.shipments.map((s) => s.number).sort()).toEqual(["T-1", "T-2"]);
    expect(detail.shipments.reduce((s, x) => s + x.margin, 0)).toBe(detail.group!.margin);
  });
});

describe("динамика: период против предыдущего (пример с проверкой вручную)", () => {
  // Неделя: текущий период 14–20.10, предыдущий 07–13.10.
  // Предыдущий: маржа 100 и 300 → среднее 200, всего 400.
  // Текущий: 150, 150, 0 → всего 300. Изменение −100 = объём (+200) + маржа на перевозку (−300).
  const d = () =>
    smallDb([
      { client: 1, arrived: "2026-10-08", revenue: 1000, cost: 900 },
      { client: 2, arrived: "2026-10-09", revenue: 1000, cost: 700 },
      { client: 1, arrived: "2026-10-15", revenue: 1000, cost: 850 },
      { client: 2, arrived: "2026-10-16", revenue: 1000, cost: 850 },
      { client: 2, arrived: "2026-10-17", revenue: 1000, cost: 1000 },
    ]);

  it("периоды равной длины, итоги и изменение", () => {
    const y = an.getDynamics(d(), 1, TODAY);
    expect(y.current).toEqual({ from: "2026-10-14", to: "2026-10-20" });
    expect(y.previous).toEqual({ from: "2026-10-07", to: "2026-10-13" });
    expect(y.currentTotals).toMatchObject({ count: 3, margin: 300 });
    expect(y.previousTotals).toMatchObject({ count: 2, margin: 400 });
    expect(y.delta).toMatchObject({ margin: -100, count: 1, marginPct: -25 });
  });

  it("изменение раскладывается на объём и маржу на перевозку, сумма сходится", () => {
    const y = an.getDynamics(d(), 1, TODAY);
    expect(y.effects).toMatchObject({ volume: 200, rate: -300, averagePrevious: 200, averageCurrent: 100 });
    expect(y.effects.volume + y.effects.rate).toBe(y.delta.margin);
  });

  it("перевозки, которые объясняют изменение: ниже и выше средней маржи прошлого периода", () => {
    const y = an.getDynamics(d(), 1, TODAY);
    expect(y.dragging.map((c) => [c.number, c.effect])).toEqual([["T-5", -200], ["T-3", -50], ["T-4", -50]].sort((a, b) => (a[1] as number) - (b[1] as number)));
    expect(y.boosting).toEqual([]);
    expect(y.dragging.reduce((s, c) => s + c.effect, 0)).toBe(y.effects.rate);
  });

  it("по клиентам: изменение маржи каждого клиента и разница в числе перевозок", () => {
    const y = an.getDynamics(d(), 1, TODAY);
    const a = y.byClient.find((c) => c.name === "Клиент А")!;
    const b = y.byClient.find((c) => c.name === "Клиент Б")!;
    expect(a).toMatchObject({ previous: 100, current: 150, delta: 50, countDelta: 0 });
    expect(b).toMatchObject({ previous: 300, current: 150, delta: -150, countDelta: 1 });
    expect(y.byClient.reduce((s, c) => s + c.delta, 0)).toBe(y.delta.margin);
  });

  it("недельный ряд: недели подряд, без пропусков, делятся на два периода", () => {
    const y = an.getDynamics(d(), 1, TODAY);
    expect(y.weeklySeries).toHaveLength(2);
    expect(y.weeklySeries.map((w) => [w.period, w.margin, w.count])).toEqual([["previous", 400, 2], ["current", 300, 3]]);
    expect(y.weeklySeries[0].end).toBe("2026-10-13");
    expect(y.weeklySeries[1].start).toBe("2026-10-14");
  });

  it("если в прошлом периоде перевозок не было, процент изменения не считается (нет деления на ноль)", () => {
    const only = smallDb([{ client: 1, arrived: "2026-10-15", revenue: 1000, cost: 900 }]);
    const y = an.getDynamics(only, 1, TODAY);
    expect(y.delta.marginPct).toBeNull();
    expect(y.effects.volume).toBe(0);
    expect(y.effects.rate).toBe(100);
  });
});

describe("на демо-данных", () => {
  let db: Database.Database;
  beforeAll(async () => {
    db = openDb(":memory:");
    applySchema(db);
    (await import("@/db/seed")).seed(db);
    recalcAll(db, NOW);
  });

  it("«Сегодня»: причины посчитаны, перевозки отсортированы по важности, к каждой причине есть действие", () => {
    const a = an.getAttention(db, TODAY);
    expect(a.total).toBeGreaterThan(5);
    expect(a.items).toHaveLength(a.total);
    expect(a.items.map((i) => i.score)).toEqual([...a.items.map((i) => i.score)].sort((x, y) => y - x));
    expect(a.items.every((i) => i.reasons.length > 0 && i.reasons.every((r) => r.action.length > 10))).toBe(true);
    expect(a.byReason.map((r) => r.count)).toEqual([...a.byReason.map((r) => r.count)].sort((x, y) => y - x));
    expect(a.byReason.find((r) => r.code === "delay")!.count).toBeGreaterThanOrEqual(3);
  });

  it("«Сегодня»: просроченные оплаты клиентов совпадают с прямой выборкой по счетам", () => {
    const a = an.getAttention(db, TODAY);
    const direct = db
      .prepare(`SELECT COUNT(*) n, SUM(actual_amount - paid_amount) s FROM finance_lines
                WHERE kind = 'income' AND actual_amount IS NOT NULL AND payment_status <> 'paid' AND due_date < ?`)
      .get(TODAY) as { n: number; s: number };
    expect(a.receivables).toEqual({ count: direct.n, amount: direct.s });
    expect(a.receivables.count).toBeGreaterThan(0);
  });

  it("«Доходность»: клиент с самым большим оборотом отмечен «выглядит лучше, чем работает», спокойный клиент нет", () => {
    const p = an.getProfit(db, 90, "client", TODAY);
    const biggest = p.groups[0];
    expect(biggest.name).toBe("ООО «Рассвет»");
    expect(biggest.verdict?.kind).toBe("looks_better");
    expect(biggest.verdict?.text).toContain("маржа");
    expect(p.groups.find((g) => g.name === "ТД «Север»")!.verdict?.kind).not.toBe("looks_better");
    expect(p.groups.reduce((s, g) => s + g.margin, 0)).toBe(p.totals.margin);
  });

  it("«Динамика»: изменение сходится с разложением на объём и маржу на перевозку", () => {
    for (const weeks of [2, 4, 8]) {
      const y = an.getDynamics(db, weeks, TODAY);
      expect(y.effects.volume + y.effects.rate).toBeCloseTo(y.delta.margin, -1);
      expect(y.weeklySeries).toHaveLength(weeks * 2);
      expect(y.byClient.reduce((s, c) => s + c.delta, 0)).toBe(y.delta.margin);
    }
  });
});
