"use client";

import { useState } from "react";
import { VIZ } from "../charts";
import { Tip, niceMax, ordersWord } from "./shared";

/**
 * Накопление заказов за месяц: этот месяц против прошлого. Видно, идёт ли месяц быстрее или медленнее прошлого.
 * Нажатие на день месяца открывает заказы этого дня.
 */
export default function MonthLines({
  current,
  previous,
  label,
  previousLabel,
  selectedDay,
  onSelect,
}: {
  current: number[];
  previous: number[];
  label: string;
  previousLabel: string;
  selectedDay: number | null;
  onSelect: (day: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 360;
  const H = 190;
  const pad = { l: 30, r: 10, t: 12, b: 24 };
  const len = Math.max(current.length, previous.length, 28);
  const maxV = niceMax(Math.max(1, ...current, ...previous));
  const x = (d: number) => pad.l + ((d - 1) / (len - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) - (v / maxV) * (H - pad.t - pad.b);
  const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const active = hover ?? selectedDay;
  const ticks = [0, maxV / 2, maxV].filter((v, i, a) => a.indexOf(v) === i);
  const days = Array.from({ length: len }, (_, i) => i + 1);

  const cur = active ? current[active - 1] : undefined;
  const prev = active ? previous[active - 1] : undefined;
  const ahead = current.length > 0 && previous.length >= current.length ? current[current.length - 1] - previous[current.length - 1] : 0;

  return (
    <figure className="chart chart--tip" onMouseLeave={() => setHover(null)}>
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Накопление заказов: ${label} и ${previousLabel}`} className="chart__svg">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.axis : VIZ.grid} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill={VIZ.ink3}>
                {Math.round(t)}
              </text>
            </g>
          ))}
          <path d={path(previous)} fill="none" stroke={VIZ.muted} strokeWidth={2} strokeDasharray="4 3" />
          <path d={path(current)} fill="none" stroke={VIZ.accent} strokeWidth={2.6} strokeLinejoin="round" />
          {current.length > 0 && <circle cx={x(current.length)} cy={y(current[current.length - 1])} r={4} fill={VIZ.accent} />}
          {active && <line x1={x(active)} x2={x(active)} y1={pad.t} y2={H - pad.b} stroke="rgba(11,26,74,0.4)" strokeDasharray="2 3" />}
          {active && cur !== undefined && <circle cx={x(active)} cy={y(cur)} r={4.5} fill="#fff" stroke={VIZ.accent} strokeWidth={2} />}
          {days
            .filter((d) => d === 1 || d % 5 === 0)
            .map((d) => (
              <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="10" fill={VIZ.ink3}>
                {d}
              </text>
            ))}
          {/* области нажатия: по одной на день месяца */}
          {days.map((d) => (
            <rect
              key={d}
              x={x(d) - (W - pad.l - pad.r) / (len - 1) / 2}
              y={pad.t}
              width={(W - pad.l - pad.r) / (len - 1)}
              height={H - pad.t - pad.b}
              fill="transparent"
              tabIndex={d <= current.length ? 0 : -1}
              role={d <= current.length ? "button" : undefined}
              aria-label={`${d} число: ${label} ${current[d - 1] ?? "ещё нет"}, ${previousLabel} ${previous[d - 1] ?? "—"}`}
              onMouseEnter={() => setHover(d)}
              onFocus={() => setHover(d)}
              onBlur={() => setHover(null)}
              onClick={() => d <= current.length && onSelect(d)}
              style={{ cursor: d <= current.length ? "pointer" : "default" }}
            />
          ))}
        </svg>
        {active && (
          <Tip
            x={(x(active) / W) * 100}
            y={(y(cur ?? prev ?? 0) / H) * 100}
            title={`${active}-е число`}
            lines={[`${label}: ${cur !== undefined ? `${cur} ${ordersWord(cur)}` : "ещё нет данных"}`, `${previousLabel}: ${prev !== undefined ? `${prev} ${ordersWord(prev)}` : "—"}`]}
          />
        )}
      </div>
      <figcaption className="legend legend--inline">
        <span>
          <span className="legend__dot" style={{ background: VIZ.accent }} />
          {label}
        </span>
        <span>
          <span className="legend__dot" style={{ background: VIZ.muted }} />
          {previousLabel}
        </span>
        {previous.length >= current.length && current.length > 0 && (
          <span className={ahead >= 0 ? "pos" : "neg"}>
            {ahead === 0 ? "наравне с прошлым" : `${ahead > 0 ? "на" : "на"} ${Math.abs(ahead)} ${ahead > 0 ? "больше" : "меньше"}, чем к этому числу в прошлом месяце`}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
