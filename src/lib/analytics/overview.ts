/**
 * Данные для экрана «Графики»: заказы по дням (сегодня, вчера, прогноз), накопление за месяц, статусы, опоздания, возраст
 * долгов клиентов, клиенты. Каждая точка графика несёт список перевозок, чтобы по нажатию можно было сразу их увидеть.
 *
 * «Заказ» здесь это перевозка, а «поступил» это дата её создания в системе (в часовом поясе компании).
 */
import type Database from "better-sqlite3";
import { addDaysIso, deliveredIn, directionName, getProfit } from "./analytics";
import { diffDays, todayIso, toDay } from "../dates";
import { loadThresholds } from "../calc/recalc";
import { STATUS_LABELS } from "../shipments/service";

export interface OrderRef {
  id: number;
  number: string;
  client: string | null;
  direction: string | null;
  statusLabel: string;
  /** Подпись справа в списке (сумма долга, дни опоздания и т.п.); для заказов не нужна. */
  note?: string;
}

export interface DayPoint {
  date: string;
  /** 0 — воскресенье … 6 — суббота. */
  weekday: number;
  count: number;
  /** Не больше LIST_CAP заказов этого дня. */
  orders: OrderRef[];
}

export interface ForecastPoint {
  date: string;
  weekday: number;
  expected: number;
  low: number;
  high: number;
}

export interface Bucket {
  key: string;
  label: string;
  count: number;
  /** Сумма (для долгов) или другая величина; 0, если не нужна. */
  amount: number;
  items: OrderRef[];
  tone?: "good" | "warn" | "bad" | "neutral";
  href?: string;
}

export interface Overview {
  today: string;
  days: DayPoint[];
  forecast: ForecastPoint[];
  accuracy: { mae: number; rmse: number; days: number; withinBandPct: number };
  /** Накопленное число заказов по дням месяца: этот и прошлый. */
  month: { label: string; previousLabel: string; current: number[]; previous: number[]; dayOfMonth: number };
  statuses: Bucket[];
  delays: { buckets: Bucket[]; onTimePct: number | null; total: number; thresholdDays: number };
  aging: { buckets: Bucket[]; totalOverdue: number; totalOpen: number };
  clients: { id: number | null; name: string; revenue: number; margin: number; marginPct: number; count: number }[];
}

export const LIST_CAP = 40;
export const HISTORY_DAYS = 56;
const MODEL_DAYS = 130;

const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const isWeekend = (iso: string) => {
  const w = weekdayOf(iso);
  return w === 0 || w === 6;
};

/**
 * Прогноз числа заказов на день: сочетает «такие же дни недели» (среднее за 6 прошлых недель, вес 0,6) и «последние
 * дни того же типа» (будни или выходные, до 10 штук, вес 0,4). Простая и объяснимая модель; точность проверяется на
 * прошлом (см. `accuracy`).
 */
export function predictOrders(counts: Map<string, number>, date: string, lastKnown: string): number {
  const seasonal: number[] = [];
  for (let k = 1; k <= 6; k++) {
    const d = addDaysIso(date, -7 * k);
    if (d <= lastKnown) seasonal.push(counts.get(d) ?? 0);
  }
  const wk = isWeekend(date);
  const recent: number[] = [];
  for (let k = 1; k <= 28 && recent.length < 10; k++) {
    const d = addDaysIso(lastKnown, -(k - 1));
    if (isWeekend(d) === wk) recent.push(counts.get(d) ?? 0);
  }
  if (seasonal.length === 0) return mean(recent);
  return 0.6 * mean(seasonal) + 0.4 * mean(recent);
}

interface ShipRow {
  id: number;
  number: string;
  status: string;
  created_at: string;
  client: string | null;
  origin: string | null;
  destination: string | null;
}

const ref = (r: { id: number; number: string; client: string | null; origin: string | null; destination: string | null; status: string }, note?: string): OrderRef => ({
  id: r.id,
  number: r.number,
  client: r.client,
  direction: directionName(r),
  statusLabel: STATUS_LABELS[r.status] ?? r.status,
  note,
});

