/**
 * Аналитика для руководителя: «Сегодня» (что требует внимания), «Доходность» (кто приносит
 * результат), «Динамика» (что изменилось и какими перевозками это объясняется).
 * Читает готовые расчёты из shipment_metrics (см. recalc.ts), поэтому данные обновляются с задержкой.
 * Правила описаны в docs/calculations.md.
 */
import type Database from "better-sqlite3";
import { diffDays, todayIso } from "./dates";
import { loadThresholds } from "./recalc";

// ---------- общее ----------

export const addDaysIso = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type ReasonCode = "delay" | "overrun" | "overdue_payment" | "missing_fields" | "stale";

/** Что руководителю стоит сделать по каждой причине. */
export const REASON_ACTIONS: Record<ReasonCode, string> = {
  delay: "Узнать у менеджера новую дату прибытия и предупредить клиента",
  overdue_payment: "Выяснить, почему счёт не оплачен, и договориться о сроке",
  overrun: "Проверить дополнительные расходы и решить, можно ли выставить их клиенту",
  stale: "Попросить менеджера обновить сведения по перевозке",
  missing_fields: "Попросить менеджера заполнить недостающие данные",
};

export const REASON_TITLES: Record<ReasonCode, string> = {
  delay: "Опоздание",
  overdue_payment: "Просрочена оплата",
  overrun: "Перерасход",
  stale: "Нет обновлений",
  missing_fields: "Не заполнено",
};

/** Чем выше вес, тем выше перевозка в списке «Сегодня». */
const WEIGHT: Record<ReasonCode, number> = { delay: 50, overdue_payment: 40, overrun: 30, stale: 20, missing_fields: 10 };

export interface Freshness {
  refreshedAt: string | null;
  refreshEveryMinutes: number;
}

export interface MetricRow {
  id: number;
  number: string;
  status: string;
  client_id: number | null;
  client_name: string | null;
  direction_id: number | null;
  origin: string | null;
  destination: string | null;
  manager_name: string | null;
  planned_arrival: string | null;
  updated_at: string;
  revenue: number;
  cost: number;
  margin: number;
  is_preliminary: number;
  result_date: string | null;
  delay_days: number;
  overrun_pct: number;
  has_overdue_payment: number;
  reasons: string;
}

export const METRIC_SELECT = `
  SELECT s.id, s.number, s.status, s.client_id, c.name AS client_name, s.direction_id, d.origin, d.destination,
         u.name AS manager_name, s.planned_arrival, s.updated_at,
         m.revenue, m.cost, m.margin, m.is_preliminary, m.result_date, m.delay_days, m.overrun_pct,
         m.has_overdue_payment, m.attention_reasons AS reasons
  FROM shipments s
  JOIN shipment_metrics m ON m.shipment_id = s.id
  LEFT JOIN clients c ON c.id = s.client_id
  LEFT JOIN directions d ON d.id = s.direction_id
  LEFT JOIN users u ON u.id = s.manager_id`;

export const directionName = (r: { origin: string | null; destination: string | null }) => (r.origin ? `${r.origin} → ${r.destination}` : null);

// ---------- «Сегодня»: что требует внимания ----------

export interface AttentionItem {
  id: number;
  number: string;
  status: string;
  client: string | null;
  direction: string | null;
  manager: string | null;
  margin: number;
  isPreliminary: boolean;
  updatedAt: string;
  reasons: { code: ReasonCode; text: string; action: string }[];
  score: number;
}

export interface AttentionResult {
  total: number;
  activeShipments: number;
  byReason: { code: ReasonCode; title: string; count: number }[];
  receivables: { count: number; amount: number };
  payables: { count: number; amount: number };
  overrunExtra: number;
  items: AttentionItem[];
}

