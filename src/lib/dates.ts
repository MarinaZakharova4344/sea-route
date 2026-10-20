/** Работа с датами формата YYYY-MM-DD без часовых поясов. */

export function toDay(value: string): string {
  return value.slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Сколько целых дней от `from` до `to` (положительное, если `to` позже). */
export function diffDays(from: string, to: string): number {
  const a = Date.parse(`${toDay(from)}T00:00:00Z`);
  const b = Date.parse(`${toDay(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
