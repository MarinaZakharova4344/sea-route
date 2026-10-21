/**
 * Нагрузка и сверка на реалистичном объёме: 3000 перевозок за два года (около 13 600 строк доходов и расходов).
 * Проверяет, что цифры руководителя сходятся с независимым пересчётом по сырым данным и что страницы открываются быстро.
 */
import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

process.env.DATABASE_PATH = ":memory:";

const TODAY = "2026-10-21";
const NOW = new Date(`${TODAY}T10:00:00Z`);

// Детерминированный генератор случайных чисел
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const add = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function build(db: Database.Database, N: number) {
  const r = rng(42);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES ('m1@t','М1','manager','x'),('m2@t','М2','manager','x'),('d@t','Р','director','x')").run();
  for (let i = 1; i <= 12; i++) db.prepare("INSERT INTO clients (name) VALUES (?)").run("Клиент " + i);
  for (let i = 1; i <= 10; i++) db.prepare("INSERT INTO directions (origin, destination) VALUES (?, ?)").run("Порт " + i, "Порт Н" + i);
  for (let i = 1; i <= 8; i++) db.prepare("INSERT INTO counterparties (name, type) VALUES (?, 'carrier')").run("Подрядчик " + i);

  const insS = db.prepare(
    `INSERT INTO shipments (number, client_id, direction_id, manager_id, cargo_description, status, planned_departure, actual_departure, planned_arrival, actual_arrival, finance_closed_at, created_at, updated_at)
     VALUES (@number,@client,@direction,@manager,@cargo,@status,@pd,@ad,@pa,@aa,@fc,@created,@updated)`,
  );
  const insC = db.prepare("INSERT INTO containers (shipment_id, number, type, weight_kg) VALUES (?,?,?,?)");
  const insL = db.prepare(
    `INSERT INTO finance_lines (shipment_id, kind, counterparty_id, client_id, description, planned_amount, actual_amount, is_unplanned, payment_status, paid_amount, due_date, paid_at)
     VALUES (@sid,@kind,@cp,@client,@desc,@plan,@act,@unpl,@pay,@paid,@due,@paidAt)`,
  );

  db.transaction(() => {
    for (let i = 1; i <= N; i++) {
      const roll = r();
      const status = roll < 0.03 ? "draft" : roll < 0.11 ? "booked" : roll < 0.23 ? "in_transit" : roll < 0.33 ? "arrived" : roll < 0.93 ? "closed" : "cancelled";
      const dayAgo = status === "booked" ? -int(1, 40) : status === "in_transit" ? int(5, 30) : int(15, 720);
      const pd = add(TODAY, -dayAgo);
      const pa = add(pd, int(10, 40));
      const late = r() < 0.25 ? int(3, 15) : int(-2, 2);
      const hasDep = status !== "draft" && status !== "booked";
      const hasArr = ["arrived", "closed"].includes(status);
      const ad = hasDep ? add(pd, int(-1, 3)) : null;
      const aa = hasArr ? add(pa, late) : null;
      const closed = status === "closed" ? add(aa!, int(2, 30)) : null;
      const sid = Number(
        insS.run({
          number: "SR-" + String(i).padStart(5, "0"),
          client: r() < 0.97 ? int(1, 12) : null,
          direction: r() < 0.97 ? int(1, 10) : null,
          manager: int(1, 2),
          cargo: r() < 0.95 ? "Груз " + i : null,
          status,
          pd: status === "draft" ? null : pd,
          ad,
          pa: status === "draft" ? null : pa,
          aa,
          fc: closed,
          created: add(pd, -10) + "T09:00:00Z",
          updated: (closed ?? aa ?? ad ?? pd) + "T12:00:00Z",
        }).lastInsertRowid,
      );
      if (status !== "draft") insC.run(sid, "MSKU" + String(1000000 + i).slice(0, 7), pick(["20", "40", "40HC"]), int(5000, 28000));
      if (status === "draft" && r() < 0.5) continue;
      const rev = int(300, 3000) * 1000;
      const known = ["closed", "arrived"].includes(status);
      const closedAll = status === "closed";
      insL.run({ sid, kind: "income", cp: null, client: int(1, 12), desc: "Счёт клиенту", plan: rev, act: closedAll || (known && r() < 0.7) ? rev : null, unpl: 0, pay: closedAll ? (r() < 0.9 ? "paid" : "unpaid") : "unpaid", paid: 0, due: add(pa, 14), paidAt: null });
      const n = int(2, 5);
      for (let k = 0; k < n; k++) {
        const plan = int(20, Math.floor(rev / 1000 / 2)) * 1000;
        const act = closedAll || (known && r() < 0.6) ? Math.round(plan * (0.9 + r() * 0.3)) : null;
        insL.run({ sid, kind: "expense", cp: int(1, 8), client: null, desc: "Расход " + k, plan, act, unpl: 0, pay: closedAll && r() < 0.8 ? "paid" : "unpaid", paid: 0, due: add(pa, int(5, 30)), paidAt: null });
      }
      if (known && r() < 0.15) insL.run({ sid, kind: "expense", cp: int(1, 8), client: null, desc: "Хранение", plan: 0, act: int(10, 90) * 1000, unpl: 1, pay: "unpaid", paid: 0, due: add(pa, 10), paidAt: null });
    }
    // у оплаченных строк paid_amount = сумма
    db.prepare("UPDATE finance_lines SET paid_amount = COALESCE(actual_amount, planned_amount), paid_at = due_date WHERE payment_status = 'paid'").run();
  })();
}

