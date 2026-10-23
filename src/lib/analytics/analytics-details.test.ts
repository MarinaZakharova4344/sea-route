import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

process.env.DATABASE_PATH = ":memory:";
process.env.SEED_TODAY = "2026-10-20";

const TODAY = "2026-10-20";
const NOW = new Date(`${TODAY}T14:05:00Z`);

let applySchema: typeof import("@/db").applySchema;
let openDb: typeof import("@/db").openDb;
let recalcAll: typeof import("@/lib/calc/recalc").recalcAll;
let an: typeof import("./analytics");
let dt: typeof import("./analytics-details");
let fmt: typeof import("../format");
let db: Database.Database;

beforeAll(async () => {
  ({ applySchema, openDb } = await import("@/db"));
  ({ recalcAll } = await import("@/lib/calc/recalc"));
  an = await import("./analytics");
  dt = await import("./analytics-details");
  fmt = await import("../format");
  db = openDb(":memory:");
  applySchema(db);
  (await import("@/db/seed")).seed(db);
  recalcAll(db, NOW);
});

const itemsOf = (p: { groups: { items: unknown[] }[] }) => p.groups.reduce((s, g) => s + g.items.length, 0);

describe("подробности «Сегодня»", () => {
  it("«Клиенты не заплатили в срок»: сумма и число счетов совпадают с плиткой на экране", () => {
    const a = an.getAttention(db, TODAY);
    const d = dt.getAttentionDetail(db, "receivables", TODAY);
    expect(d.summary[0].value).toBe(fmt.formatMoney(a.receivables.amount));
    expect(d.summary[1].value).toBe(String(a.receivables.count));
    expect(itemsOf(d)).toBe(a.receivables.count);
    expect(d.lead.length).toBeGreaterThan(40);
    expect(d.groups.every((g) => g.items.every((i) => i.href?.startsWith("/director/shipments/")))).toBe(true);
  });

  it("клиенты в списке идут от самого большого долга; внутри клиента перечислены счета с датами", () => {
    const d = dt.getAttentionDetail(db, "receivables", TODAY);
    const totals = d.groups.map((g) => Number((g.totalText ?? "").replace(/[^\d]/g, "")));
    expect(totals).toEqual([...totals].sort((x, y) => y - x));
    expect(d.groups[0].items[0].sub).toMatch(/Срок оплаты: \d\d\.\d\d\.\d{4}/);
  });

  it("«Мы не заплатили подрядчикам»: совпадает с плиткой", () => {
    const a = an.getAttention(db, TODAY);
    const d = dt.getAttentionDetail(db, "payables", TODAY);
    expect(d.summary[0].value).toBe(fmt.formatMoney(a.payables.amount));
    expect(itemsOf(d)).toBe(a.payables.count);
  });

  it("«Расходы сверх плана»: сумма совпадает с плиткой, у каждой строки видны план, факт и разница", () => {
    const a = an.getAttention(db, TODAY);
    const d = dt.getAttentionDetail(db, "overrun", TODAY);
    expect(d.summary[0].value).toBe(fmt.formatMoney(a.overrunExtra));
    const first = d.groups[0].items[0];
    expect(first.sub).toMatch(/План: .+\nФакт: /);
    expect(first.valueText.startsWith("+")).toBe(true);
  });

  it("«Просрочена оплата» объединяет счета клиентов и подрядчиков", () => {
    const a = an.getAttention(db, TODAY);
    const d = dt.getAttentionDetail(db, "overdue_payment", TODAY);
    expect(itemsOf(d)).toBe(a.receivables.count + a.payables.count);
    expect(d.groups.some((g) => g.title.startsWith("Клиент: "))).toBe(true);
    expect(d.groups.some((g) => g.title.startsWith("Подрядчик: "))).toBe(true);
  });

  it("причины: число перевозок в подробностях совпадает со счётчиком причины, есть совет «что сделать»", () => {
    const a = an.getAttention(db, TODAY);
    for (const code of ["delay", "stale", "missing_fields"] as const) {
      const d = dt.getAttentionDetail(db, code, TODAY);
      expect(itemsOf(d), code).toBe(a.byReason.find((r) => r.code === code)!.count);
      expect(d.action, code).toBeTruthy();
    }
  });

  it("опоздание: от самых опоздавших, указаны плановая дата и ответственный", () => {
    const d = dt.getAttentionDetail(db, "delay", TODAY);
    const days = d.groups[0].items.map((i) => Number(i.valueText.replace(/\D/g, "")));
    expect(days).toEqual([...days].sort((x, y) => y - x));
    expect(d.groups[0].items[0].sub).toContain("Должна была прибыть:");
    expect(d.groups[0].items[0].note).toContain("Ответственный:");
  });

  it("если блок пуст, возвращается понятный текст, а не ошибка", () => {
    const empty = openDb(":memory:");
    applySchema(empty);
    const d = dt.getAttentionDetail(empty, "receivables", TODAY);
    expect(itemsOf(d)).toBe(0);
    expect(d.empty).toContain("нет");
  });
});

