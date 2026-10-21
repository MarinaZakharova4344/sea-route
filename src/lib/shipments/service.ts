/**
 * Операции с перевозками. Все функции получают подключение к базе и пользователя явно,
 * время тоже передаётся снаружи: так их легко проверять тестами.
 */
import type Database from "better-sqlite3";
import { ApiError } from "../api";
import type { AuthUser } from "../auth/authorize";
import { toDay } from "../dates";
import type { ContainerInput, LineInput, ShipmentInput } from "./schemas";
import type { z } from "zod";
import type { ListQuery } from "./schemas";

export const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  booked: "Забронирована",
  in_transit: "В пути",
  arrived: "Прибыла",
  closed: "Закрыта",
  cancelled: "Отменена",
};

const FIELD_LABELS: Record<string, string> = {
  client_id: "Клиент",
  direction_id: "Направление",
  manager_id: "Ответственный менеджер",
  cargo_description: "Груз",
  status: "Статус",
  planned_departure: "Плановая дата отправления",
  actual_departure: "Фактическая дата отправления",
  planned_arrival: "Плановая дата прибытия",
  actual_arrival: "Фактическая дата прибытия",
  finance_closed_at: "Финансовое закрытие",
};

const PAYMENT_LABELS: Record<string, string> = { unpaid: "не оплачено", partial: "оплачено частично", paid: "оплачено" };

const ts = (now: Date) => `${now.toISOString().slice(0, 19)}Z`;
const day = (now: Date) => now.toISOString().slice(0, 10);
const rub = (n: number | null) => (n === null ? null : `${n.toLocaleString("ru-RU")} ₽`);

interface ShipmentRow {
  id: number;
  number: string;
  client_id: number | null;
  direction_id: number | null;
  manager_id: number | null;
  cargo_description: string | null;
  status: string;
  planned_departure: string | null;
  actual_departure: string | null;
  planned_arrival: string | null;
  actual_arrival: string | null;
  finance_closed_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: number | null;
}

interface LineRow {
  id: number;
  shipment_id: number;
  kind: "income" | "expense";
  counterparty_id: number | null;
  client_id: number | null;
  description: string;
  planned_amount: number;
  actual_amount: number | null;
  is_unplanned: number;
  currency: string;
  payment_status: "unpaid" | "partial" | "paid";
  paid_amount: number;
  due_date: string | null;
  paid_at: string | null;
}

interface ContainerRow {
  id: number;
  shipment_id: number;
  number: string | null;
  type: string | null;
  weight_kg: number | null;
  comment: string | null;
}

// ---------- вспомогательное ----------

function fieldError(field: string, message: string): never {
  throw new ApiError(422, "Проверьте введённые данные", [{ field, message }]);
}

function getRow(db: Database.Database, id: number): ShipmentRow {
  const row = db.prepare("SELECT * FROM shipments WHERE id = ?").get(id) as ShipmentRow | undefined;
  if (!row) throw new ApiError(404, "Перевозка не найдена");
  return row;
}

function assertEditable(row: ShipmentRow): void {
  if (row.finance_closed_at) {
    throw new ApiError(409, "Перевозка закрыта финансово. Откройте её заново, чтобы внести изменения");
  }
}

function touch(db: Database.Database, id: number, user: AuthUser, now: Date): void {
  db.prepare("UPDATE shipments SET updated_at = ?, updated_by = ? WHERE id = ?").run(ts(now), user.id, id);
}

function log(db: Database.Database, id: number, user: AuthUser, now: Date, field: string, oldValue: string | null, newValue: string | null): void {
  db.prepare("INSERT INTO change_log (shipment_id, changed_by, changed_at, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, user.id, ts(now), field, oldValue, newValue,
  );
}

function lookupName(db: Database.Database, column: string, value: number | string | null): string | null {
  if (value === null) return null;
  if (column === "client_id") return (db.prepare("SELECT name FROM clients WHERE id = ?").get(value) as { name: string } | undefined)?.name ?? null;
  if (column === "manager_id") return (db.prepare("SELECT name FROM users WHERE id = ?").get(value) as { name: string } | undefined)?.name ?? null;
  if (column === "direction_id") {
    const d = db.prepare("SELECT origin, destination FROM directions WHERE id = ?").get(value) as { origin: string; destination: string } | undefined;
    return d ? `${d.origin} → ${d.destination}` : null;
  }
  if (column === "status") return STATUS_LABELS[String(value)] ?? String(value);
  return String(value);
}