describe("реалистичная нагрузка: 3000 перевозок за два года", () => {
  it("цифры аналитики совпадают с независимым пересчётом по сырым строкам, и всё быстро", async () => {
    const dbMod = await import("@/db");
    const db = dbMod.openDb(":memory:");
    dbMod.applySchema(db);
    build(db, 3000);
    const { recalcAll } = await import("./recalc");
    const an = await import("./analytics");
    const det = await import("./analytics-details");

    // Запас в десятки раз больше замеренного (1-70 мс): тест ловит только серьёзную деградацию, а не шум машины.
    const time = <T,>(label: string, fn: () => T): T => {
      const t = Date.now();
      const out = fn();
      expect(Date.now() - t, `${label}: слишком медленно`).toBeLessThan(label.startsWith("recalcAll") ? 3000 : 1000);
      return out;
    };

    time("recalcAll (3000 перевозок)", () => recalcAll(db, NOW));
    const lines = db.prepare("SELECT COUNT(*) n FROM finance_lines").get() as { n: number };
    expect(lines.n).toBeGreaterThan(10_000);

    // 1. маржа каждой перевозки = доходы − расходы, где сумма строки = факт, иначе план
    const bad = db
      .prepare(
        `SELECT m.shipment_id AS id, m.margin AS got,
           COALESCE((SELECT SUM(CASE WHEN f.kind='income' THEN COALESCE(f.actual_amount,f.planned_amount) ELSE -COALESCE(f.actual_amount,f.planned_amount) END) FROM finance_lines f WHERE f.shipment_id = m.shipment_id),0) AS want
         FROM shipment_metrics m`,
      )
      .all() as { id: number; got: number; want: number }[];
    const mism = bad.filter((b) => b.got !== b.want);
    expect(mism.length).toBe(0);

    // 2. итог периода = сумма по клиентам = сумма по направлениям = независимый расчёт по датам доставки
    for (const days of [30, 90, 180]) {
      const p = time(`getProfit ${days} дн.`, () => an.getProfit(db, days, "client", TODAY));
      const d = an.getProfit(db, days, "direction", TODAY);
      const from = add(TODAY, -(days - 1));
      const want = db
        .prepare(
          `SELECT COUNT(*) n, COALESCE(SUM(m.margin),0) margin, COALESCE(SUM(m.revenue),0) rev FROM shipments s JOIN shipment_metrics m ON m.shipment_id=s.id
           WHERE s.status IN ('arrived','closed','cancelled') AND m.result_date BETWEEN ? AND ?`,
        )
        .get(from, TODAY) as { n: number; margin: number; rev: number };
      const sumC = p.groups.reduce((s, g) => s + g.margin, 0);
      const sumD = d.groups.reduce((s, g) => s + g.margin, 0);
      expect(p.totals.count).toBe(want.n);
      expect(p.totals.margin).toBe(want.margin);
      expect(sumC).toBe(want.margin);
      expect(sumD).toBe(want.margin);
      expect(p.totals.finalMargin + p.totals.preliminaryMargin).toBe(p.totals.margin);
    }

    // 3. Динамика: Δ = эффект числа перевозок + эффект маржи с перевозки (до рубля?) при разных периодах и «сегодня»
    let worst = 0;
    for (const w of [2, 4, 8]) {
      for (let off = 0; off < 200; off += 7) {
        const today = add(TODAY, -off);
        const y = an.getDynamics(db, w, today);
        const diff = y.delta.margin - (y.effects.volume + y.effects.rate);
        worst = Math.max(worst, Math.abs(diff));
        const bySum = y.byClient.reduce((s, c) => s + c.delta, 0);
        expect(bySum).toBe(y.delta.margin);
      }
    }
    expect(worst).toBeLessThanOrEqual(1);

    // 4. «Сегодня»
    const a = time("getAttention", () => an.getAttention(db, TODAY));
    // Заголовок «N требуют внимания из M в работе»: в работе только перевозки в работе, закрытые с долгами названы отдельно
    expect(a.total - a.closedWithDebt).toBeLessThanOrEqual(a.activeShipments);
    expect(a.closedWithDebt).toBeGreaterThan(0);

    // 5. подробности по всем разделам
    for (const k of det.ATTENTION_KINDS) time("details " + k, () => det.getAttentionDetail(db, k, TODAY));
    for (const m of det.PROFIT_METRICS) time("profit details " + m, () => det.getProfitDetail(db, 180, m, TODAY));
    for (const k of det.DYNAMICS_KINDS) time("dynamics details " + k, () => det.getDynamicsDetail(db, 8, k, TODAY));

    // 6. список менеджера: страница, поиск, фильтры
    const svc = await import("./shipments/service");
    const { ListQuery } = await import("./shipments/schemas");
    time("list стр.1", () => svc.listShipments(db, ListQuery.parse({ limit: 25 })));
    time("list поиск по грузу", () => svc.listShipments(db, ListQuery.parse({ q: "Груз 1500", limit: 25 })));
    time("list внимание", () => svc.listShipments(db, ListQuery.parse({ attention: "any", limit: 25 })));
    time("list статус+клиент", () => svc.listShipments(db, ListQuery.parse({ status: "closed", clientId: "3", limit: 25 })));
  }, 120_000);
});
