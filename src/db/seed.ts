/**
 * Демонстрационные данные «Морского маршрута».
 *
 * Данные детерминированы (одно и то же зерно генератора) и строятся относительно
 * «сегодняшней» даты, поэтому в любой день демонстрации в них есть опоздания,
 * просроченные оплаты и перевозки, давно не обновлявшиеся менеджером.
 * Дату можно зафиксировать: SEED_TODAY=2026-10-20 npm run db:seed
 *
 * Все компании и люди вымышлены.
 */
import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";
import { applySchema, openDb } from "./index";
import { recalcAll } from "../lib/recalc";

export const DEMO_PASSWORD = "demo12345";

export const DEMO_USERS = [
  { email: "ivan@searoute.test", name: "Иван Петров", role: "manager" },
  { email: "anna@searoute.test", name: "Анна Смирнова", role: "manager" },
  { email: "director@searoute.test", name: "Сергей Волков", role: "director" },
] as const;

// ---------- вспомогательное ----------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261020);
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const chance = (p: number) => rand() < p;
const pick = <T>(arr: readonly T[]): T => arr[int(0, arr.length - 1)];
const roundK = (n: number) => Math.round(n / 1000) * 1000;

function startOfToday(): Date {
  const env = process.env.SEED_TODAY;
  const d = env ? new Date(`${env}T00:00:00Z`) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const TODAY = startOfToday();
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const isoTs = (d: Date, hour = 10) => `${iso(d)}T${String(hour).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}:00Z`;

// ---------- справочники ----------

const DIRECTIONS = [
  { origin: "Шанхай", destination: "Новороссийск", days: 34 },
  { origin: "Нинбо", destination: "Санкт-Петербург", days: 38 },
  { origin: "Пусан", destination: "Владивосток", days: 7 },
  { origin: "Стамбул", destination: "Новороссийск", days: 6 },
  { origin: "Гамбург", destination: "Санкт-Петербург", days: 9 },
  { origin: "Шэньчжэнь", destination: "Новороссийск", days: 36 },
] as const;

const COUNTERPARTIES = [
  { name: "Океан Лайн", type: "carrier" },
  { name: "Балтийский Флот", type: "carrier" },
  { name: "ВостокМорТранс", type: "carrier" },
  { name: "Терминал НЗТ", type: "terminal" },
  { name: "ПКТ Питер", type: "terminal" },
  { name: "ВМТП Восток", type: "terminal" },
  { name: "Таможня-Про", type: "broker" },
  { name: "Брокер Юг", type: "broker" },
  { name: "Склад-Сервис", type: "other" },
] as const;

/**
 * Профили клиентов задают «характер» бизнеса:
 *  - revenue: типичный доход с перевозки, ₽;
 *  - costRatio: доля расходов в доходе (чем больше, тем меньше маржа);
 *  - delayP / overrunP / unplannedP / slowPayP: вероятность задержки, перерасхода,
 *    внепланового расхода и медленной оплаты;
 *  - weight: сколько перевозок у клиента (оборот).
 */
const CLIENTS = [
  // «Выглядит лучше, чем работает»: самый большой оборот, но низкая маржа и много проблем.
  { name: "ООО «Рассвет»", manager: 0, revenue: 1_900_000, costRatio: 0.95, delayP: 0.5, overrunP: 0.55, unplannedP: 0.45, slowPayP: 0.6, weight: 12, dirs: [0, 5] },
  // Небольшой, но выгодный и спокойный.
  { name: "ТД «Север»", manager: 0, revenue: 620_000, costRatio: 0.66, delayP: 0.05, overrunP: 0.05, unplannedP: 0.05, slowPayP: 0.1, weight: 6, dirs: [1, 4] },
  // Стабильный крупный.
  { name: "Полярис Групп", manager: 1, revenue: 1_400_000, costRatio: 0.72, delayP: 0.12, overrunP: 0.1, unplannedP: 0.1, slowPayP: 0.15, weight: 9, dirs: [0, 1, 4] },
  { name: "Балтик Трейд", manager: 0, revenue: 880_000, costRatio: 0.78, delayP: 0.2, overrunP: 0.2, unplannedP: 0.15, slowPayP: 0.25, weight: 6, dirs: [1, 4] },
  { name: "Южный Двор", manager: 0, revenue: 760_000, costRatio: 0.74, delayP: 0.15, overrunP: 0.15, unplannedP: 0.1, slowPayP: 0.3, weight: 5, dirs: [3, 5] },
  { name: "Альфа Мебель", manager: 1, revenue: 1_050_000, costRatio: 0.84, delayP: 0.3, overrunP: 0.3, unplannedP: 0.2, slowPayP: 0.35, weight: 5, dirs: [0, 5] },
  { name: "Гранит Строй", manager: 1, revenue: 540_000, costRatio: 0.7, delayP: 0.1, overrunP: 0.1, unplannedP: 0.05, slowPayP: 0.2, weight: 3, dirs: [2] },
  { name: "Космос Электро", manager: 1, revenue: 690_000, costRatio: 0.76, delayP: 0.18, overrunP: 0.12, unplannedP: 0.1, slowPayP: 0.15, weight: 3, dirs: [2, 0] },
  // Новый клиент: пока в основном черновики и неполные данные.
  { name: "Зелёный Рынок", manager: 1, revenue: 450_000, costRatio: 0.75, delayP: 0.1, overrunP: 0.1, unplannedP: 0.1, slowPayP: 0.1, weight: 1, dirs: [3] },
] as const;

const CARGO = ["Бытовая техника", "Мебель", "Строительные материалы", "Электроника", "Одежда и обувь", "Автозапчасти", "Продукты питания", "Игрушки", "Оборудование"];

// ---------- генерация ----------

type Line = {
  kind: "income" | "expense";
  counterpartyId: number | null;
  clientId: number | null;
  description: string;
  planned: number;
  actual: number | null;
  unplanned?: boolean;
  status: "unpaid" | "partial" | "paid";
  paid: number;
  due: string | null;
  paidAt: string | null;
};

type Ship = {
  clientIdx: number | null;
  dirIdx: number | null;
  managerIdx: number | null;
  cargo: string | null;
  status: "draft" | "booked" | "in_transit" | "arrived" | "closed" | "cancelled";
  plannedDep: Date | null;
  actualDep: Date | null;
  plannedArr: Date | null;
  actualArr: Date | null;
  financeClosed: Date | null;
  updatedAt: Date;
  containers: { number: string | null; type: "20" | "40" | "40HC" | null }[];
  lines: Line[];
  changes: { field: string; oldValue: string; newValue: string; at: Date }[];
};

function containerNumber(): string {
  return `${pick(["MSKU", "TGHU", "CMAU", "HLXU", "OOLU"])}${int(1_000_000, 9_999_999)}`;
}

function weightedClient(): number {
  const total = CLIENTS.reduce((s, c) => s + c.weight, 0);
  let r = rand() * total;
  for (let i = 0; i < CLIENTS.length; i++) {
    r -= CLIENTS[i].weight;
    if (r <= 0) return i;
  }
  return 0;
}

function buildLines(
  s: Ship,
  p: (typeof CLIENTS)[number],
  ids: { clients: number[]; counterparties: Record<string, number[]> },
  dir: (typeof DIRECTIONS)[number],
): void {
  const revenue = roundK(p.revenue * between(0.75, 1.25));
  const cost = revenue * (p.costRatio + between(-0.04, 0.04));
  const carrier = pick(ids.counterparties.carrier);
  const terminal = pick(ids.counterparties.terminal);
  const broker = pick(ids.counterparties.broker);
  const clientId = ids.clients[CLIENTS.indexOf(p)];

  const delivered = s.status === "arrived" || s.status === "closed";
  const closed = s.status === "closed";
  const arr = s.actualArr;

  // Доход
  const incomePaidDelay = chance(p.slowPayP) ? int(28, 55) : int(3, 16);
  const incomeDue = arr ? iso(addDays(arr, 14)) : null;
  const incomePaidAt = arr ? addDays(arr, incomePaidDelay) : null;
  const incomePaid = delivered && incomePaidAt !== null && incomePaidAt <= TODAY;
  s.lines.push({
    kind: "income",
    counterpartyId: null,
    clientId,
    description: "Морская перевозка (счёт клиенту)",
    planned: revenue,
    actual: delivered ? revenue : null,
    status: incomePaid ? "paid" : "unpaid",
    paid: incomePaid ? revenue : 0,
    due: incomeDue,
    paidAt: incomePaid && incomePaidAt ? iso(incomePaidAt) : null,
  });
  if (chance(0.3)) {
    const extra = roundK(revenue * 0.04);
    s.lines.push({
      kind: "income", counterpartyId: null, clientId,
      description: "Доставка до склада клиента",
      planned: extra, actual: delivered ? extra : null,
      status: incomePaid ? "paid" : "unpaid", paid: incomePaid ? extra : 0,
      due: incomeDue, paidAt: incomePaid && incomePaidAt ? iso(incomePaidAt) : null,
    });
  }

  // Расходы
  const parts = [
    { cp: carrier, label: "Морской фрахт", share: 0.78, overrun: true },
    { cp: terminal, label: "Терминальная обработка", share: 0.14, overrun: false },
    { cp: broker, label: "Таможенное оформление", share: 0.08, overrun: false },
  ];
  const overrun = chance(p.overrunP);
  for (const part of parts) {
    const planned = roundK(cost * part.share);
    let actual = planned;
    if (part.overrun && overrun) actual = roundK(planned * between(1.12, 1.3));
    else actual = roundK(planned * between(0.97, 1.04));

    // Когда известен факт по счёту
    let known = false;
    if (closed) known = true;
    else if (s.status === "arrived") known = part.cp === carrier || chance(0.4);
    else if (s.status === "in_transit") known = part.cp === carrier && chance(0.5);

    const payDelay = int(8, 20);
    const dueDate = arr ? addDays(arr, 20) : null;
    const paidAt = arr ? addDays(arr, payDelay) : null;
    const paid = known && closed && paidAt !== null && paidAt <= TODAY;
    s.lines.push({
      kind: "expense", counterpartyId: part.cp, clientId: null,
      description: part.label, planned, actual: known ? actual : null,
      status: paid ? "paid" : "unpaid", paid: paid ? actual : 0,
      due: dueDate ? iso(dueDate) : null, paidAt: paid && paidAt ? iso(paidAt) : null,
    });
  }

  // Внеплановый расход (хранение, переоформление): только когда груз уже в порту
  if (delivered && chance(p.unplannedP)) {
    const amount = roundK(between(20_000, 85_000));
    const known = closed || chance(0.5);
    const paidAt = arr ? addDays(arr, int(12, 22)) : null;
    const paid = known && closed && paidAt !== null && paidAt <= TODAY;
    s.lines.push({
      kind: "expense", counterpartyId: ids.counterparties.other[0], clientId: null,
      description: "Хранение в порту (внеплановое)", planned: 0, actual: known ? amount : null,
      unplanned: true, status: paid ? "paid" : "unpaid", paid: paid ? amount : 0,
      due: arr ? iso(addDays(arr, 20)) : null, paidAt: paid && paidAt ? iso(paidAt) : null,
    });
  }
  void dir;
}

function generateShipments(ids: { clients: number[]; counterparties: Record<string, number[]>; users: number[] }): Ship[] {
  const ships: Ship[] = [];

  // Основной поток: перевозки за последние ~4 месяца
  for (let n = 0; n < 44; n++) {
    const ci = weightedClient();
    const p = CLIENTS[ci];
    const di = pick(p.dirs);
    const dir = DIRECTIONS[di];
    const depOffset = -int(2, 118);
    const plannedDep = addDays(TODAY, depOffset);
    const plannedArr = addDays(plannedDep, dir.days + int(-2, 2));

    const delayed = chance(p.delayP);
    const delay = delayed ? int(3, 11) : chance(0.3) ? int(1, 2) : 0;
    const actualDep = plannedDep;
    const arrivalIfDone = addDays(plannedArr, delay);

    const s: Ship = {
      clientIdx: ci, dirIdx: di, managerIdx: p.manager, cargo: pick(CARGO),
      status: "in_transit", plannedDep, actualDep, plannedArr,
      actualArr: null, financeClosed: null, updatedAt: addDays(TODAY, -int(0, 3)),
      containers: Array.from({ length: int(1, 4) }, () => ({
        number: containerNumber(), type: pick(["20", "40", "40HC"] as const),
      })),
      lines: [], changes: [],
    };

    if (arrivalIfDone <= TODAY) {
      s.actualArr = arrivalIfDone;
      const sinceArrival = Math.round((TODAY.getTime() - arrivalIfDone.getTime()) / 86_400_000);
      // Давно прибывшие — закрыты финансово, свежие — нет (расходы ещё поступают)
      if (sinceArrival >= 16 && !chance(0.12)) {
        s.status = "closed";
        s.financeClosed = addDays(arrivalIfDone, int(8, 14));
        s.updatedAt = s.financeClosed;
      } else {
        s.status = "arrived";
        s.updatedAt = addDays(arrivalIfDone, Math.min(sinceArrival, int(1, 6)));
      }
    }
    buildLines(s, p, ids, dir);
    ships.push(s);
  }

  // --- Сценарии для демонстрации (чтобы руководитель увидел разные состояния) ---

  // 1. Груз прибыл, расходы неполные, внеплановое хранение: «предварительно»
  const prelim = ships.find((s) => s.status === "arrived");
  if (prelim) {
    const lines = prelim.lines;
    const terminal = lines.find((l) => l.description === "Терминальная обработка");
    if (terminal) terminal.actual = null;
    if (!lines.some((l) => l.unplanned)) {
      lines.push({
        kind: "expense", counterpartyId: ids.counterparties.other[0], clientId: null,
        description: "Хранение в порту (внеплановое)", planned: 0, actual: 48_000, unplanned: true,
        status: "unpaid", paid: 0, due: iso(addDays(TODAY, 10)), paidAt: null,
      });
    }
  }

  // 2. Перевозки в пути с задержкой больше порога (плановая дата прошла, груза нет)
  for (let k = 0; k < 3; k++) {
    const p = CLIENTS[k === 0 ? 0 : k === 1 ? 5 : 3];
    const di = p.dirs[0];
    const dir = DIRECTIONS[di];
    const plannedArr = addDays(TODAY, -(k + 3));
    const plannedDep = addDays(plannedArr, -dir.days);
    const s: Ship = {
      clientIdx: CLIENTS.indexOf(p), dirIdx: di, managerIdx: p.manager, cargo: pick(CARGO),
      status: "in_transit", plannedDep, actualDep: plannedDep, plannedArr,
      actualArr: null, financeClosed: null, updatedAt: addDays(TODAY, -1),
      containers: [{ number: containerNumber(), type: "40" }, { number: containerNumber(), type: "40" }],
      lines: [], changes: [{
        field: "Плановая дата прибытия",
        oldValue: iso(addDays(plannedArr, -4)), newValue: iso(plannedArr), at: addDays(TODAY, -2),
      }],
    };
    buildLines(s, p, ids, dir);
    ships.push(s);
  }

  // 3. Перевозки, которые менеджер давно не обновлял (в пути, нет изменений 6-12 дней)
  for (const [k, stale] of [8, 12, 6].entries()) {
    const p = CLIENTS[k === 0 ? 2 : k === 1 ? 6 : 7];
    const di = p.dirs[0];
    const dir = DIRECTIONS[di];
    const plannedDep = addDays(TODAY, -(dir.days - 6 - k));
    const s: Ship = {
      clientIdx: CLIENTS.indexOf(p), dirIdx: di, managerIdx: p.manager, cargo: pick(CARGO),
      status: "in_transit", plannedDep, actualDep: plannedDep, plannedArr: addDays(plannedDep, dir.days),
      actualArr: null, financeClosed: null, updatedAt: addDays(TODAY, -stale),
      containers: [{ number: containerNumber(), type: "40HC" }], lines: [], changes: [],
    };
    // Первая из них ещё и «со спрятанной задержкой»: срок прибытия дважды передвигали, по текущему плану всё в порядке,
    // а к первоначальной дате она уже опаздывает (причина «Срок переносили»).
    if (k === 0) {
      const original = addDays(TODAY, -6);
      s.changes.push(
        { field: "Плановая дата прибытия", oldValue: iso(original), newValue: iso(addDays(TODAY, -1)), at: addDays(TODAY, -11) },
        { field: "Плановая дата прибытия", oldValue: iso(addDays(TODAY, -1)), newValue: iso(s.plannedArr as Date), at: addDays(TODAY, -9) },
      );
    }
    buildLines(s, p, ids, dir);
    ships.push(s);
  }

  // 4. Перевозка с просроченной оплатой клиента (прибыла давно, счёт не оплачен)
  {
    const p = CLIENTS[0];
    const dir = DIRECTIONS[0];
    const arr = addDays(TODAY, -35);
    const plannedDep = addDays(arr, -dir.days);
    const s: Ship = {
      clientIdx: 0, dirIdx: 0, managerIdx: p.manager, cargo: "Бытовая техника",
      status: "arrived", plannedDep, actualDep: plannedDep, plannedArr: arr, actualArr: arr,
      financeClosed: null, updatedAt: addDays(TODAY, -2),
      containers: [{ number: containerNumber(), type: "40" }], lines: [],
      changes: [],
    };
    buildLines(s, p, ids, dir);
    const inc = s.lines.find((l) => l.kind === "income");
    if (inc) { inc.status = "unpaid"; inc.paid = 0; inc.paidAt = null; inc.due = iso(addDays(arr, 14)); }
    ships.push(s);
  }

  // 5. Забронированные, ещё не отправленные
  for (let k = 0; k < 3; k++) {
    const p = CLIENTS[[2, 1, 3][k]];
    const di = p.dirs[0];
    const dir = DIRECTIONS[di];
    const plannedDep = addDays(TODAY, int(3, 16));
    const s: Ship = {
      clientIdx: CLIENTS.indexOf(p), dirIdx: di, managerIdx: p.manager, cargo: pick(CARGO),
      status: "booked", plannedDep, actualDep: null, plannedArr: addDays(plannedDep, dir.days),
      actualArr: null, financeClosed: null, updatedAt: addDays(TODAY, -int(0, 2)),
      containers: k === 2 ? [] : [{ number: null, type: "40" }], lines: [], changes: [],
    };
    buildLines(s, p, ids, dir);
    ships.push(s);
  }

  // 6. Черновики с неполными данными
  ships.push(
    {
      clientIdx: null, dirIdx: null, managerIdx: 1, cargo: null, status: "draft",
      plannedDep: null, actualDep: null, plannedArr: null, actualArr: null, financeClosed: null,
      updatedAt: addDays(TODAY, -1), containers: [], lines: [], changes: [],
    },
    {
      clientIdx: 8, dirIdx: null, managerIdx: 1, cargo: "Продукты питания", status: "draft",
      plannedDep: addDays(TODAY, 20), actualDep: null, plannedArr: null, actualArr: null, financeClosed: null,
      updatedAt: addDays(TODAY, -4), containers: [], lines: [], changes: [],
    },
    {
      clientIdx: 8, dirIdx: 3, managerIdx: 1, cargo: null, status: "draft",
      plannedDep: addDays(TODAY, 12), actualDep: null, plannedArr: addDays(TODAY, 18), actualArr: null, financeClosed: null,
      updatedAt: addDays(TODAY, -2), containers: [{ number: null, type: null }], lines: [], changes: [],
    },
  );

  // 7. Отменённая перевозка с понесёнными расходами (убыток)
  {
    const p = CLIENTS[5];
    const dep = addDays(TODAY, -30);
    ships.push({
      clientIdx: 5, dirIdx: 0, managerIdx: 1, cargo: "Мебель", status: "cancelled",
      plannedDep: dep, actualDep: null, plannedArr: addDays(dep, 34), actualArr: null, financeClosed: null,
      updatedAt: addDays(TODAY, -28), containers: [],
      lines: [{
        kind: "expense", counterpartyId: ids.counterparties.carrier[0], clientId: null,
        description: "Штраф за отмену бронирования", planned: 0, actual: 45_000, unplanned: true,
        status: "paid", paid: 45_000, due: iso(addDays(dep, -5)), paidAt: iso(addDays(dep, -3)),
      }],
      changes: [{ field: "Статус", oldValue: "booked", newValue: "cancelled", at: addDays(TODAY, -28) }],
    });
    void p;
  }

  // Несколько правок «вчера-сегодня» для демонстрации истории изменений
  const recentlyArrived = ships.filter((s) => s.status === "arrived").slice(0, 3);
  for (const s of recentlyArrived) {
    const freight = s.lines.find((l) => l.description === "Морской фрахт");
    if (freight && freight.actual !== null) {
      s.changes.push({
        field: "Факт: Морской фрахт",
        oldValue: String(freight.planned), newValue: String(freight.actual),
        at: addDays(TODAY, -int(0, 2)),
      });
    }
  }

  return ships;
}

// ---------- запись в БД ----------

/**
 * Дата поступления заказа для демо: не в будущем и не в выходные (заказы приходят в рабочие дни), а у самых новых
 * забронированных и черновиков несколько заказов сегодня и вчера, чтобы на графиках были «сегодня» и «вчера».
 * Случайные числа здесь не используются, поэтому остальные демо-данные не меняются.
 */
let freshToday = 0;
let freshYesterday = 0;
function demoCreated(base: Date, status: string, i: number): Date {
  let day = base > TODAY ? addDays(TODAY, -(i % 7)) : base;
  if (status === "booked" || status === "draft") {
    if (freshToday < 2) {
      freshToday++;
      day = TODAY;
    } else if (freshYesterday < 4) {
      freshYesterday++;
      day = addDays(TODAY, -1);
    }
  }
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day = addDays(day, -1);
  return day;
}

export function seed(db: Database.Database): { shipments: number; lines: number } {
  freshToday = 0;
  freshYesterday = 0;
  const run = db.transaction(() => {
    for (const t of ["change_log", "shipment_metrics", "finance_lines", "containers", "shipments", "counterparties", "directions", "clients", "users"]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    db.prepare("UPDATE analytics_refresh SET refreshed_at = NULL").run();

    const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    const insUser = db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)");
    const users = DEMO_USERS.map((u) => Number(insUser.run(u.email, u.name, hash, u.role).lastInsertRowid));

    const insClient = db.prepare("INSERT INTO clients (name, contact_name, contact_phone, contact_email) VALUES (?, ?, ?, ?)");
    const clients = CLIENTS.map((c, i) =>
      Number(insClient.run(c.name, `Контакт ${i + 1}`, `+7 900 000-00-${String(10 + i)}`, `client${i + 1}@example.test`).lastInsertRowid),
    );

    const insCp = db.prepare("INSERT INTO counterparties (name, type) VALUES (?, ?)");
    const counterparties: Record<string, number[]> = { carrier: [], terminal: [], broker: [], other: [] };
    for (const cp of COUNTERPARTIES) counterparties[cp.type].push(Number(insCp.run(cp.name, cp.type).lastInsertRowid));

    const insDir = db.prepare("INSERT INTO directions (origin, destination) VALUES (?, ?)");
    const directions = DIRECTIONS.map((d) => Number(insDir.run(d.origin, d.destination).lastInsertRowid));

    const ships = generateShipments({ clients, counterparties, users });
    // Нумерация по дате отправления, как в жизни
    ships.sort((a, b) => (a.plannedDep?.getTime() ?? Infinity) - (b.plannedDep?.getTime() ?? Infinity));

    const insShip = db.prepare(`INSERT INTO shipments
      (number, client_id, direction_id, manager_id, cargo_description, status,
       planned_departure, actual_departure, planned_arrival, actual_arrival, finance_closed_at,
       created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insCont = db.prepare("INSERT INTO containers (shipment_id, number, type, weight_kg) VALUES (?, ?, ?, ?)");
    const insLine = db.prepare(`INSERT INTO finance_lines
      (shipment_id, kind, counterparty_id, client_id, description, planned_amount, actual_amount, is_unplanned,
       payment_status, paid_amount, due_date, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insChange = db.prepare("INSERT INTO change_log (shipment_id, changed_by, changed_at, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)");

    let lineCount = 0;
    ships.forEach((s, i) => {
      const created = demoCreated(s.plannedDep ? addDays(s.plannedDep, -int(5, 14)) : s.updatedAt, s.status, i);
      const managerId = s.managerIdx === null ? null : users[s.managerIdx];
      const id = Number(insShip.run(
        `SR-${String(i + 1).padStart(4, "0")}`,
        s.clientIdx === null ? null : clients[s.clientIdx],
        s.dirIdx === null ? null : directions[s.dirIdx],
        managerId, s.cargo, s.status,
        s.plannedDep && iso(s.plannedDep), s.actualDep && iso(s.actualDep),
        s.plannedArr && iso(s.plannedArr), s.actualArr && iso(s.actualArr),
        s.financeClosed && iso(s.financeClosed),
        isoTs(created), isoTs(s.updatedAt, 15), managerId,
      ).lastInsertRowid);
      for (const c of s.containers) insCont.run(id, c.number, c.type, c.number ? int(8_000, 26_000) : null);
      for (const l of s.lines) {
        insLine.run(id, l.kind, l.counterpartyId, l.clientId, l.description, l.planned, l.actual,
          l.unplanned ? 1 : 0, l.status, l.paid, l.due, l.paidAt);
        lineCount++;
      }
      for (const ch of s.changes) insChange.run(id, managerId, isoTs(ch.at, 12), ch.field, ch.oldValue, ch.newValue);
    });
    return { shipments: ships.length, lines: lineCount };
  });
  return run();
}

// Запуск как скрипта: npm run db:seed
if (process.argv[1] && /seed\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const db = openDb();
  applySchema(db);
  const r = seed(db);
  recalcAll(db);
  console.log(`Демо-данные загружены: перевозок ${r.shipments}, строк доходов и расходов ${r.lines}.`);
  console.log(`Дата отсчёта: ${iso(TODAY)}. Пароль всех демо-пользователей: ${DEMO_PASSWORD}`);
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
  db.close();
}
