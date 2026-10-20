import type Database from "better-sqlite3";
import { todayIso } from "./dates";
import {
  computeShipmentMetrics,
  DEFAULT_THRESHOLDS,
  type LineInput,
  type ShipmentInput,
  type ShipmentStatus,
  type Thresholds,
} from "./metrics";

export function loadThresholds(db: Database.Database): Thresholds {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, Number(r.value)]));
  return {
    delayDays: map.get("delay_days_threshold") ?? DEFAULT_THRESHOLDS.delayDays,
    overrunPct: map.get("overrun_pct_threshold") ?? DEFAULT_THRESHOLDS.overrunPct,
    staleDays: map.get("stale_days_threshold") ?? DEFAULT_THRESHOLDS.staleDays,
  };
}

interface ShipmentRow {
  id: number;
  status: ShipmentStatus;
  client_id: number | null;
  direction_id: number | null;
  cargo_description: string | null;
  planned_departure: string | null;
  planned_arrival: string | null;
  actual_arrival: string | null;
  finance_closed_at: string | null;
  updated_at: string;
}

interface LineRow {
  shipment_id: number;
  kind: "income" | "expense";
  planned_amount: number;
  actual_amount: number | null;
  payment_status: "unpaid" | "partial" | "paid";
  due_date: string | null;
}

/**
 * Пересчитывает таблицу shipment_metrics по всем перевозкам и запоминает время обновления
 * аналитики («данные на HH:MM»). Возвращает количество пересчитанных перевозок.
 */
export function recalcAll(db: Database.Database, now: Date = new Date()): number {
  const today = todayIso(now);
  const thresholds = loadThresholds(db);

  const shipments = db.prepare("SELECT * FROM shipments").all() as ShipmentRow[];
  const containers = db.prepare("SELECT shipment_id, number FROM containers").all() as {
    shipment_id: number;
    number: string | null;
  }[];
  const lines = db.prepare("SELECT * FROM finance_lines").all() as LineRow[];

  const containersBy = new Map<number, { number: string | null }[]>();
  for (const c of containers) {
    containersBy.set(c.shipment_id, [...(containersBy.get(c.shipment_id) ?? []), { number: c.number }]);
  }
  const linesBy = new Map<number, LineInput[]>();
  for (const l of lines) {
    const arr = linesBy.get(l.shipment_id) ?? [];
    arr.push({
      kind: l.kind,
      plannedAmount: l.planned_amount,
      actualAmount: l.actual_amount,
      paymentStatus: l.payment_status,
      dueDate: l.due_date,
    });
    linesBy.set(l.shipment_id, arr);
  }

  const upsert = db.prepare(`INSERT INTO shipment_metrics
    (shipment_id, revenue, cost, margin, is_preliminary, result_date, delay_days, overrun_pct,
     has_overdue_payment, stale_days, missing_fields, attention_reasons, calculated_at)
    VALUES (@id, @revenue, @cost, @margin, @prelim, @resultDate, @delay, @overrun, @overdue, @stale, @missing, @reasons, @at)
    ON CONFLICT (shipment_id) DO UPDATE SET
      revenue = excluded.revenue, cost = excluded.cost, margin = excluded.margin,
      is_preliminary = excluded.is_preliminary, result_date = excluded.result_date,
      delay_days = excluded.delay_days, overrun_pct = excluded.overrun_pct,
      has_overdue_payment = excluded.has_overdue_payment, stale_days = excluded.stale_days,
      missing_fields = excluded.missing_fields, attention_reasons = excluded.attention_reasons,
      calculated_at = excluded.calculated_at`);

  const at = now.toISOString();
  const run = db.transaction(() => {
    for (const s of shipments) {
      const input: ShipmentInput = {
        status: s.status,
        clientId: s.client_id,
        directionId: s.direction_id,
        cargoDescription: s.cargo_description,
        plannedDeparture: s.planned_departure,
        plannedArrival: s.planned_arrival,
        actualArrival: s.actual_arrival,
        financeClosedAt: s.finance_closed_at,
        updatedAt: s.updated_at,
        containers: containersBy.get(s.id) ?? [],
      };
      const m = computeShipmentMetrics(input, linesBy.get(s.id) ?? [], today, thresholds);
      upsert.run({
        id: s.id,
        revenue: m.revenue,
        cost: m.cost,
        margin: m.margin,
        prelim: m.isPreliminary ? 1 : 0,
        resultDate: m.resultDate,
        delay: m.delayDays,
        overrun: m.overrunPct,
        overdue: m.hasOverduePayment ? 1 : 0,
        stale: m.staleDays,
        missing: JSON.stringify(m.missingFields),
        reasons: JSON.stringify(m.attentionReasons),
        at,
      });
    }
    db.prepare("UPDATE analytics_refresh SET refreshed_at = ? WHERE id = 1").run(at);
  });
  run();
  return shipments.length;
}

export interface RefreshInfo {
  refreshedAt: string | null;
  refreshEveryMinutes: number;
}

export function refreshInfo(db: Database.Database): RefreshInfo {
  const row = db.prepare("SELECT refreshed_at FROM analytics_refresh WHERE id = 1").get() as { refreshed_at: string | null } | undefined;
  const minutes = db.prepare("SELECT value FROM settings WHERE key = 'analytics_refresh_minutes'").get() as { value: string } | undefined;
  return { refreshedAt: row?.refreshed_at ?? null, refreshEveryMinutes: Number(minutes?.value ?? 5) };
}

/**
 * Аналитика обновляется с задержкой: пересчёт запускается при чтении, если с прошлого прошло больше
 * заданного числа минут. Так изменения учёта попадают в аналитику не мгновенно, а в пределах этого срока
 * (или сразу, если нажать «Обновить»).
 */
export function ensureFresh(db: Database.Database, now: Date = new Date()): RefreshInfo {
  const info = refreshInfo(db);
  const age = info.refreshedAt ? now.getTime() - Date.parse(info.refreshedAt) : Infinity;
  if (age > info.refreshEveryMinutes * 60_000) recalcAll(db, now);
  return refreshInfo(db);
}
