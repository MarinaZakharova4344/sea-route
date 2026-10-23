/**
 * Крупный демонстрационный набор для показа графиков: к обычным демо-данным добавляется около тысячи заказов за последние
 * четыре месяца с живой динамикой по дням (в рабочие дни заказов больше, к концу периода поток растёт).
 *
 *   npm run db:seed:large
 *
 * Команда стирает текущие данные так же, как `npm run db:seed`. Вернуть обычный набор: `npm run db:seed`.
 */
import { applySchema, openDb } from "./";
import { seed } from "./seed";
import { recalcAll } from "../lib/calc/recalc";
import { todayIso } from "../lib/dates";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const add = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export function addLargeDemo(db: ReturnType<typeof openDb>, count = 900, today = todayIso()) {
  const r = rng(2026);
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const clients = (db.prepare("SELECT id FROM clients").all() as { id: number }[]).map((x) => x.id);
  const directions = (db.prepare("SELECT id FROM directions").all() as { id: number }[]).map((x) => x.id);
  const counterparties = (db.prepare("SELECT id FROM counterparties").all() as { id: number }[]).map((x) => x.id);
  const managers = (db.prepare("SELECT id FROM users WHERE role = 'manager'").all() as { id: number }[]).map((x) => x.id);
  const first = (db.prepare("SELECT COALESCE(MAX(CAST(substr(number, 4) AS INTEGER)), 0) n FROM shipments").get() as { n: number }).n;

  const insS = db.prepare(
    `INSERT INTO shipments (number, client_id, direction_id, manager_id, cargo_description, status, planned_departure, actual_departure, planned_arrival, actual_arrival, finance_closed_at, created_at, updated_at, updated_by)
     VALUES (@number,@client,@direction,@manager,@cargo,@status,@pd,@ad,@pa,@aa,@fc,@created,@updated,@manager)`,
  );
  const insC = db.prepare("INSERT INTO containers (shipment_id, number, type, weight_kg) VALUES (?,?,?,?)");
  const insL = db.prepare(
    `INSERT INTO finance_lines (shipment_id, kind, counterparty_id, client_id, description, planned_amount, actual_amount, is_unplanned, payment_status, paid_amount, due_date, paid_at)
     VALUES (@sid,@kind,@cp,@client,@desc,@plan,@act,0,@pay,@paid,@due,@paidAt)`,
  );

  db.transaction(() => {
    for (let i = 1; i <= count; i++) {
      // день поступления: чем ближе к сегодняшнему, тем больше заказов; только рабочие дни
      let created: string;
      do created = add(today, -Math.floor(120 * r() ** 1.1));
      while (weekday(created) === 0 || weekday(created) === 6);
      const lead = int(3, 21);
      const pd = add(created, lead);
      const pa = add(pd, int(12, 35));
      const delay = r() < 0.25 ? int(3, 12) : int(-2, 2);
      const departed = add(pd, int(0, 2)) <= today;
      const arrivalDay = add(pa, delay);
      const arrived = departed && arrivalDay <= today;
      const closedDay = add(arrivalDay, int(3, 25));
      let status: string;
      if (r() < 0.05) status = "cancelled";
      else if (pd > today) status = r() < 0.85 ? "booked" : "draft";
      else if (!arrived) status = "in_transit";
      else status = closedDay <= today && r() < 0.9 ? "closed" : "arrived";
      const manager = pick(managers);
      const client = pick(clients);
      const sid = Number(
        insS.run({
          number: "SR-" + String(first + i).padStart(4, "0"),
          client,
          direction: pick(directions),
          manager,
          cargo: pick(["Мебель", "Бытовая техника", "Одежда", "Оборудование", "Автозапчасти", "Электроника"]),
          status,
          pd: status === "draft" ? null : pd,
          ad: status === "in_transit" || status === "arrived" || status === "closed" ? add(pd, int(0, 2)) : null,
          pa: status === "draft" ? null : pa,
          aa: status === "arrived" || status === "closed" ? arrivalDay : null,
          fc: status === "closed" ? closedDay : null,
          created: created + "T0" + int(7, 9) + ":" + String(int(10, 59)) + ":00Z",
          updated: add(today, -int(0, 3)) + "T11:00:00Z",
        }).lastInsertRowid,
      );
      if (status !== "draft") insC.run(sid, "TEST" + String(2_000_000 + first + i), pick(["20", "40", "40HC"]), int(6000, 26000));
      if (status === "draft" && r() < 0.5) continue;
      const revenue = int(300, 3000) * 1000;
      const known = status === "closed" || status === "arrived";
      const closed = status === "closed";
      insL.run({ sid, kind: "income", cp: null, client, desc: "Счёт клиенту", plan: revenue, act: closed || (known && r() < 0.7) ? revenue : null, pay: closed ? (r() < 0.88 ? "paid" : "unpaid") : "unpaid", paid: 0, due: add(pa, 14), paidAt: null });
      for (let k = 0; k < int(2, 4); k++) {
        const plan = int(20, Math.floor(revenue / 2000)) * 1000;
        insL.run({ sid, kind: "expense", cp: pick(counterparties), client: null, desc: "Расход " + (k + 1), plan, act: closed || (known && r() < 0.6) ? Math.round(plan * (0.92 + r() * 0.2)) : null, pay: closed && r() < 0.85 ? "paid" : "unpaid", paid: 0, due: add(pa, int(5, 30)), paidAt: null });
      }
    }
    db.prepare("UPDATE finance_lines SET paid_amount = COALESCE(actual_amount, planned_amount), paid_at = due_date WHERE payment_status = 'paid'").run();
  })();
}

// запуск из командной строки
if (process.argv[1] && /seed-large\.(ts|js)$/.test(process.argv[1])) {
  const db = openDb();
  applySchema(db);
  seed(db);
  addLargeDemo(db);
  recalcAll(db);
  const n = (db.prepare("SELECT COUNT(*) n FROM shipments").get() as { n: number }).n;
  console.log(`Крупный демо-набор загружен: перевозок ${n}. Пароль демо-пользователей: demo12345. Вернуть обычный набор: npm run db:seed`);
}