export function getAttention(db: Database.Database, today: string = todayIso()): AttentionResult {
  const rows = db.prepare(`${METRIC_SELECT} WHERE m.attention_reasons <> '[]'`).all() as MetricRow[];

  const items: AttentionItem[] = rows.map((r) => {
    const parsed = JSON.parse(r.reasons) as { code: ReasonCode; text: string }[];
    const score = parsed.reduce((sum, x) => sum + WEIGHT[x.code], 0) + Math.min(r.delay_days, 30);
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      client: r.client_name,
      direction: directionName(r),
      manager: r.manager_name,
      margin: r.margin,
      isPreliminary: r.is_preliminary === 1,
      updatedAt: r.updated_at,
      reasons: parsed.map((x) => ({ ...x, action: REASON_ACTIONS[x.code] })),
      score,
    };
  });
  items.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));

  const codes = Object.keys(REASON_TITLES) as ReasonCode[];
  const byReason = codes
    .map((code) => ({ code, title: REASON_TITLES[code], count: items.filter((i) => i.reasons.some((r) => r.code === code)).length }))
    .sort((a, b) => b.count - a.count);

  const overdue = (kind: "income" | "expense") =>
    db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(actual_amount - paid_amount), 0) AS amount FROM finance_lines
         WHERE kind = ? AND actual_amount IS NOT NULL AND payment_status <> 'paid' AND due_date IS NOT NULL AND due_date < ?`,
      )
      .get(kind, today) as { n: number; amount: number };
  const rec = overdue("income");
  const pay = overdue("expense");

  const extra = db
    .prepare(
      `SELECT COALESCE(SUM(l.actual_amount - l.planned_amount), 0) AS extra FROM finance_lines l
       JOIN shipments s ON s.id = l.shipment_id
       WHERE l.kind = 'expense' AND l.actual_amount IS NOT NULL AND l.actual_amount > l.planned_amount
         AND s.finance_closed_at IS NULL AND s.status NOT IN ('draft', 'cancelled')`,
    )
    .get() as { extra: number };

  const active = (db.prepare("SELECT COUNT(*) AS n FROM shipments WHERE status IN ('booked', 'in_transit', 'arrived')").get() as { n: number }).n;

  return {
    total: items.length,
    activeShipments: active,
    byReason,
    receivables: { count: rec.n, amount: rec.amount },
    payables: { count: pay.n, amount: pay.amount },
    overrunExtra: extra.extra,
    items,
  };
}

/** Сколько активных перевозок давно не обновлялись: показатели по ним могут быть неточными. */
export function getStaleSummary(db: Database.Database): { stale: number; active: number; days: number } {
  const days = loadThresholds(db).staleDays;
  const r = db
    .prepare(
      `SELECT COUNT(*) AS active, COALESCE(SUM(CASE WHEN m.attention_reasons LIKE '%"code":"stale"%' THEN 1 ELSE 0 END), 0) AS stale
       FROM shipments s JOIN shipment_metrics m ON m.shipment_id = s.id WHERE s.status IN ('booked', 'in_transit', 'arrived') AND s.finance_closed_at IS NULL`,
    )
    .get() as { active: number; stale: number };
  return { stale: r.stale, active: r.active, days };
}

// ---------- «Доходность»: клиенты и направления ----------

export type GroupBy = "client" | "direction";

export interface ProfitGroup {
  id: number | null;
  name: string;
  count: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
  revenueShare: number;
  problemCount: number;
  problemShare: number;
  delayedCount: number;
  overrunCount: number;
  overdueCount: number;
  preliminaryCount: number;
  /** «Выглядит лучше, чем работает» / «Работает хорошо» с объяснением. */
  verdict: { kind: "looks_better" | "works_well"; text: string } | null;
}

export interface ProfitTotals {
  count: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
  finalMargin: number;
  preliminaryMargin: number;
  preliminaryCount: number;
  problemCount: number;
}

export interface ProfitResult {
  from: string;
  to: string;
  days: number;
  groupBy: GroupBy;
  totals: ProfitTotals;
  groups: ProfitGroup[];
  inProgress: { count: number; expectedMargin: number };
}

const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

/** Перевозки, результат которых относится к периоду (по дате доставки; отменённые с расходами тоже). */
export function deliveredIn(db: Database.Database, from: string, to: string): MetricRow[] {
  return db
    .prepare(`${METRIC_SELECT} WHERE s.status IN ('arrived', 'closed', 'cancelled') AND m.result_date BETWEEN ? AND ?`)
    .all(from, to) as MetricRow[];
}

export function isProblem(r: MetricRow, t: { delayDays: number; overrunPct: number }): boolean {
  return r.delay_days > t.delayDays || r.overrun_pct > t.overrunPct || r.has_overdue_payment === 1;
}

export function totalsOf(rows: MetricRow[], t: { delayDays: number; overrunPct: number }): ProfitTotals {
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const margin = revenue - cost;
  const prelim = rows.filter((r) => r.is_preliminary === 1);
  return {
    count: rows.length,
    revenue,
    cost,
    margin,
    marginPct: pct(margin, revenue),
    finalMargin: rows.filter((r) => r.is_preliminary === 0).reduce((s, r) => s + r.margin, 0),
    preliminaryMargin: prelim.reduce((s, r) => s + r.margin, 0),
    preliminaryCount: prelim.length,
    problemCount: rows.filter((r) => isProblem(r, t)).length,
  };
}

export function getProfit(db: Database.Database, days: number, groupBy: GroupBy, today: string = todayIso()): ProfitResult {
  const t = loadThresholds(db);
  const from = addDaysIso(today, -(days - 1));
  const rows = deliveredIn(db, from, today);
  const totals = totalsOf(rows, t);

  const buckets = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const id = groupBy === "client" ? r.client_id : r.direction_id;
    const key = String(id);
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }

  const groups: ProfitGroup[] = [...buckets.values()].map((list) => {
    const first = list[0];
    const id = groupBy === "client" ? first.client_id : first.direction_id;
    const name = (groupBy === "client" ? first.client_name : directionName(first)) ?? (groupBy === "client" ? "Клиент не указан" : "Направление не указано");
    const tt = totalsOf(list, t);
    const delayedCount = list.filter((r) => r.delay_days > t.delayDays).length;
    const overrunCount = list.filter((r) => r.overrun_pct > t.overrunPct).length;
    const overdueCount = list.filter((r) => r.has_overdue_payment === 1).length;
    const revenueShare = pct(tt.revenue, totals.revenue);
    const problemShare = pct(tt.problemCount, tt.count);

    let verdict: ProfitGroup["verdict"] = null;
    // «Выглядит лучше, чем работает»: заметная доля оборота, но маржа вдвое ниже средней по компании,
    // либо маржа ниже средней и больше половины перевозок с проблемами.
    if (tt.count >= 2 && revenueShare >= 15 && (tt.marginPct < totals.marginPct * 0.5 || (problemShare >= 50 && tt.marginPct < totals.marginPct))) {
      verdict = {
        kind: "looks_better",
        text: `Даёт ${revenueShare} % оборота, но маржа лишь ${tt.marginPct} % (по компании ${totals.marginPct} %); проблемных перевозок ${problemShare} %`,
      };
    } else if (tt.count >= 2 && tt.marginPct >= totals.marginPct * 1.2 && problemShare <= 15) {
      verdict = { kind: "works_well", text: `Маржа ${tt.marginPct} % при ${problemShare} % проблемных перевозок` };
    }
    return {
      id,
      name,
      count: tt.count,
      revenue: tt.revenue,
      cost: tt.cost,
      margin: tt.margin,
      marginPct: tt.marginPct,
      revenueShare,
      problemCount: tt.problemCount,
      problemShare,
      delayedCount,
      overrunCount,
      overdueCount,
      preliminaryCount: tt.preliminaryCount,
      verdict,
    };
  });
  groups.sort((a, b) => b.revenue - a.revenue);

  // Перевозки в работе: результата ещё нет, показываем ожидаемую маржу по плану
  const inProg = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(m.margin), 0) AS margin FROM shipments s JOIN shipment_metrics m ON m.shipment_id = s.id WHERE s.status IN ('booked', 'in_transit')`)
    .get() as { n: number; margin: number };

  return { from, to: today, days, groupBy, totals, groups, inProgress: { count: inProg.n, expectedMargin: inProg.margin } };
}

