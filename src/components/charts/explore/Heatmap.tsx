"use client";

import { useState } from "react";
import type { DayPoint } from "@/lib/analytics/overview";
import { dayLong, ordersWord } from "./shared";

const HEAD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/**
 * Тепловая карта: недели по вертикали, дни недели по горизонтали, цвет и число показывают, сколько заказов поступило.
 * Помогает увидеть, в какие дни заказов больше. Нажатие на ячейку открывает список заказов этого дня.
 */
export default function Heatmap({ days, today, selected, onSelect }: { days: DayPoint[]; today: string; selected: string | null; onSelect: (date: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const byDate = new Map(days.map((d) => [d.date, d]));
  // недели, начиная с понедельника первого дня окна
  const first = days[0];
  const offset = (first.weekday + 6) % 7; // сколько дней назад был понедельник
  const startMs = Date.parse(`${first.date}T00:00:00Z`) - offset * 86_400_000;
  const weeks = Math.ceil((offset + days.length) / 7);
  const max = Math.max(1, ...days.map((d) => d.count));
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const hovered = hover ? byDate.get(hover) : null;
  return (
    <div className="heat chart--tip" onMouseLeave={() => setHover(null)}>
      <div className="heat__head" aria-hidden="true">
        <span />
        {HEAD.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      {Array.from({ length: weeks }, (_, w) => {
        const rowStart = startMs + w * 7 * 86_400_000;
        return (
          <div className="heat__row" key={w}>
            <span className="heat__label">{iso(rowStart).slice(8, 10)}.{iso(rowStart).slice(5, 7)}</span>
            {Array.from({ length: 7 }, (_, d) => {
              const date = iso(rowStart + d * 86_400_000);
              const day = byDate.get(date);
              if (!day) return <span className="heat__cell heat__cell--empty" key={d} />;
              const level = day.count / max;
              const weekend = day.weekday === 0 || day.weekday === 6;
              return (
                <button
                  type="button"
                  key={d}
                  className={`heat__cell${date === selected ? " heat__cell--sel" : ""}${date === today ? " heat__cell--today" : ""}${weekend ? " heat__cell--weekend" : ""}`}
                  style={{ background: day.count === 0 ? undefined : `rgba(31, 95, 191, ${0.18 + level * 0.7})` }}
                  onMouseEnter={() => setHover(date)}
                  onFocus={() => setHover(date)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect(date)}
                  aria-label={`${dayLong(day.date, day.weekday)}: ${day.count} ${ordersWord(day.count)}`}
                >
                  {day.count}
                </button>
              );
            })}
          </div>
        );
      })}
      {hovered && (
        <div className="heat__tip" role="tooltip">
          <strong>{dayLong(hovered.date, hovered.weekday)}</strong> · {hovered.count} {ordersWord(hovered.count)}
        </div>
      )}
      <p className="heat__scale">
        <span>меньше</span>
        <span className="heat__ramp" aria-hidden="true" />
        <span>больше</span>
      </p>
    </div>
  );
}

