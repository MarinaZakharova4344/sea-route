/** Форматирование для экранов: суммы, даты, время. */

import { toDay } from "./dates";

const nbsp = " ";

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toLocaleString("ru-RU").replace(/\s/g, nbsp)}${nbsp}₽`;
}

/** 1 250 000 ₽ → «1,25 млн ₽»: для крупных итогов на узких экранах. */
export function formatMoneyShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2).replace(".", ",")}${nbsp}млн${nbsp}₽`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}${nbsp}тыс.${nbsp}₽`;
  return formatMoney(value);
}

/** 2026-10-20 → 20.10.2026; момент времени с «Z» переводится в день по часовому поясу компании. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = toDay(value).split("-");
  return `${d}.${m}.${y}`;
}

/** 2026-10-20T14:05:00Z → 20.10.2026, 14:05 (в часовом поясе компьютера пользователя). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  const date = d.toLocaleDateString("ru-RU");
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

/** Склонение по числу: plural(2, ["заказ", "заказа", "заказов"]) → «заказа». */
export function plural(n: number, forms: [string, string, string]): string {
  const last = Math.abs(n) % 10;
  const tens = Math.abs(n) % 100;
  return last === 1 && tens !== 11 ? forms[0] : last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? forms[1] : forms[2];
}

/** Число с десятичной запятой: 19.1 → 19,1. */
export const ruNumber = (value: number): string => String(value).replace(".", ",");

export function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(".", ",").replace(",0", "").replace("-", "−")}${nbsp}%`;
}