export function getOverview(db: Database.Database, today: string = todayIso()): Overview {
  // ---- заказы по дням
  const from = addDaysIso(today, -(MODEL_DAYS - 1));
  const rows = db
    .prepare(
      `SELECT s.id, s.number, s.status, s.created_at, c.name AS client, d.origin, d.destination
       FROM shipments s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN directions d ON d.id = s.direction_id
       WHERE substr(s.created_at, 1, 10) >= ? ORDER BY s.created_at DESC`,
    )
    .all(addDaysIso(from, -1)) as ShipRow[];

  const counts = new Map<string, number>();
  const listsByDay = new Map<string, OrderRef[]>();
  for (const r of rows) {
    const day = toDay(r.created_at);
    if (day < from || day > today) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
    const list = listsByDay.get(day) ?? [];
    if (list.length < LIST_CAP) list.push(ref(r));
    listsByDay.set(day, list);
  }

  const days: DayPoint[] = [];
  for (let k = HISTORY_DAYS - 1; k >= 0; k--) {
    const date = addDaysIso(today, -k);
    days.push({ date, weekday: weekdayOf(date), count: counts.get(date) ?? 0, orders: listsByDay.get(date) ?? [] });
  }

  // ---- проверка прогноза на прошлом: 28 полных дней, каждый предсказываем по данным до него
  const yesterday = addDaysIso(today, -1);
  const residuals: number[] = [];
  for (let k = 28; k >= 1; k--) {
    const d = addDaysIso(today, -k);
    residuals.push((counts.get(d) ?? 0) - predictOrders(counts, d, addDaysIso(d, -1)));
  }
  const mae = mean(residuals.map(Math.abs));
  const rmse = Math.sqrt(mean(residuals.map((r) => r * r)));
  const within = residuals.filter((r) => Math.abs(r) <= rmse).length / residuals.length;

  const forecast: ForecastPoint[] = [];
  for (let k = 0; k <= 6; k++) {
    const date = addDaysIso(today, k);
    const e = predictOrders(counts, date, yesterday);
    // Сегодняшний день уже идёт: за день заказов не может стать меньше, чем уже пришло.
    const sofar = date === today ? (counts.get(today) ?? 0) : 0;
    forecast.push({
      date,
      weekday: weekdayOf(date),
      expected: round1(Math.max(e, sofar)),
      low: Math.max(sofar, round1(Math.max(0, e - rmse))),
      high: Math.max(sofar, round1(e + rmse)),
    });
  }

  // ---- накопление за месяц
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthLast = addDaysIso(monthStart, -1);
  const prevMonthStart = `${prevMonthLast.slice(0, 7)}-01`;
  const dayOfMonth = Number(today.slice(8, 10));
  const cumulative = (start: string, len: number) => {
    let sum = 0;
    return Array.from({ length: len }, (_, i) => (sum += counts.get(addDaysIso(start, i)) ?? 0));
  };
  const prevLen = Number(prevMonthLast.slice(8, 10));
  const month = {
    label: monthName(today),
    previousLabel: monthName(prevMonthLast),
    current: cumulative(monthStart, dayOfMonth),
    previous: cumulative(prevMonthStart, prevLen),
    dayOfMonth,
  };

  // ---- статусы
  const statusOrder = ["draft", "booked", "in_transit", "arrived", "closed", "cancelled"];
  const tones: Record<string, Bucket["tone"]> = { draft: "neutral", booked: "neutral", in_transit: "warn", arrived: "warn", closed: "good", cancelled: "bad" };
  const statuses: Bucket[] = statusOrder.map((st) => {
    const n = (db.prepare("SELECT COUNT(*) n FROM shipments WHERE status = ?").get(st) as { n: number }).n;
    const items = (
      db
        .prepare(
          `SELECT s.id, s.number, s.status, c.name AS client, d.origin, d.destination FROM shipments s
           LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN directions d ON d.id = s.direction_id
           WHERE s.status = ? ORDER BY s.updated_at DESC LIMIT ?`,
        )
        .all(st, LIST_CAP) as ShipRow[]
    ).map((r) => ref(r));
    return { key: st, label: STATUS_LABELS[st], count: n, amount: 0, items, tone: tones[st] };
  });

  // ---- опоздания у доставленных за 90 дней
  const t = loadThresholds(db);
  const delivered = deliveredIn(db, addDaysIso(today, -89), today).filter((r) => r.status !== "cancelled");
  const defs: { key: string; label: string; test: (d: number) => boolean; tone: Bucket["tone"] }[] = [
    { key: "0", label: "Вовремя", test: (d) => d === 0, tone: "good" },
    { key: "1-2", label: "1–2 дня", test: (d) => d >= 1 && d <= 2, tone: "good" },
    { key: "3-5", label: "3–5 дней", test: (d) => d >= 3 && d <= 5, tone: "warn" },
    { key: "6-10", label: "6–10 дней", test: (d) => d >= 6 && d <= 10, tone: "bad" },
    { key: "11+", label: "Больше 10 дней", test: (d) => d > 10, tone: "bad" },
  ];
  const delayBuckets: Bucket[] = defs.map((b) => {
    const list = delivered.filter((r) => b.test(r.delay_days)).sort((a, c) => c.delay_days - a.delay_days);
    return {
      key: b.key,
      label: b.label,
      count: list.length,
      amount: 0,
      tone: b.tone,
      items: list.slice(0, LIST_CAP).map((r) => ref({ ...r, client: r.client_name }, r.delay_days > 0 ? `${r.delay_days} дн.` : "в срок")),
    };
  });
  const onTime = delivered.filter((r) => r.delay_days <= t.delayDays).length;

  // ---- возраст долгов клиентов
  const lines = agingLines(db);
  const agingBuckets: Bucket[] = AGE_DEFS.map((b) => {
    const list = lines.filter((l) => b.test(diffDays(l.due, today))).sort((a, c) => c.remaining - a.remaining);
    return {
      key: b.key,
      label: b.label,
      count: list.length,
      amount: list.reduce((s, l) => s + l.remaining, 0),
      tone: b.tone,
      items: list.slice(0, LIST_CAP).map((l) => ref({ ...l, origin: null, destination: null }, `${new Intl.NumberFormat("ru-RU").format(l.remaining)} ₽`)),
    };
  });
  const totalOverdue = agingBuckets.filter((b) => b.key !== "open").reduce((s, b) => s + b.amount, 0);

  // ---- клиенты
  const clients = getProfit(db, 90, "client", today)
    .groups.slice(0, 6)
    .map((g) => ({ id: g.id, name: g.name, revenue: g.revenue, margin: g.margin, marginPct: g.marginPct, count: g.count }));

  return {
    today,
    days,
    forecast,
    accuracy: { mae: round1(mae), rmse: round1(rmse), days: residuals.length, withinBandPct: Math.round(within * 100) },
    month,
    statuses,
    delays: { buckets: delayBuckets, onTimePct: delivered.length ? Math.round((onTime / delivered.length) * 100) : null, total: delivered.length, thresholdDays: t.delayDays },
    aging: { buckets: agingBuckets, totalOverdue, totalOpen: agingBuckets.find((b) => b.key === "open")?.amount ?? 0 },
    clients,
  };
}

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
function monthName(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1];
}