describe("подробности «Доходность»", () => {
  it("маржа, оборот, расходы: цифры совпадают с итогами, есть разбивка по клиентам и направлениям", () => {
    const p = an.getProfit(db, 90, "client", TODAY);
    for (const [metric, value] of [["revenue", p.totals.revenue], ["cost", p.totals.cost], ["margin", p.totals.margin]] as const) {
      const d = dt.getProfitDetail(db, 90, metric, TODAY);
      expect(d.summary[0].value, metric).toBe(fmt.formatMoney(value));
      expect(d.groups.map((g) => g.title), metric).toEqual(["По клиентам", "По направлениям"]);
      expect(d.groups[0].items.length, metric).toBe(p.groups.length);
    }
  });

  it("перевозки, проблемные, окончательные и предварительные: число строк совпадает с итогами", () => {
    const p = an.getProfit(db, 90, "client", TODAY);
    expect(itemsOf(dt.getProfitDetail(db, 90, "shipments", TODAY))).toBe(p.totals.count);
    expect(itemsOf(dt.getProfitDetail(db, 90, "problems", TODAY))).toBe(p.totals.problemCount);
    const fin = itemsOf(dt.getProfitDetail(db, 90, "final", TODAY));
    const pre = itemsOf(dt.getProfitDetail(db, 90, "preliminary", TODAY));
    expect(pre).toBe(p.totals.preliminaryCount);
    expect(fin + pre).toBe(p.totals.count);
  });

  it("проблемные перевозки объяснены: названа причина", () => {
    const d = dt.getProfitDetail(db, 90, "problems", TODAY);
    expect(d.groups[0].items.every((i) => (i.note ?? "").length > 3)).toBe(true);
  });

  it("«в работе»: число перевозок совпадает с экраном, ожидаемая маржа названа отдельно", () => {
    const p = an.getProfit(db, 90, "client", TODAY);
    const d = dt.getProfitDetail(db, 90, "inprogress", TODAY);
    expect(itemsOf(d)).toBe(p.inProgress.count);
    expect(d.summary[1].value).toBe(fmt.formatMoney(p.inProgress.expectedMargin));
  });

  it("у каждого показателя есть пояснение простыми словами", () => {
    for (const m of dt.PROFIT_METRICS) expect(dt.getProfitDetail(db, 90, m, TODAY).lead.length, m).toBeGreaterThan(60);
  });
});

