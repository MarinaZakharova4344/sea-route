/**
 * «Месяц ежедневной работы»: тысячи случайных операций менеджеров (в том числе некорректных) и регулярная сверка цифр
 * руководителя с независимым пересчётом по сырым данным. Ловит редкие сочетания, которых не придумать руками.
 */
import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { AuthUser } from "@/lib/auth/authorize";

process.env.DATABASE_PATH = ":memory:";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const START = Date.parse("2026-08-01T09:00:00Z");
const addDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("случайные операции менеджеров", () => {
  it("5000 операций: никаких сбоев, цифры руководителя сходятся с пересчётом по сырым строкам", async () => {
    const { openDb, applySchema } = await import("@/db");
    const svc = await import("./shipments/service");
    const schemas = await import("./shipments/schemas");
    const { recalcAll } = await import("./calc/recalc");
    const an = await import("./analytics/analytics");
    const det = await import("./analytics/analytics-details");
    const { ApiError } = await import("./api");

    const db: Database.Database = openDb(":memory:");
    applySchema(db);
    db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES ('a@t','А','manager','x'),('b@t','Б','manager','x'),('d@t','Р','director','x')").run();
    for (let i = 1; i <= 6; i++) db.prepare("INSERT INTO clients (name) VALUES (?)").run("Клиент " + i);
    for (let i = 1; i <= 4; i++) db.prepare("INSERT INTO directions (origin, destination) VALUES (?, ?)").run("П" + i, "Н" + i);
    for (let i = 1; i <= 4; i++) db.prepare("INSERT INTO counterparties (name, type) VALUES (?, 'carrier')").run("Подрядчик " + i);
    const users = db.prepare("SELECT id, email, name, role FROM users WHERE role = 'manager'").all() as AuthUser[];

    const r = rng(Number(process.env.FUZZ_SEED ?? 7));
    const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    let now = new Date(START);
    let ok = 0;
    let rejected = 0;

    const ids = () => (db.prepare("SELECT id FROM shipments").all() as { id: number }[]).map((x) => x.id);
    const lineIds = () => (db.prepare("SELECT id FROM finance_lines").all() as { id: number }[]).map((x) => x.id);
    const contIds = () => (db.prepare("SELECT id FROM containers").all() as { id: number }[]).map((x) => x.id);
    const date = () => addDay("2026-08-01", int(-5, 90));
    const maybe = <T,>(v: T, p = 0.5) => (r() < p ? v : undefined);

    /** Случайные (иногда заведомо плохие) данные из формы. */
    const noisyDate = () => (r() < 0.08 ? pick(["2026-13-45", "вчера", "", "2026-02-30"]) : date());
    const noisyMoney = () => (r() < 0.08 ? pick([-5, 1.5, 3_000_000_000, "100"]) : int(0, 500) * 1000);

    function randomOp(): () => unknown {
      const user = pick(users);
      const roll = r();
      const sid = ids().length ? pick(ids()) : 0;
      if (roll < 0.1 || sid === 0) {
        const body = { clientId: maybe(int(1, 6)), directionId: maybe(int(1, 4)), cargoDescription: maybe("Груз " + int(1, 99)), status: maybe(pick(["draft", "booked", "in_transit", "arrived", "cancelled"])), plannedDeparture: maybe(noisyDate()), plannedArrival: maybe(noisyDate()), actualDeparture: maybe(noisyDate(), 0.3), actualArrival: maybe(noisyDate(), 0.2) };
        return () => {
          const p = schemas.ShipmentInput.safeParse(body);
          if (!p.success) throw new ApiError(422, "zod");
          return svc.createShipment(db, user, p.data, now);
        };
      }
      if (roll < 0.3) {
        const body = { status: maybe(pick(["booked", "in_transit", "arrived", "cancelled", "draft"]), 0.5), plannedArrival: maybe(noisyDate(), 0.4), actualArrival: maybe(noisyDate(), 0.3), actualDeparture: maybe(noisyDate(), 0.3), cargoDescription: maybe("Новый груз", 0.3), clientId: maybe(int(1, 6), 0.2) };
        return () => {
          const p = schemas.ShipmentInput.safeParse(body);
          if (!p.success) throw new ApiError(422, "zod");
          return svc.updateShipment(db, user, sid, p.data, now);
        };
      }
      if (roll < 0.42) {
        const body = { number: maybe(pick(["MSKU1234567", "abc", "TEST7654321"]), 0.7), type: maybe(pick(["20", "40", "40HC", "99"]), 0.6), weightKg: maybe(int(-5, 30000), 0.5) };
        return () => {
          const p = schemas.ContainerInput.safeParse(body);
          if (!p.success) throw new ApiError(422, "zod");
          return svc.addContainer(db, user, sid, p.data, now);
        };
      }
      if (roll < 0.47 && contIds().length) {
        const cid = pick(contIds());
        return () => svc.deleteContainer(db, user, cid, now);
      }
      if (roll < 0.62) {
        const kind = pick(["income", "expense"] as const);
        const body = { kind, description: maybe(pick(["Фрахт", "Терминал", "Счёт клиенту", ""]), 0.9) ?? "Строка", counterpartyId: kind === "expense" ? maybe(int(1, 4), 0.8) : undefined, plannedAmount: noisyMoney(), actualAmount: maybe(noisyMoney(), 0.4), isUnplanned: kind === "expense" ? r() < 0.1 : false, paymentStatus: pick(["unpaid", "unpaid", "partial", "paid"]), paidAmount: maybe(noisyMoney(), 0.4), dueDate: maybe(noisyDate(), 0.6), paidAt: maybe(noisyDate(), 0.3) };
        return () => {
          const p = schemas.LineCreate.safeParse(body);
          if (!p.success) throw new ApiError(422, "zod");
          return svc.addLine(db, user, sid, p.data, now);
        };
      }
      if (roll < 0.8 && lineIds().length) {
        const lid = pick(lineIds());
        const body = { plannedAmount: maybe(noisyMoney(), 0.4), actualAmount: maybe(noisyMoney(), 0.5), paymentStatus: maybe(pick(["unpaid", "partial", "paid"]), 0.5), paidAmount: maybe(noisyMoney(), 0.3), dueDate: maybe(noisyDate(), 0.3), paidAt: maybe(noisyDate(), 0.2) };
        return () => {
          const p = schemas.LineInput.safeParse(body);
          if (!p.success) throw new ApiError(422, "zod");
          return svc.updateLine(db, user, lid, p.data, now);
        };
      }
      if (roll < 0.85 && lineIds().length) {
        const lid = pick(lineIds());
        return () => svc.deleteLine(db, user, lid, now);
      }
      if (roll < 0.93) return () => svc.closeFinance(db, user, sid, r() < 0.7, now, r() < 0.5);
      return () => svc.reopenFinance(db, user, sid, now);
    }

    function check(label: string) {
      recalcAll(db, now);
      const today = now.toISOString().slice(0, 10);

      // 1. маржа каждой перевозки = доходы − расходы (факт, иначе план)
      const bad = db
        .prepare(
          `SELECT m.shipment_id AS id, m.margin AS got,
             COALESCE((SELECT SUM(CASE WHEN f.kind='income' THEN COALESCE(f.actual_amount,f.planned_amount) ELSE -COALESCE(f.actual_amount,f.planned_amount) END) FROM finance_lines f WHERE f.shipment_id = m.shipment_id),0) AS want
           FROM shipment_metrics m`,
        )
        .all() as { id: number; got: number; want: number }[];
      expect(bad.filter((b) => b.got !== b.want), `${label}: маржа`).toEqual([]);

      // 2. закрытая перевозка: статус «Закрыта» тогда и только тогда, когда есть дата закрытия (кроме отменённых)
      const inconsistent = db.prepare("SELECT id FROM shipments WHERE (status = 'closed') <> (finance_closed_at IS NOT NULL AND status <> 'cancelled')").all();
      expect(inconsistent, `${label}: закрытие`).toEqual([]);

      // 3. окончательной маржа бывает только у закрытых и когда у всех строк есть факт
      const wrongFinal = db
        .prepare(
          `SELECT s.id FROM shipments s JOIN shipment_metrics m ON m.shipment_id = s.id
           WHERE m.is_preliminary = 0 AND s.status NOT IN ('closed', 'cancelled')`,
        )
        .all();
      expect(wrongFinal, `${label}: окончательная маржа у незакрытой`).toEqual([]);

      // 4. деньги: оплачено не больше суммы строки, суммы целые и неотрицательные
      const money = db.prepare("SELECT id FROM finance_lines WHERE paid_amount > COALESCE(actual_amount, planned_amount) OR planned_amount < 0 OR COALESCE(actual_amount, 0) < 0 OR paid_amount < 0").all();
      expect(money, `${label}: суммы`).toEqual([]);
      const paidState = db.prepare("SELECT id FROM finance_lines WHERE (payment_status = 'paid' AND paid_amount <> COALESCE(actual_amount, planned_amount)) OR (payment_status = 'unpaid' AND paid_amount <> 0)").all();
      expect(paidState, `${label}: статус оплаты`).toEqual([]);

      // 5. даты: факт прибытия не раньше факта отправления
      const dates = db.prepare("SELECT id FROM shipments WHERE actual_departure IS NOT NULL AND actual_arrival IS NOT NULL AND actual_arrival < actual_departure").all();
      expect(dates, `${label}: даты`).toEqual([]);

      // 6. аналитика: итоги периода = сумма по клиентам = сумма по направлениям
      for (const days of [30, 90, 180]) {
        const p = an.getProfit(db, days, "client", today);
        const d = an.getProfit(db, days, "direction", today);
        expect(p.groups.reduce((s, g) => s + g.margin, 0), `${label}: по клиентам ${days}`).toBe(p.totals.margin);
        expect(d.groups.reduce((s, g) => s + g.margin, 0), `${label}: по направлениям ${days}`).toBe(p.totals.margin);
        expect(p.totals.finalMargin + p.totals.preliminaryMargin).toBe(p.totals.margin);
      }
      for (const w of [2, 4, 8]) {
        const y = an.getDynamics(db, w, today);
        expect(Math.abs(y.delta.margin - (y.effects.volume + y.effects.rate)), `${label}: динамика ${w}`).toBeLessThanOrEqual(1);
        expect(y.byClient.reduce((s, c) => s + c.delta, 0)).toBe(y.delta.margin);
      }

      // 7. «Сегодня»: заголовок осмыслен, у каждой причины есть страница подробностей
      const a = an.getAttention(db, today);
      expect(a.total - a.closedWithDebt, `${label}: заголовок «Сегодня»`).toBeLessThanOrEqual(a.activeShipments);
      for (const k of det.ATTENTION_KINDS) expect(() => det.getAttentionDetail(db, k, today)).not.toThrow();
      for (const m of det.PROFIT_METRICS) expect(() => det.getProfitDetail(db, 90, m, today)).not.toThrow();
      for (const k of det.DYNAMICS_KINDS) expect(() => det.getDynamicsDetail(db, 4, k, today)).not.toThrow();
    }

    const OPS = 5000;
    for (let i = 1; i <= OPS; i++) {
      now = new Date(now.getTime() + int(1, 40) * 60_000 + (r() < 0.01 ? 86_400_000 : 0)); // время идёт, иногда сутки вперёд
      const op = randomOp();
      try {
        op();
        ok++;
      } catch (e) {
        // ожидаемые отказы бизнес-правил и проверки данных: ApiError; любое другое исключение — ошибка приложения
        if (e instanceof ApiError) rejected++;
        else throw new Error(`операция ${i}: неожиданное исключение: ${(e as Error).stack}`);
      }
      if (i % 500 === 0) check(`после ${i} операций`);
    }
    check("в конце");
    console.log(`успешных операций ${ok}, отклонённых проверкой ${rejected}, перевозок ${ids().length}`);
    expect(ok).toBeGreaterThan(1000);
    expect(rejected).toBeGreaterThan(100); // плохие данные действительно отсекаются
  }, 300_000);
});