/** Все заказы, поступившие в указанный день (по часовому поясу компании): для отдельного экрана со списком. */
export function getOrdersOn(db: Database.Database, date: string): OrderRef[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.number, s.status, s.created_at, c.name AS client, d.origin, d.destination
       FROM shipments s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN directions d ON d.id = s.direction_id
       WHERE substr(s.created_at, 1, 10) BETWEEN ? AND ? ORDER BY s.created_at DESC`,
    )
    .all(addDaysIso(date, -1), addDaysIso(date, 1)) as ShipRow[];
  return rows.filter((r) => toDay(r.created_at) === date).map((r) => ref(r));
}

export { STATUS_NOTES } from "./status-notes";

/** Все перевозки в статусе, самые свежие сверху: для отдельного экрана со списком. */
export function getShipmentsByStatus(db: Database.Database, status: string): OrderRef[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.number, s.status, s.created_at, c.name AS client, d.origin, d.destination
       FROM shipments s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN directions d ON d.id = s.direction_id
       WHERE s.status = ? ORDER BY s.updated_at DESC, s.id DESC`,
    )
    .all(status) as ShipRow[];
  return rows.map((r) => ref(r));
}

export const AGE_DEFS: { key: string; label: string; test: (a: number) => boolean; tone: Bucket["tone"] }[] = [
  { key: "open", label: "Срок ещё не наступил", test: (a) => a <= 0, tone: "neutral" },
  { key: "1-7", label: "Просрочено 1–7 дн.", test: (a) => a >= 1 && a <= 7, tone: "warn" },
  { key: "8-14", label: "Просрочено 8–14 дн.", test: (a) => a >= 8 && a <= 14, tone: "warn" },
  { key: "15-30", label: "Просрочено 15–30 дн.", test: (a) => a >= 15 && a <= 30, tone: "bad" },
  { key: "31-60", label: "Просрочено 31–60 дн.", test: (a) => a >= 31 && a <= 60, tone: "bad" },
  { key: "60+", label: "Просрочено больше 60 дн.", test: (a) => a > 60, tone: "bad" },
];

type AgingLine = { description: string; remaining: number; due: string; id: number; number: string; status: string; client: string | null };

function agingLines(db: Database.Database): AgingLine[] {
  return db
    .prepare(
      `SELECT f.description, f.actual_amount - f.paid_amount AS remaining, f.due_date AS due, s.id, s.number, s.status, c.name AS client
       FROM finance_lines f JOIN shipments s ON s.id = f.shipment_id LEFT JOIN clients c ON c.id = s.client_id
       WHERE f.kind = 'income' AND f.actual_amount IS NOT NULL AND f.payment_status <> 'paid' AND f.due_date IS NOT NULL AND s.status <> 'draft'
         AND f.actual_amount - f.paid_amount > 0`,
    )
    .all() as AgingLine[];
}

export interface ReceivableRow {
  shipmentId: number;
  number: string;
  client: string | null;
  description: string;
  remaining: number;
  due: string;
  /** сколько дней просрочено (0 и меньше: срок впереди) */
  overdueDays: number;
}

/** Неоплаченные счета клиентов в выбранной группе возраста, самые крупные сверху. */
export function getReceivablesBucket(db: Database.Database, key: string, today: string = todayIso()): { label: string; rows: ReceivableRow[] } | null {
  const def = AGE_DEFS.find((d) => d.key === key);
  if (!def) return null;
  const rows = agingLines(db)
    .filter((l) => def.test(diffDays(l.due, today)))
    .sort((a, c) => c.remaining - a.remaining)
    .map((l) => ({ shipmentId: l.id, number: l.number, client: l.client, description: l.description, remaining: l.remaining, due: l.due, overdueDays: diffDays(l.due, today) }));
  return { label: def.label, rows };
}