export interface PaymentsResult {
  from: string;
  to: string;
  /** Сколько денег пришло от клиентов в периоде (по дате оплаты, а не доставки). */
  received: number;
  lines: number;
  shipments: number;
}

/**
 * Оплаты клиентов за период. Считаются по дате поступления денег (paid_at) и не зависят от даты доставки:
 * перевозка, доставленная в октябре и оплаченная в ноябре, попадает в маржу октября и в оплаты ноября.
 * Сумма оплаты строки: paid_amount. Частичная оплата без даты в период не попадает.
 */
export function getPayments(db: Database.Database, days: number, today: string = todayIso()): PaymentsResult {
  const from = addDaysIso(today, -(days - 1));
  const r = db
    .prepare(
      `SELECT COUNT(*) AS lines, COUNT(DISTINCT f.shipment_id) AS shipments, COALESCE(SUM(f.paid_amount), 0) AS received
       FROM finance_lines f JOIN shipments s ON s.id = f.shipment_id
       WHERE f.kind = 'income' AND f.paid_amount > 0 AND f.paid_at BETWEEN ? AND ? AND s.status <> 'draft'`,
    )
    .get(from, today) as { lines: number; shipments: number; received: number };
  return { from, to: today, ...r };
}

export interface GroupDetail {
  group: ProfitGroup | null;
  name: string;
  from: string;
  to: string;
  days: number;
  shipments: {
    id: number;
    number: string;
    status: string;
    client: string | null;
    direction: string | null;
    resultDate: string | null;
    revenue: number;
    margin: number;
    isPreliminary: boolean;
    delayDays: number;
    overrunPct: number;
    reasons: string[];
    isProblem: boolean;
  }[];
}