function checkReferences(db: Database.Database, input: ShipmentInput): void {
  if (input.clientId && !db.prepare("SELECT 1 FROM clients WHERE id = ?").get(input.clientId)) fieldError("clientId", "Клиент не найден");
  if (input.directionId && !db.prepare("SELECT 1 FROM directions WHERE id = ?").get(input.directionId)) fieldError("directionId", "Направление не найдено");
  if (input.managerId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'manager'").get(input.managerId)) {
    fieldError("managerId", "Ответственным может быть только менеджер");
  }
}

/** Проверка согласованности итогового состояния перевозки (после применения правок). */
function validateState(s: {
  status: string;
  planned_departure: string | null;
  actual_departure: string | null;
  planned_arrival: string | null;
  actual_arrival: string | null;
}): void {
  const label = STATUS_LABELS[s.status];
  if (s.planned_departure && s.planned_arrival && s.planned_arrival < s.planned_departure) {
    fieldError("plannedArrival", "Плановое прибытие не может быть раньше планового отправления");
  }
  if (s.actual_departure && s.actual_arrival && s.actual_arrival < s.actual_departure) {
    fieldError("actualArrival", "Фактическое прибытие не может быть раньше фактического отправления");
  }
  if ((s.status === "in_transit" || s.status === "arrived") && !s.actual_departure) {
    fieldError("actualDeparture", `Для статуса «${label}» укажите фактическую дату отправления`);
  }
  if (s.status === "arrived" && !s.actual_arrival) {
    fieldError("actualArrival", "Для статуса «Прибыла» укажите фактическую дату прибытия");
  }
  if (["draft", "booked", "in_transit"].includes(s.status) && s.actual_arrival) {
    fieldError("status", "Указана фактическая дата прибытия, поэтому статус должен быть «Прибыла»");
  }
}

// ---------- справочники ----------

export function referenceData(db: Database.Database) {
  return {
    clients: db.prepare("SELECT id, name FROM clients ORDER BY name").all(),
    directions: db.prepare("SELECT id, origin, destination FROM directions ORDER BY origin, destination").all(),
    counterparties: db.prepare("SELECT id, name, type FROM counterparties ORDER BY name").all(),
    managers: db.prepare("SELECT id, name FROM users WHERE role = 'manager' ORDER BY name").all(),
    statuses: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
  };
}

export function createClient(db: Database.Database, input: { name: string; contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null }) {
  const r = db.prepare("INSERT INTO clients (name, contact_name, contact_phone, contact_email) VALUES (?, ?, ?, ?)").run(
    input.name, input.contactName ?? null, input.contactPhone ?? null, input.contactEmail ?? null,
  );
  return { id: Number(r.lastInsertRowid), name: input.name };
}

export function createCounterparty(db: Database.Database, input: { name: string; type: string }) {
  const r = db.prepare("INSERT INTO counterparties (name, type) VALUES (?, ?)").run(input.name, input.type);
  return { id: Number(r.lastInsertRowid), name: input.name, type: input.type };
}

export function createDirection(db: Database.Database, input: { origin: string; destination: string }) {
  const existing = db.prepare("SELECT id FROM directions WHERE origin = ? AND destination = ?").get(input.origin, input.destination) as { id: number } | undefined;
  if (existing) throw new ApiError(409, "Такое направление уже есть", { id: existing.id });
  const r = db.prepare("INSERT INTO directions (origin, destination) VALUES (?, ?)").run(input.origin, input.destination);
  return { id: Number(r.lastInsertRowid), ...input };
}

// ---------- чтение ----------

function metricsOf(row: Record<string, unknown>) {
  if (row.m_calculated_at == null) return null;
  return {
    revenue: row.m_revenue as number,
    cost: row.m_cost as number,
    margin: row.m_margin as number,
    isPreliminary: row.m_is_preliminary === 1,
    resultDate: (row.m_result_date as string | null) ?? null,
    delayDays: row.m_delay_days as number,
    overrunPct: row.m_overrun_pct as number,
    hasOverduePayment: row.m_has_overdue === 1,
    staleDays: row.m_stale_days as number,
    missingFields: JSON.parse(row.m_missing as string) as string[],
    attentionReasons: JSON.parse(row.m_reasons as string) as { code: string; text: string }[],
    calculatedAt: row.m_calculated_at as string,
  };
}

