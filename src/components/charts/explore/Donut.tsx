"use client";

import { useState } from "react";
import type { Bucket } from "@/lib/overview";

const COLORS: Record<string, string> = {
  draft: "#9aa9c4",
  booked: "#4f86d9",
  in_transit: "#f2a33a",
  arrived: "#e07a1f",
  closed: "#1e9e6a",
  cancelled: "#d64545",
};

/** Кольцо по статусам перевозок: доля каждого статуса. Нажатие на сектор или строку списка открывает перевозки в этом статусе. */
export default function Donut({ buckets, selected, onSelect }: { buckets: Bucket[]; selected: string | null; onSelect: (key: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const R = 62;
  const r = 40;
  const cx = 80;
  const cy = 80;
  let angle = -Math.PI / 2;
  const arcs = buckets
    .filter((b) => b.count > 0)
    .map((b) => {
      const a0 = angle;
      const a1 = angle + (b.count / total) * Math.PI * 2 - (buckets.filter((x) => x.count > 0).length > 1 ? 0.02 : 0);
      angle += (b.count / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad: number, a: number) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
      return { b, d: `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z` };
    });
  const act = buckets.find((b) => b.key === (hover ?? selected));

  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" className="donut__svg" role="img" aria-label="Перевозки по статусам">
        {arcs.map(({ b, d }) => (
          <path
            key={b.key}
            d={d}
            fill={COLORS[b.key]}
            opacity={act && act.key !== b.key ? 0.45 : 1}
            stroke={selected === b.key ? "#0b1a4a" : "none"}
            strokeWidth={2}
            tabIndex={0}
            role="button"
            aria-label={`${b.label}: ${b.count}`}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(b.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(b.key)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(b.key)}
          />
        ))}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="22" fontWeight="700" fill="#0b1a4a">
          {act ? act.count : total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9.5" fill="#5b6b8c">
          {act ? act.label.toLowerCase() : "перевозок"}
        </text>
      </svg>
      <ul className="donut__legend">
        {buckets.map((b) => (
          <li key={b.key}>
            <button
              type="button"
              className={`donut__item${selected === b.key ? " donut__item--on" : ""}`}
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(b.key)}
            >
              <span className="legend__dot" style={{ background: COLORS[b.key] }} />
              <span>{b.label}</span>
              <strong>{b.count}</strong>
              <small>{total ? Math.round((b.count / total) * 100) : 0}%</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