/** Перевозки клиента или направления за период: конкретные перевозки, из которых сложилась цифра. */
export function getGroupDetail(db: Database.Database, groupBy: GroupBy, id: number, days: number, today: string = todayIso()): GroupDetail {
  const profit = getProfit(db, days, groupBy, today);
  const t = loadThresholds(db);
  const col = groupBy === "client" ? "s.client_id" : "s.direction_id";
  const rows = (db.prepare(`${METRIC_SELECT} WHERE ${col} = ? AND s.status IN ('arrived', 'closed', 'cancelled') AND m.result_date BETWEEN ? AND ?`).all(id, profit.from, today) as MetricRow[]).sort(
    (a, b) => a.margin - b.margin,
  );
  const group = profit.groups.find((g) => g.id === id) ?? null;
  let name = group?.name;
  if (!name) {
    name =
      groupBy === "client"
        ? (db.prepare("SELECT name FROM clients WHERE id = ?").get(id) as { name: string } | undefined)?.name
        : (() => {
            const d = db.prepare("SELECT origin, destination FROM directions WHERE id = ?").get(id) as { origin: string; destination: string } | undefined;
            return d ? `${d.origin} → ${d.destination}` : undefined;
          })();
  }
  return {
    group,
    name: name ?? "Не найдено",
    from: profit.from,
    to: today,
    days,
    shipments: rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      client: r.client_name,
      direction: directionName(r),
      resultDate: r.result_date,
      revenue: r.revenue,
      margin: r.margin,
      isPreliminary: r.is_preliminary === 1,
      delayDays: r.delay_days,
      overrunPct: r.overrun_pct,
      reasons: (JSON.parse(r.reasons) as { text: string }[]).map((x) => x.text),
      isProblem: isProblem(r, t),
    })),
  };
}

// ---------- «Динамика»: что изменилось ----------

export interface WeekBucket {
  start: string;
  end: string;
  margin: number;
  count: number;
  period: "previous" | "current";
}

export interface Contributor {
  id: number;
  number: string;
  client: string | null;
  direction: string | null;
  margin: number;
  /** Насколько маржа перевозки выше (+) или ниже (−) средней по предыдущему периоду. */
  effect: number;
  reasons: string[];
}

export interface ClientChange {
  id: number | null;
  name: string;
  current: number;
  previous: number;
  delta: number;
  countDelta: number;
}

