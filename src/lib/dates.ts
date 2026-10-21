/** Работа с датами формата YYYY-MM-DD. «Сегодня» и дата момента времени считаются в часовом поясе компании. */

/**
 * Часовой пояс компании (переменная APP_TIMEZONE, по умолчанию Москва). От него зависит, какой день считать
 * «сегодняшним»: в 01:30 по Москве по UTC ещё вчера, и сроки, просрочки и «не обновлялась N дн.» сдвинулись бы на день.
 */
function resolveTimeZone(): string {
  const tz = process.env.APP_TIMEZONE?.trim() || "Europe/Moscow";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const TIME_ZONE = resolveTimeZone();
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Дата момента времени в часовом поясе компании: ГГГГ-ММ-ДД. */
export function localDay(date: Date): string {
  return dayFormat.format(date);
}

/** Дата из значения: простая дата остаётся как есть, момент времени (с временем) переводится в часовой пояс компании. */
export function toDay(value: string): string {
  if (value.length > 10) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return localDay(d);
  }
  return value.slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return localDay(now);
}

/** Сколько целых дней от `from` до `to` (положительное, если `to` позже). */
export function diffDays(from: string, to: string): number {
  const a = Date.parse(`${toDay(from)}T00:00:00Z`);
  const b = Date.parse(`${toDay(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