const SELECT_LIST = `
  SELECT s.*, c.name AS client_name, d.origin AS dir_origin, d.destination AS dir_destination, u.name AS manager_name,
         m.revenue AS m_revenue, m.cost AS m_cost, m.margin AS m_margin, m.is_preliminary AS m_is_preliminary,
         m.result_date AS m_result_date, m.delay_days AS m_delay_days, m.overrun_pct AS m_overrun_pct,
         m.has_overdue_payment AS m_has_overdue, m.stale_days AS m_stale_days, m.missing_fields AS m_missing,
         m.attention_reasons AS m_reasons, m.calculated_at AS m_calculated_at
  FROM shipments s
  LEFT JOIN clients c ON c.id = s.client_id
  LEFT JOIN directions d ON d.id = s.direction_id
  LEFT JOIN users u ON u.id = s.manager_id
  LEFT JOIN shipment_metrics m ON m.shipment_id = s.id`;

function summarize(r: Record<string, unknown>) {
  const metrics = metricsOf(r);
  return {
    id: r.id as number,
    number: r.number as string,
    status: r.status as string,
    statusLabel: STATUS_LABELS[r.status as string],
    client: r.client_id ? { id: r.client_id as number, name: r.client_name as string } : null,
    direction: r.direction_id ? { id: r.direction_id as number, origin: r.dir_origin as string, destination: r.dir_destination as string } : null,
    manager: r.manager_id ? { id: r.manager_id as number, name: r.manager_name as string } : null,
    plannedDeparture: r.planned_departure as string | null,
    actualDeparture: r.actual_departure as string | null,
    plannedArrival: r.planned_arrival as string | null,
    actualArrival: r.actual_arrival as string | null,
    financeClosedAt: r.finance_closed_at as string | null,
    updatedAt: r.updated_at as string,
    metrics,
    // Изменения учёта ещё не попали в аналитику (она обновляется с задержкой)
    analyticsPending: metrics === null || metrics.calculatedAt < (r.updated_at as string),
  };
}

export function listShipments(db: Database.Database, q: z.infer<typeof ListQuery>) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.status) { where.push("s.status = ?"); args.push(q.status); }
  if (q.clientId) { where.push("s.client_id = ?"); args.push(q.clientId); }
  if (q.directionId) { where.push("s.direction_id = ?"); args.push(q.directionId); }
  if (q.managerId) { where.push("s.manager_id = ?"); args.push(q.managerId); }
  if (q.q) {
    where.push("(s.number LIKE ? OR c.name LIKE ? OR s.cargo_description LIKE ?)");
    const like = `%${q.q.replace(/[%_]/g, "")}%`;
    args.push(like, like, like);
  }
  if (q.attention === "any") where.push("m.attention_reasons <> '[]'");
  else if (q.attention) { where.push("m.attention_reasons LIKE ?"); args.push(`%"code":"${q.attention}"%`); }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM shipments s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN shipment_metrics m ON m.shipment_id = s.id ${clause}`).get(...args) as { n: number }).n;
  const rows = db
    .prepare(`${SELECT_LIST} ${clause} ORDER BY COALESCE(s.planned_departure, substr(s.created_at, 1, 10)) DESC, s.id DESC LIMIT ? OFFSET ?`)
    .all(...args, q.limit, q.offset) as Record<string, unknown>[];
  return { total, limit: q.limit, offset: q.offset, items: rows.map(summarize) };
}

export function getShipment(db: Database.Database, id: number) {
  const row = db.prepare(`${SELECT_LIST} WHERE s.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "Перевозка не найдена");

  const containers = (db.prepare("SELECT * FROM containers WHERE shipment_id = ? ORDER BY id").all(id) as ContainerRow[]).map((c) => ({
    id: c.id, number: c.number, type: c.type, weightKg: c.weight_kg, comment: c.comment,
  }));
  const lines = (
    db
      .prepare(
        `SELECT l.*, cp.name AS counterparty_name FROM finance_lines l
         LEFT JOIN counterparties cp ON cp.id = l.counterparty_id WHERE l.shipment_id = ? ORDER BY l.kind DESC, l.id`,
      )
      .all(id) as (LineRow & { counterparty_name: string | null })[]
  ).map((l) => ({
    id: l.id,
    kind: l.kind,
    counterpartyId: l.counterparty_id,
    counterpartyName: l.counterparty_name,
    clientId: l.client_id,
    description: l.description,
    plannedAmount: l.planned_amount,
    actualAmount: l.actual_amount,
    isUnplanned: l.is_unplanned === 1,
    currency: l.currency,
    paymentStatus: l.payment_status,
    paidAmount: l.paid_amount,
    dueDate: l.due_date,
    paidAt: l.paid_at,
  }));
  const changes = (
    db
      .prepare(
        `SELECT ch.id, ch.changed_at, ch.field, ch.old_value, ch.new_value, u.name AS user_name
         FROM change_log ch LEFT JOIN users u ON u.id = ch.changed_by
         WHERE ch.shipment_id = ? ORDER BY ch.changed_at DESC, ch.id DESC`,
      )
      .all(id) as { id: number; changed_at: string; field: string; old_value: string | null; new_value: string | null; user_name: string | null }[]
  ).map((c) => ({ id: c.id, changedAt: c.changed_at, changedBy: c.user_name, field: c.field, oldValue: c.old_value, newValue: c.new_value }));

  return {
    ...summarize(row),
    cargoDescription: row.cargo_description as string | null,
    createdAt: row.created_at as string,
    updatedBy: row.updated_by ? (db.prepare("SELECT name FROM users WHERE id = ?").get(row.updated_by) as { name: string } | undefined)?.name ?? null : null,
    containers,
    lines,
    changes,
  };
}