export interface DynamicsResult {
  weeks: number;
  current: { from: string; to: string };
  previous: { from: string; to: string };
  currentTotals: ProfitTotals;
  previousTotals: ProfitTotals;
  delta: { margin: number; marginPct: number | null; revenue: number; count: number; marginPoints: number };
  /** Δ маржи = эффект объёма (число перевозок) + эффект «маржа на перевозку». */
  effects: { volume: number; rate: number; averagePrevious: number; averageCurrent: number };
  weeklySeries: WeekBucket[];
  byClient: ClientChange[];
  dragging: Contributor[];
  boosting: Contributor[];
}

export function getDynamics(db: Database.Database, weeks: number, today: string = todayIso()): DynamicsResult {
  const t = loadThresholds(db);
  const span = weeks * 7;
  const curFrom = addDaysIso(today, -(span - 1));
  const prevTo = addDaysIso(curFrom, -1);
  const prevFrom = addDaysIso(prevTo, -(span - 1));

  const cur = deliveredIn(db, curFrom, today);
  const prev = deliveredIn(db, prevFrom, prevTo);
  const ct = totalsOf(cur, t);
  const pt = totalsOf(prev, t);

  const avgPrev = pt.count === 0 ? 0 : pt.margin / pt.count;
  const avgCur = ct.count === 0 ? 0 : ct.margin / ct.count;
  const volume = Math.round((ct.count - pt.count) * avgPrev);
  const rate = Math.round(ct.count * (avgCur - avgPrev));

  // По неделям, от старых к новым
  const weeklySeries: WeekBucket[] = [];
  for (let k = weeks * 2 - 1; k >= 0; k--) {
    const end = addDaysIso(today, -7 * k);
    const start = addDaysIso(end, -6);
    const inWeek = [...cur, ...prev].filter((r) => r.result_date! >= start && r.result_date! <= end);
    weeklySeries.push({ start, end, margin: inWeek.reduce((s, r) => s + r.margin, 0), count: inWeek.length, period: k < weeks ? "current" : "previous" });
  }

  const byKey = new Map<string, ClientChange>();
  const bump = (r: MetricRow, which: "current" | "previous") => {
    const key = String(r.client_id);
    const e = byKey.get(key) ?? { id: r.client_id, name: r.client_name ?? "Клиент не указан", current: 0, previous: 0, delta: 0, countDelta: 0 };
    e[which] += r.margin;
    e.countDelta += which === "current" ? 1 : -1;
    byKey.set(key, e);
  };
  cur.forEach((r) => bump(r, "current"));
  prev.forEach((r) => bump(r, "previous"));
  const byClient = [...byKey.values()].map((e) => ({ ...e, delta: e.current - e.previous })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const contributors: Contributor[] = cur.map((r) => ({
    id: r.id,
    number: r.number,
    client: r.client_name,
    direction: directionName(r),
    margin: r.margin,
    effect: Math.round(r.margin - avgPrev),
    reasons: (JSON.parse(r.reasons) as { text: string }[]).map((x) => x.text),
  }));
  const dragging = contributors.filter((c) => c.effect < 0).sort((a, b) => a.effect - b.effect).slice(0, 5);
  const boosting = contributors.filter((c) => c.effect > 0).sort((a, b) => b.effect - a.effect).slice(0, 5);

  return {
    weeks,
    current: { from: curFrom, to: today },
    previous: { from: prevFrom, to: prevTo },
    currentTotals: ct,
    previousTotals: pt,
    delta: {
      margin: ct.margin - pt.margin,
      marginPct: pt.margin === 0 ? null : Math.round(((ct.margin - pt.margin) / Math.abs(pt.margin)) * 1000) / 10,
      revenue: ct.revenue - pt.revenue,
      count: ct.count - pt.count,
      marginPoints: Math.round((ct.marginPct - pt.marginPct) * 10) / 10,
    },
    effects: { volume, rate, averagePrevious: Math.round(avgPrev), averageCurrent: Math.round(avgCur) },
    weeklySeries,
    byClient,
    dragging,
    boosting,
  };
}

export { diffDays };
