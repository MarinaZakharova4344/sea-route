"use client";

import type { Bucket } from "@/lib/analytics/overview";

const TONES: Record<string, string> = { good: "#1e9e6a", warn: "#f2a33a", bad: "#d64545", neutral: "#4f86d9" };

/**
 * Горизонтальные столбцы: подпись, столбец, значение. Нажатие на строку выбирает её (открывает перевозки) или ведёт по ссылке.
 * Длина столбца пропорциональна значению (число или сумма).
 */
export default function BarList({
  buckets,
  selected,
  onSelect,
  value,
  format,
  sub,
}: {
  buckets: Bucket[];
  selected: string | null;
  onSelect: (key: string) => void;
  value: (b: Bucket) => number;
  format: (b: Bucket) => string;
  sub?: (b: Bucket) => string | undefined;
}) {
  const max = Math.max(1, ...buckets.map(value));
  return (
    <ul className="blist">
      {buckets.map((b) => (
        <li key={b.key}>
          <button type="button" className={`blist__row${selected === b.key ? " blist__row--on" : ""}`} onClick={() => onSelect(b.key)} aria-pressed={selected === b.key}>
            <span className="blist__label">
              {b.label}
              {sub?.(b) && <small>{sub(b)}</small>}
            </span>
            <span className="blist__track">
              <span className="blist__bar" style={{ width: `${Math.max(value(b) > 0 ? 2 : 0, (value(b) / max) * 100)}%`, background: TONES[b.tone ?? "neutral"] }} />
            </span>
            <span className="blist__value">{format(b)}</span>
            <span className="blist__chev" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
