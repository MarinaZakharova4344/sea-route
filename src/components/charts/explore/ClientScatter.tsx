"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VIZ, axisMoney } from "../charts";
import { Tip, niceMax } from "./shared";

export interface Dot {
  key: string;
  name: string;
  revenue: number;
  marginPct: number;
  count: number;
  href?: string;
}

/**
 * Кто зарабатывает, а кто только «крутит оборот»: по горизонтали оборот, по вертикали маржа в процентах,
 * размер точки — число перевозок. Пунктир — средняя маржа. Точки ниже пунктира и правее — «много оборота, мало денег».
 */
export default function ClientScatter({ dots, avgPct, ariaLabel }: { dots: Dot[]; avgPct: number; ariaLabel: string }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const W = 360;
  const H = 250;
  const pad = { l: 38, r: 14, t: 14, b: 34 };
  // оси не обязаны начинаться с нуля: точки должны разойтись, иначе все сольются в одно пятно
  const revs = dots.map((d) => d.revenue);
  const rawMin = Math.min(...revs);
  const rawMax = Math.max(1, ...revs);
  const step = niceMax((rawMax - rawMin) / 3 || rawMax) / 2;
  const minX = rawMin / rawMax > 0.5 ? Math.max(0, Math.floor((rawMin * 0.9) / step) * step) : 0;
  const maxX = Math.ceil((rawMax * 1.08) / step) * step;
  const pcts = dots.map((d) => d.marginPct);
  const yLow = Math.min(...pcts, avgPct);
  const yHigh = Math.max(...pcts, avgPct);
  const minY = yLow >= 5 ? Math.floor((yLow - 2) / 2) * 2 : Math.min(0, Math.floor(yLow / 5) * 5);
  const maxY = Math.max(minY + 6, Math.ceil((yHigh + 2) / 2) * 2);
  const x = (v: number) => pad.l + ((v - minX) / (maxX - minX)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - minY) / (maxY - minY));
  const maxCount = Math.max(1, ...dots.map((d) => d.count));
  const r = (c: number) => 5 + (c / maxCount) * 9;
  const tone = (d: Dot) => (d.marginPct < avgPct * 0.5 ? VIZ.negative : d.marginPct >= avgPct ? VIZ.strong : VIZ.pending);
  const yTicks = [minY, Math.round((minY + maxY) / 2), maxY].filter((v, i, a) => a.indexOf(v) === i);
  const xTicks = [minX, (minX + maxX) / 2, maxX];
  const active = dots.find((d) => d.key === hover);
  // подписываем только те точки, чьи подписи не налезают друг на друга; сначала самые важные (крупные и слабые по марже)
  const labelled = new Set<string>();
  const placed: { px: number; py: number }[] = [];
  [...dots]
    .sort((a, b) => Number(b.marginPct < avgPct * 0.5) - Number(a.marginPct < avgPct * 0.5) || b.revenue - a.revenue)
    .forEach((d) => {
      const px = x(d.revenue);
      const py = y(d.marginPct);
      if (placed.length < 5 && placed.every((q) => Math.abs(q.px - px) > 70 || Math.abs(q.py - py) > 13)) {
        placed.push({ px, py });
        labelled.add(d.key);
      }
    });

  return (
    <figure className="chart chart--tip" onMouseLeave={() => setHover(null)}>
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="chart__svg">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.axis : VIZ.grid} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill={VIZ.ink3}>
                {t}%
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={t} x={x(t)} y={H - 12} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize="10.5" fill={VIZ.ink3}>
              {t === 0 ? "0" : axisMoney(t)}
            </text>
          ))}
          <line x1={pad.l} x2={W - pad.r} y1={y(avgPct)} y2={y(avgPct)} stroke={VIZ.accent} strokeDasharray="4 3" strokeWidth={1.5} />
          <text x={pad.l + 4} y={y(avgPct) + 13} textAnchor="start" fontSize="10.5" fill={VIZ.accent}>
            в среднем {avgPct.toFixed(1).replace(".", ",")}%
          </text>
          {dots.map((d) => (
            <g key={d.key}>
              <circle
                cx={x(d.revenue)}
                cy={y(d.marginPct)}
                r={r(d.count)}
                fill={tone(d)}
                fillOpacity={hover && hover !== d.key ? 0.4 : 0.9}
                stroke="#fff"
                strokeWidth={2}
                tabIndex={0}
                role={d.href ? "link" : "img"}
                aria-label={`${d.name}: оборот ${axisMoney(d.revenue)} ₽, маржа ${d.marginPct.toFixed(1)}%`}
                style={{ cursor: d.href ? "pointer" : "default", outline: "none" }}
                onMouseEnter={() => setHover(d.key)}
                onFocus={() => setHover(d.key)}
                onBlur={() => setHover(null)}
                onClick={() => d.href && router.push(d.href)}
                onKeyDown={(e) => e.key === "Enter" && d.href && router.push(d.href)}
              />
              {labelled.has(d.key) && (
                <text x={x(d.revenue) + (x(d.revenue) > W - 90 ? -r(d.count) - 3 : r(d.count) + 3)} y={y(d.marginPct) + 4} textAnchor={x(d.revenue) > W - 90 ? "end" : "start"} fontSize="10.5" fill="#0b1a4a" pointerEvents="none">
                  {d.name.replace(/^(ООО|ТД|АО|ИП)\s*/, "").replace(/[«»"]/g, "").slice(0, 14)}
                </text>
              )}
            </g>
          ))}
        </svg>
        {active && (
          <Tip
            x={(x(active.revenue) / W) * 100}
            y={(y(active.marginPct) / H) * 100}
            title={active.name}
            lines={[`Оборот ${axisMoney(active.revenue)} ₽`, `Маржа ${active.marginPct.toFixed(1).replace(".", ",")}%`, `Перевозок: ${active.count}`, ...(active.href ? ["Нажмите, чтобы открыть"] : [])]}
          />
        )}
      </div>
      <figcaption className="legend legend--inline">
        <span>
          <span className="legend__dot" style={{ background: VIZ.strong }} />
          выше средней
        </span>
        <span>
          <span className="legend__dot" style={{ background: VIZ.pending }} />
          ниже средней
        </span>
        <span>
          <span className="legend__dot" style={{ background: VIZ.negative }} />
          меньше половины средней
        </span>
        <span>размер точки — число перевозок</span>
      </figcaption>
    </figure>
  );
}