// ---------- перевозки ----------

function nextNumber(db: Database.Database): string {
  const row = db.prepare("SELECT MAX(CAST(substr(number, 4) AS INTEGER)) AS n FROM shipments WHERE number LIKE 'SR-%'").get() as { n: number | null };
  return `SR-${String((row.n ?? 0) + 1).padStart(4, "0")}`;
}

const COLUMNS: Record<keyof ShipmentInput, string> = {
  clientId: "client_id",
  directionId: "direction_id",
  managerId: "manager_id",
  cargoDescription: "cargo_description",
  status: "status",
  plannedDeparture: "planned_departure",
  actualDeparture: "actual_departure",
  plannedArrival: "planned_arrival",
  actualArrival: "actual_arrival",
};

export function createShipment(db: Database.Database, user: AuthUser, input: ShipmentInput, now: Date = new Date()) {
  checkReferences(db, input);
  const state = {
    status: input.status ?? "draft",
    planned_departure: input.plannedDeparture ?? null,
    actual_departure: input.actualDeparture ?? null,
    planned_arrival: input.plannedArrival ?? null,
    actual_arrival: input.actualArrival ?? null,
  };
  validateState(state);

  const run = db.transaction(() => {
    const number = nextNumber(db);
    const r = db
      .prepare(
        `INSERT INTO shipments (number, client_id, direction_id, manager_id, cargo_description, status,
           planned_departure, actual_departure, planned_arrival, actual_arrival, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        number, input.clientId ?? null, input.directionId ?? null, input.managerId ?? user.id, input.cargoDescription ?? null,
        state.status, state.planned_departure, state.actual_departure, state.planned_arrival, state.actual_arrival,
        ts(now), ts(now), user.id,
      );
    const id = Number(r.lastInsertRowid);
    log(db, id, user, now, "Перевозка", null, `создана (${number})`);
    return id;
  });
  return getShipment(db, run());
}

export function updateShipment(db: Database.Database, user: AuthUser, id: number, input: ShipmentInput, now: Date = new Date()) {
  const row = getRow(db, id);
  assertEditable(row);
  checkReferences(db, input);

  const next: Record<string, string | number | null> = {};
  for (const [key, column] of Object.entries(COLUMNS) as [keyof ShipmentInput, string][]) {
    if (input[key] !== undefined) next[column] = input[key] as string | number | null;
  }
  const merged = { ...row, ...next } as ShipmentRow;
  validateState(merged);

  const changed = Object.keys(next).filter((c) => (row as unknown as Record<string, unknown>)[c] !== next[c]);
  if (changed.length === 0) return getShipment(db, id);

  db.transaction(() => {
    const sets = changed.map((c) => `${c} = ?`).join(", ");
    db.prepare(`UPDATE shipments SET ${sets} WHERE id = ?`).run(...changed.map((c) => next[c]), id);
    for (const c of changed) {
      const oldValue = (row as unknown as Record<string, string | number | null>)[c];
      log(db, id, user, now, FIELD_LABELS[c], lookupName(db, c, oldValue), lookupName(db, c, next[c]));
    }
    touch(db, id, user, now);
  })();
  return getShipment(db, id);
}

// ---------- контейнеры ----------

export function addContainer(db: Database.Database, user: AuthUser, shipmentId: number, input: ContainerInput, now: Date = new Date()) {
  assertEditable(getRow(db, shipmentId));
  db.transaction(() => {
    db.prepare("INSERT INTO containers (shipment_id, number, type, weight_kg, comment) VALUES (?, ?, ?, ?, ?)").run(
      shipmentId, input.number ?? null, input.type ?? null, input.weightKg ?? null, input.comment ?? null,
    );
    log(db, shipmentId, user, now, "Контейнер", null, `добавлен${input.number ? ` ${input.number}` : ""}`);
    touch(db, shipmentId, user, now);
  })();
  return getShipment(db, shipmentId);
}

function getContainer(db: Database.Database, id: number): ContainerRow {
  const c = db.prepare("SELECT * FROM containers WHERE id = ?").get(id) as ContainerRow | undefined;
  if (!c) throw new ApiError(404, "Контейнер не найден");
  return c;
}

export function updateContainer(db: Database.Database, user: AuthUser, id: number, input: ContainerInput, now: Date = new Date()) {
  const c = getContainer(db, id);
  assertEditable(getRow(db, c.shipment_id));
  const next = {
    number: input.number !== undefined ? input.number : c.number,
    type: input.type !== undefined ? input.type : c.type,
    weight_kg: input.weightKg !== undefined ? input.weightKg : c.weight_kg,
    comment: input.comment !== undefined ? input.comment : c.comment,
  };
  db.transaction(() => {
    db.prepare("UPDATE containers SET number = ?, type = ?, weight_kg = ?, comment = ? WHERE id = ?").run(next.number, next.type, next.weight_kg, next.comment, id);
    if (next.number !== c.number) log(db, c.shipment_id, user, now, "Номер контейнера", c.number, next.number);
    if (next.type !== c.type) log(db, c.shipment_id, user, now, `Тип контейнера${c.number ? ` ${c.number}` : ""}`, c.type, next.type);
    touch(db, c.shipment_id, user, now);
  })();
  return getShipment(db, c.shipment_id);
}

export function deleteContainer(db: Database.Database, user: AuthUser, id: number, now: Date = new Date()) {
  const c = getContainer(db, id);
  assertEditable(getRow(db, c.shipment_id));
  db.transaction(() => {
    db.prepare("DELETE FROM containers WHERE id = ?").run(id);
    log(db, c.shipment_id, user, now, "Контейнер", c.number ?? "без номера", "удалён");
    touch(db, c.shipment_id, user, now);
  })();
  return getShipment(db, c.shipment_id);
}

// ---------- доходы и расходы ----------

function lineValue(l: { planned_amount: number; actual_amount: number | null }): number {
  return l.actual_amount ?? l.planned_amount;
}

/** Приводит оплату к согласованному виду: статус, сумма и дата оплаты не противоречат друг другу. */
function normalizePayment(l: LineRow, today: string): void {
  const value = lineValue(l);
  if (l.payment_status === "unpaid") {
    l.paid_amount = 0;
    l.paid_at = null;
  } else if (l.payment_status === "paid") {
    if (!l.paid_amount) l.paid_amount = value;
    if (l.paid_amount !== value) fieldError("paidAmount", "У оплаченной строки сумма оплаты должна равняться сумме строки");
    l.paid_at = l.paid_at ?? today;
  } else {
    if (l.paid_amount <= 0 || l.paid_amount >= value) fieldError("paidAmount", "При частичной оплате сумма должна быть больше нуля и меньше суммы строки");
    // Дата последней оплаты нужна, чтобы деньги попали в «Оплаты клиентов» нужного периода.
    l.paid_at = l.paid_at ?? today;
  }
}

function checkLineRefs(db: Database.Database, l: LineRow): void {
  if (l.counterparty_id && !db.prepare("SELECT 1 FROM counterparties WHERE id = ?").get(l.counterparty_id)) fieldError("counterpartyId", "Контрагент не найден");
  if (l.client_id && !db.prepare("SELECT 1 FROM clients WHERE id = ?").get(l.client_id)) fieldError("clientId", "Клиент не найден");
}

function describeLine(l: LineRow): string {
  return `${l.kind === "income" ? "Доход" : "Расход"} «${l.description}»`;
}

export function addLine(db: Database.Database, user: AuthUser, shipmentId: number, input: LineInput, now: Date = new Date()) {
  const ship = getRow(db, shipmentId);
  assertEditable(ship);
  const line: LineRow = {
    id: 0,
    shipment_id: shipmentId,
    kind: input.kind!,
    counterparty_id: input.counterpartyId ?? null,
    client_id: input.clientId ?? (input.kind === "income" ? ship.client_id : null),
    description: input.description!,
    planned_amount: input.plannedAmount ?? 0,
    actual_amount: input.actualAmount ?? null,
    is_unplanned: input.isUnplanned ? 1 : 0,
    currency: "RUB",
    payment_status: input.paymentStatus ?? "unpaid",
    paid_amount: input.paidAmount ?? 0,
    due_date: input.dueDate ?? null,
    paid_at: input.paidAt ?? null,
  };
  checkLineRefs(db, line);
  normalizePayment(line, day(now));

  db.transaction(() => {
    db.prepare(
      `INSERT INTO finance_lines (shipment_id, kind, counterparty_id, client_id, description, planned_amount, actual_amount,
         is_unplanned, currency, payment_status, paid_amount, due_date, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      shipmentId, line.kind, line.counterparty_id, line.client_id, line.description, line.planned_amount, line.actual_amount,
      line.is_unplanned, line.currency, line.payment_status, line.paid_amount, line.due_date, line.paid_at,
    );
    log(db, shipmentId, user, now, describeLine(line), null, `добавлено (план ${rub(line.planned_amount)}${line.actual_amount !== null ? `, факт ${rub(line.actual_amount)}` : ""})`);
    touch(db, shipmentId, user, now);
  })();
  return getShipment(db, shipmentId);
}

function getLine(db: Database.Database, id: number): LineRow {
  const l = db.prepare("SELECT * FROM finance_lines WHERE id = ?").get(id) as LineRow | undefined;
  if (!l) throw new ApiError(404, "Строка не найдена");
  return l;
}

export function updateLine(db: Database.Database, user: AuthUser, id: number, input: LineInput, now: Date = new Date()) {
  const old = getLine(db, id);
  assertEditable(getRow(db, old.shipment_id));
  if (input.kind !== undefined && input.kind !== old.kind) fieldError("kind", "Тип строки изменить нельзя: удалите её и создайте заново");

  const next: LineRow = {
    ...old,
    counterparty_id: input.counterpartyId !== undefined ? input.counterpartyId : old.counterparty_id,
    client_id: input.clientId !== undefined ? input.clientId : old.client_id,
    description: input.description ?? old.description,
    planned_amount: input.plannedAmount ?? old.planned_amount,
    actual_amount: input.actualAmount !== undefined ? input.actualAmount : old.actual_amount,
    is_unplanned: input.isUnplanned !== undefined ? (input.isUnplanned ? 1 : 0) : old.is_unplanned,
    payment_status: input.paymentStatus ?? old.payment_status,
    paid_amount: input.paidAmount ?? old.paid_amount,
    due_date: input.dueDate !== undefined ? input.dueDate : old.due_date,
    paid_at: input.paidAt !== undefined ? input.paidAt : old.paid_at,
  };
  checkLineRefs(db, next);
  // Сумма изменилась, а оплата «полная»: подтягиваем сумму оплаты, если её не задавали отдельно
  if (next.payment_status === "paid" && input.paidAmount === undefined) next.paid_amount = 0;
  normalizePayment(next, day(now));

  const diffs: [string, string | null, string | null][] = [];
  const who = describeLine(old);
  if (next.description !== old.description) diffs.push([`${who}: название`, old.description, next.description]);
  if (next.planned_amount !== old.planned_amount) diffs.push([`${who}: плановая сумма`, rub(old.planned_amount), rub(next.planned_amount)]);
  if (next.actual_amount !== old.actual_amount) diffs.push([`${who}: фактическая сумма`, rub(old.actual_amount), rub(next.actual_amount)]);
  if (next.payment_status !== old.payment_status) diffs.push([`${who}: оплата`, PAYMENT_LABELS[old.payment_status], PAYMENT_LABELS[next.payment_status]]);
  if (next.due_date !== old.due_date) diffs.push([`${who}: срок оплаты`, old.due_date, next.due_date]);
  if (next.paid_at !== old.paid_at) diffs.push([`${who}: дата оплаты`, old.paid_at, next.paid_at]);
  if (next.counterparty_id !== old.counterparty_id) {
    const name = (cid: number | null) => (cid ? (db.prepare("SELECT name FROM counterparties WHERE id = ?").get(cid) as { name: string } | undefined)?.name ?? null : null);
    diffs.push([`${who}: контрагент`, name(old.counterparty_id), name(next.counterparty_id)]);
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE finance_lines SET counterparty_id = ?, client_id = ?, description = ?, planned_amount = ?, actual_amount = ?,
         is_unplanned = ?, payment_status = ?, paid_amount = ?, due_date = ?, paid_at = ? WHERE id = ?`,
    ).run(
      next.counterparty_id, next.client_id, next.description, next.planned_amount, next.actual_amount,
      next.is_unplanned, next.payment_status, next.paid_amount, next.due_date, next.paid_at, id,
    );
    for (const [f, o, n] of diffs) log(db, old.shipment_id, user, now, f, o, n);
    if (diffs.length > 0) touch(db, old.shipment_id, user, now);
  })();
  return getShipment(db, old.shipment_id);
}

export function deleteLine(db: Database.Database, user: AuthUser, id: number, now: Date = new Date()) {
  const l = getLine(db, id);
  assertEditable(getRow(db, l.shipment_id));
  db.transaction(() => {
    db.prepare("DELETE FROM finance_lines WHERE id = ?").run(id);
    log(db, l.shipment_id, user, now, describeLine(l), rub(lineValue(l)), "удалено");
    touch(db, l.shipment_id, user, now);
  })();
  return getShipment(db, l.shipment_id);
}

// ---------- финансовое закрытие ----------

export function closeFinance(db: Database.Database, user: AuthUser, id: number, confirmUnpaid: boolean, now: Date = new Date()) {
  const row = getRow(db, id);
  if (row.finance_closed_at) throw new ApiError(409, "Перевозка уже закрыта финансово");
  if (row.status !== "arrived" && row.status !== "cancelled") {
    throw new ApiError(422, "Закрыть финансово можно только перевозку со статусом «Прибыла» или «Отменена»");
  }
  const lines = db.prepare("SELECT * FROM finance_lines WHERE shipment_id = ?").all(id) as LineRow[];

  const noFact = lines.filter((l) => l.actual_amount === null);
  if (noFact.length > 0) {
    throw new ApiError(422, "По некоторым строкам ещё нет фактической суммы", {
      code: "missing_actual",
      lines: noFact.map((l) => ({ id: l.id, description: l.description, kind: l.kind })),
    });
  }
  const unpaid = lines.filter((l) => l.payment_status !== "paid");
  if (unpaid.length > 0 && !confirmUnpaid) {
    throw new ApiError(409, "Есть неоплаченные строки. Подтвердите закрытие, если так и должно быть", {
      code: "unpaid_lines",
      lines: unpaid.map((l) => ({ id: l.id, description: l.description, kind: l.kind, remaining: lineValue(l) - l.paid_amount })),
    });
  }

  db.transaction(() => {
    db.prepare("UPDATE shipments SET finance_closed_at = ?, status = CASE WHEN status = 'arrived' THEN 'closed' ELSE status END WHERE id = ?").run(day(now), id);
    log(db, id, user, now, FIELD_LABELS.finance_closed_at, null, day(now));
    if (row.status === "arrived") log(db, id, user, now, FIELD_LABELS.status, STATUS_LABELS.arrived, STATUS_LABELS.closed);
    touch(db, id, user, now);
  })();
  return getShipment(db, id);
}

export function reopenFinance(db: Database.Database, user: AuthUser, id: number, now: Date = new Date()) {
  const row = getRow(db, id);
  if (!row.finance_closed_at) throw new ApiError(409, "Перевозка не закрыта финансово");
  db.transaction(() => {
    db.prepare("UPDATE shipments SET finance_closed_at = NULL, status = CASE WHEN status = 'closed' THEN 'arrived' ELSE status END WHERE id = ?").run(id);
    log(db, id, user, now, FIELD_LABELS.finance_closed_at, toDay(row.finance_closed_at!), null);
    if (row.status === "closed") log(db, id, user, now, FIELD_LABELS.status, STATUS_LABELS.closed, STATUS_LABELS.arrived);
    touch(db, id, user, now);
  })();
  return getShipment(db, id);
}
