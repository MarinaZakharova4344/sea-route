"use client";

import { useEffect, useRef, useState } from "react";
import { VIZ, axisMoney } from "./charts";

export interface Column {
  label: string;
  value: number;
  tone: "current" | "previous";
  /** Подсказка при наведении или нажатии. */
  tip: { title: string; lines: string[] };
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Столбик со скруглением только у свободного края, основание ровное. */
function rounded(x: number, y: number, w: number, h: number, r: number, up: boolean): string {
  const rr = Math.min(r, h, w / 2);
  return up
    ? `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
    : `M${x},${y} H${x + w} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x + rr} Q${x},${y + h} ${x},${y + h - rr} Z`;
}

/**
 * Столбчатый график по неделям. Подсказка с суммой и числом перевозок появляется при наведении мыши,
 * при нажатии (на телефоне) и при выборе столбика с клавиатуры.
 */
export default function ColumnChart({ columns, ariaLabel }: { columns: Column[]; ariaLabel: string }) {
  const W = 360;
  const H = 230;
  const pad = { l: 50, r: 6, t: 10, b: 26 };
  const [active, setActive] = useState<number | null>(null);
  const figure = useRef<HTMLElement>(null);

  // Подсказка закрывается нажатием вне графика (на телефоне нет «ухода курсора»).
  useEffect(() => {
    if (active === null) return;
    const close = (e: Event) => {
      if (figure.current && !figure.current.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [active]);

  const max = niceMax(Math.max(0, ...columns.map((c) => c.value)));
  const min = Math.min(0, ...columns.map((c) => c.value));
  const lo = min < 0 ? -niceMax(-min) : 0;
  const innerH = H - pad.t - pad.b;
  const y = (v: number) => pad.t + innerH - ((v - lo) / (max - lo)) * innerH;
  const zero = y(0);
  const slot = (W - pad.l - pad.r) / columns.length;
  const bw = Math.min(28, slot * 0.62);
  const ticks = [lo, lo + (max - lo) / 4, lo + ((max - lo) * 2) / 4, lo + ((max - lo) * 3) / 4, max].filter((v, i, a) => a.indexOf(v) === i);
  const every = columns.length > 8 ? 2 : 1;

  const cx = (i: number) => pad.l + slot * i + slot / 2;
  const act = active === null ? null : columns[active];
  const tipLeft = active === null ? 0 : (cx(active) / W) * 100;
  const tipTop = act ? (Math.min(y(act.value), zero) / H) * 100 : 0;
  const align = tipLeft < 22 ? "left" : tipLeft > 78 ? "right" : "center";

  return (
    <figure ref={figure} className="chart chart--tip" onMouseLeave={() => setActive(null)}>
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="chart__svg">
          <defs>
            <linearGradient id="col-current" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFB878" />
              <stop offset="1" stopColor="#F07F34" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.axis : VIZ.grid} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill={VIZ.ink3}>
                {axisMoney(t)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const x = pad.l + slot * i + (slot - bw) / 2;
            const top = Math.min(y(c.value), zero);
            const h = Math.max(Math.abs(y(c.value) - zero), c.value === 0 ? 0 : 2);
            const on = active === i;
            return (
              <g
                key={i}
                className="chart__col"
                tabIndex={0}
                role="button"
                aria-label={`${c.tip.title}: ${c.tip.lines.join(", ")}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                onClick={() => setActive(i)}
                onKeyDown={(e) => e.key === "Escape" && setActive(null)}
              >
                {/* область наведения шире столбика и на всю высоту */}
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={innerH} fill={on ? "rgba(255,255,255,0.07)" : "transparent"} />
                {h > 0 && <path d={rounded(x, top, bw, h, 4, c.value >= 0)} fill={c.tone === "current" ? "url(#col-current)" : VIZ.muted} opacity={active === null || on ? 1 : 0.55} />}
                {i % every === 0 && (
                  <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10.5" fill={on ? "#fff" : VIZ.ink2}>
                    {c.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {act && (
          <div className={`tip tip--${align}`} style={{ left: `${tipLeft}%`, top: `${tipTop}%` }} role="tooltip">
            <strong>{act.tip.title}</strong>
            {act.tip.lines.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
        )}
      </div>
      <figcaption className="legend legend--inline">
        <span>
          <span className="legend__dot" style={{ background: VIZ.accent }} />
          Выбранный период
        </span>
        <span>
          <span className="legend__dot" style={{ background: VIZ.muted }} />
          Предыдущий период
        </span>
      </figcaption>
    </figure>
  );
}
