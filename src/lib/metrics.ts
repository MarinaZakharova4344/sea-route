/**
 * Расчёт показателей по одной перевозке. Чистые функции без доступа к базе:
 * так их легко проверять тестами. Правила описаны в docs/calculations.md.
 */
import { diffDays, toDay } from "./dates";

export type ShipmentStatus = "draft" | "booked" | "in_transit" | "arrived" | "closed" | "cancelled";

export interface ShipmentInput {
  status: ShipmentStatus;
  clientId: number | null;
  directionId: number | null;
  cargoDescription: string | null;
  plannedDeparture: string | null;
  plannedArrival: string | null;
  actualArrival: string | null;
  financeClosedAt: string | null;
  updatedAt: string;
  containers: { number: string | null }[];
}

export interface LineInput {
  kind: "income" | "expense";
  plannedAmount: number;
  actualAmount: number | null;
  paymentStatus: "unpaid" | "partial" | "paid";
  dueDate: string | null;
}

export interface Thresholds {
  delayDays: number;
  overrunPct: number;
  staleDays: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { delayDays: 2, overrunPct: 10, staleDays: 5 };

export type ReasonCode = "delay" | "overrun" | "overdue_payment" | "missing_fields" | "stale";

export interface Reason {
  code: ReasonCode;
  text: string;
}

export interface ShipmentMetrics {
  revenue: number;
  cost: number;
  margin: number;
  isPreliminary: boolean;
  resultDate: string | null;
  delayDays: number;
  overrunPct: number;
  hasOverduePayment: boolean;
  staleDays: number;
  missingFields: string[];
  attentionReasons: Reason[];
}

/** Статусы, в которых перевозка «в работе» и от менеджера ожидаются обновления. */
const ACTIVE: ShipmentStatus[] = ["booked", "in_transit", "arrived"];

/** Сумма строки: факт, если он есть, иначе план. */
export function lineValue(line: LineInput): number {
  return line.actualAmount ?? line.plannedAmount;
}

export function missingFields(s: ShipmentInput): string[] {
  const missing: string[] = [];
  if (s.clientId === null) missing.push("Клиент");
  if (s.directionId === null) missing.push("Направление");
  if (!s.cargoDescription) missing.push("Груз");
  if (!s.plannedDeparture) missing.push("Плановая дата отправления");
  if (!s.plannedArrival) missing.push("Плановая дата прибытия");
  if (s.containers.length === 0) {
    missing.push("Контейнеры");
  } else if (["in_transit", "arrived", "closed"].includes(s.status) && s.containers.some((c) => !c.number)) {
    missing.push("Номера контейнеров");
  }
  return missing;
}

export function computeShipmentMetrics(
  s: ShipmentInput,
  lines: LineInput[],
  today: string,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ShipmentMetrics {
  const income = lines.filter((l) => l.kind === "income");
  const expenses = lines.filter((l) => l.kind === "expense");

  const revenue = income.reduce((sum, l) => sum + lineValue(l), 0);
  const cost = expenses.reduce((sum, l) => sum + lineValue(l), 0);

  // Окончательный результат только после финансового закрытия и когда по всем строкам есть факт.
  // У отменённой перевозки закрывать нечего: берём то, что уже случилось.
  const allActual = lines.every((l) => l.actualAmount !== null);
  const isPreliminary =
    s.status === "cancelled" ? !allActual : s.financeClosedAt === null || !allActual;

  const resultDate = s.status === "cancelled" ? toDay(s.updatedAt) : s.actualArrival;

  // Задержка: фактическое опоздание или, если груз ещё не прибыл, сколько дней прошло после плана.
  let delayDays = 0;
  if (s.plannedArrival) {
    if (s.actualArrival) delayDays = Math.max(0, diffDays(s.plannedArrival, s.actualArrival));
    else if (s.status === "booked" || s.status === "in_transit") delayDays = Math.max(0, diffDays(s.plannedArrival, today));
  }

  // Перерасход: насколько фактические расходы превысили план (внеплановые считаются целиком).
  const known = expenses.filter((l) => l.actualAmount !== null);
  const plannedKnown = known.reduce((sum, l) => sum + l.plannedAmount, 0);
  const actualKnown = known.reduce((sum, l) => sum + (l.actualAmount ?? 0), 0);
  const overrunPct = plannedKnown > 0 ? Math.round(((actualKnown - plannedKnown) / plannedKnown) * 1000) / 10 : 0;

  // Просрочка оплаты: счёт выставлен (есть факт), не оплачен полностью, срок прошёл.
  const hasOverduePayment = lines.some(
    (l) => l.actualAmount !== null && l.paymentStatus !== "paid" && l.dueDate !== null && toDay(l.dueDate) < today,
  );

  const isActive = ACTIVE.includes(s.status);
  const staleDays = Math.max(0, diffDays(s.updatedAt, today));
  const missing = missingFields(s);

  const reasons: Reason[] = [];
  if ((s.status === "booked" || s.status === "in_transit") && delayDays > thresholds.delayDays) {
    reasons.push({ code: "delay", text: `Опоздание ${delayDays} дн.` });
  }
  const live = s.status !== "draft" && s.status !== "cancelled" && s.financeClosedAt === null;
  if (live && overrunPct > thresholds.overrunPct) {
    reasons.push({ code: "overrun", text: `Перерасход ${overrunPct} % от плана` });
  }
  if (s.status !== "draft" && hasOverduePayment) {
    reasons.push({ code: "overdue_payment", text: "Просрочена оплата" });
  }
  if (s.status !== "draft" && s.status !== "cancelled" && missing.length > 0) {
    reasons.push({ code: "missing_fields", text: `Не заполнено: ${missing.join(", ")}` });
  }
  if (isActive && staleDays > thresholds.staleDays) {
    reasons.push({ code: "stale", text: `Не обновлялась ${staleDays} дн.` });
  }

  return {
    revenue,
    cost,
    margin: revenue - cost,
    isPreliminary,
    resultDate,
    delayDays,
    overrunPct,
    hasOverduePayment,
    staleDays: isActive ? staleDays : 0,
    missingFields: missing,
    attentionReasons: reasons,
  };
}