describe("подробности «Динамика» (числа проверяются вручную)", () => {
  // Предыдущая неделя 07–13.10: маржа 100 и 300 (среднее 200). Текущая 14–20.10: 150, 150, 0.
  function small(): Database.Database {
    const d = openDb(":memory:");
    applySchema(d);
    d.prepare("INSERT INTO users (email, name, password_hash, role) VALUES ('m@t', 'Менеджер', 'x', 'manager')").run();
    d.prepare("INSERT INTO clients (id, name) VALUES (1, 'Клиент А'), (2, 'Клиент Б')").run();
    d.prepare("INSERT INTO directions (id, origin, destination) VALUES (1, 'Шанхай', 'Новороссийск')").run();
    const specs: [number, string, number, number][] = [
      [1, "2026-10-08", 1000, 900],
      [2, "2026-10-09", 1000, 700],
      [1, "2026-10-15", 1000, 850],
      [2, "2026-10-16", 1000, 850],
      [2, "2026-10-17", 1000, 1000],
    ];
    specs.forEach(([client, arrived, revenue, cost], i) => {
      const id = Number(
        d
          .prepare(
            `INSERT INTO shipments (number, client_id, direction_id, manager_id, cargo_description, status, planned_departure, actual_departure,
               planned_arrival, actual_arrival, finance_closed_at, updated_at)
             VALUES (?, ?, 1, 1, 'Груз', 'closed', '2026-01-01', '2026-01-01', ?, ?, ?, ?)`,
          )
          .run(`T-${i + 1}`, client, arrived, arrived, arrived, `${arrived}T10:00:00Z`).lastInsertRowid,
      );
      d.prepare("INSERT INTO containers (shipment_id, number, type) VALUES (?, 'MSKU1234567', '40')").run(id);
      for (const [kind, amount] of [["income", revenue], ["expense", cost]] as const) {
        d.prepare("INSERT INTO finance_lines (shipment_id, kind, description, planned_amount, actual_amount, payment_status, paid_amount, due_date) VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)").run(id, kind, kind, amount, amount, amount, arrived);
      }
    });
    recalcAll(d, NOW);
    return d;
  }

  it("«Сейчас» и «Раньше»: показаны именно перевозки периода и их маржа", () => {
    const d = small();
    const cur = dt.getDynamicsDetail(d, 1, "current", TODAY);
    const prev = dt.getDynamicsDetail(d, 1, "previous", TODAY);
    expect(itemsOf(cur)).toBe(3);
    expect(itemsOf(prev)).toBe(2);
    expect(cur.summary[0].value).toBe(fmt.formatMoney(300));
    expect(prev.summary[0].value).toBe(fmt.formatMoney(400));
  });

  it("число перевозок: вклад +200 (3 − 2 перевозки при средней марже 200), разбит по клиентам, сумма сходится", () => {
    const d = small();
    const v = dt.getDynamicsDetail(d, 1, "volume", TODAY);
    expect(v.summary.find((s) => s.label === "Вклад в изменение")!.value).toBe(`+${fmt.formatMoney(200)}`);
    // только у клиента Б число перевозок изменилось (1 → 2): +200
    expect(v.groups[0].items).toHaveLength(1);
    expect(v.groups[0].items[0].title).toBe("Клиент Б");
    expect(v.groups[0].items[0].valueText).toBe(`+${fmt.formatMoney(200)}`);
  });

  it("маржа с одной перевозки: вклад −300, у каждой перевозки показано влияние, самая тянущая вниз первой", () => {
    const d = small();
    const r = dt.getDynamicsDetail(d, 1, "rate", TODAY);
    expect(r.summary.find((s) => s.label === "Вклад в изменение")!.value).toBe(`−${fmt.formatMoney(300)}`);
    const items = r.groups[0].items;
    expect(items.map((i) => i.title.split(" · ")[0])).toEqual(["T-5", "T-3", "T-4"].sort((a, b) => (a === "T-5" ? -1 : b === "T-5" ? 1 : 0)));
    expect(items[0].valueText).toBe(`−${fmt.formatMoney(200)}`);
    expect(r.action).toBeTruthy();
  });

  it("вклад числа перевозок и вклад маржи с перевозки в сумме дают изменение", () => {
    const d = small();
    const num = (t: string) => Number(t.replace(/[^\d]/g, "")) * (t.includes("−") ? -1 : 1);
    const v = num(dt.getDynamicsDetail(d, 1, "volume", TODAY).summary.at(-1)!.value);
    const r = num(dt.getDynamicsDetail(d, 1, "rate", TODAY).summary.at(-1)!.value);
    const change = an.getDynamics(d, 1, TODAY).delta.margin;
    expect(v + r).toBe(change);
  });
});
