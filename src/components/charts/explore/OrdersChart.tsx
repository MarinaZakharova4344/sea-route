"use client";

import { useState, type ReactNode } from "react";
import type { DayPoint, ForecastPoint } from "@/lib/overview";
import { VIZ } from "../charts";
import { Tip, dayLong, ordersWord } from "./shared";

/**
 * Заказы по дням: столбцы фактических заказов и прогноз на несколько дней вперёд (штриховые столбцы с коридором «от — до»).
 * Нажатие или наведение на день показывает подсказку, нажатие выбирает день и открывает список заказов.
 */
export default function OrdersChart({
  days,
  forecast,
  today,
  selected,
  onSelect,
  legendExtra,
  onOpen,
}: {
  days: DayPoint[];
  forecast: ForecastPoint[];
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
  /** что добавить справа в строку условных обозначений (например, кнопку «?») */
  legendExtra?: ReactNode;
  /** нажатие на подсказку выбранного дня: открыть день отдельным экраном */
  onOpen?: (date: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 300;
  const H = 330;
  const pad = { l: 30, r: 6, t: 14, b: 28 };

  // прогноз: сегодняшний день показываем «ожидаемым итогом» поверх факта, остальные дни целиком
  const future = forecast.filter((f) => f.date > today);
  const todayForecast = forecast.find((f) => f.date === today);
  const cols = [
    ...days.map((d) => ({ date: d.date, weekday: d.weekday, actual: d.count, fc: d.date === today ? todayForecast : undefined })),
    ...future.map((f) => ({ date: f.date, weekday: f.weekday, actual: null as number | null, fc: f })),
  ];

  const maxV = Math.max(4, Math.ceil((Math.max(1, ...cols.map((c) => Math.max(c.actual ?? 0, c.fc?.high ?? 0))) * 1.1) / 4) * 4);
  const innerH = H - pad.t - pad.b;
  const y = (v: number) => pad.t + innerH - (v / maxV) * innerH;
  const slot = (W - pad.l - pad.r) / cols.length;
  const bw = Math.max(3, Math.min(22, slot * 0.7));
  const cx = (i: number) => pad.l + slot * i + slot / 2;
  const every = cols.length > 40 ? 7 : cols.length > 24 ? 4 : 2;
  const todayIndex = cols.findIndex((c) => c.date === today);
  const ticks = [0, maxV / 2, maxV].filter((v, i, a) => a.indexOf(v) === i);

  const active = hover ?? selected;
  const idx = cols.findIndex((c) => c.date === active);
  const act = idx >= 0 ? cols[idx] : null;
  const isFuture = (c: { actual: number | null }) => c.actual === null;

  return (
    <figure className="chart chart--tip" onMouseLeave={() => setHover(null)}>
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Заказы по дням: факт и прогноз" className="chart__svg">
          <defs>
            <pattern id="fc-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill="rgba(242,140,40,0.12)" />
              <line x1="0" y1="0" x2="0" y2="5" stroke="#f28c28" strokeWidth="2" opacity="0.7" />
            </pattern>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.axis : VIZ.grid} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill={VIZ.ink3}>
                {Math.round(t)}
              </text>
            </g>
          ))}

          {cols.map((c, i) => {
            const weekend = c.weekday === 0 || c.weekday === 6;
            const on = c.date === active;
            const sel = c.date === selected;
            const isToday = c.date === today;
            const x = cx(i) - bw / 2;
            return (
              <g
                key={c.date}
                className="chart__col"
                tabIndex={0}
                role="button"
                aria-label={`${dayLong(c.date, c.weekday)}: ${isFuture(c) ? "прогноз" : "заказов"} ${isFuture(c) ? c.fc?.expected : c.actual}`}
                onMouseEnter={() => setHover(c.date)}
                onFocus={() => setHover(c.date)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect(c.date)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(c.date))}
              >
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={innerH} fill={on ? "rgba(11,26,74,0.07)" : weekend ? "rgba(11,26,74,0.035)" : "transparent"} />
                {/* фактические заказы */}
                {!isFuture(c) && (c.actual ?? 0) > 0 && <rect x={x} y={y(c.actual!)} width={bw} height={y(0) - y(c.actual!)} rx={2} fill={isToday ? "#6a84b6" : "#061a44"} />}
                {/* ожидаемый итог сегодняшнего дня и прогноз на будущее */}
                {c.fc && (
                  <>
                    <rect x={x} y={y(c.fc.expected)} width={bw} height={Math.max(0, y(0) - y(c.fc.expected))} rx={2} fill="url(#fc-hatch)" stroke={VIZ.accent} strokeDasharray="3 2" strokeWidth={1.2} />
                    <line x1={cx(i)} x2={cx(i)} y1={y(c.fc.high)} y2={y(c.fc.low)} stroke={VIZ.accent} strokeWidth={1.6} />
                    <line x1={cx(i) - 3} x2={cx(i) + 3} y1={y(c.fc.high)} y2={y(c.fc.high)} stroke={VIZ.accent} strokeWidth={1.6} />
                    <line x1={cx(i) - 3} x2={cx(i) + 3} y1={y(c.fc.low)} y2={y(c.fc.low)} stroke={VIZ.accent} strokeWidth={1.6} />
                  </>
                )}
                {sel && <rect x={pad.l + slot * i + 1} y={pad.t} width={slot - 2} height={innerH} fill="none" stroke="#0b1a4a" strokeWidth={1.4} rx={3} />}
                {isToday && <circle cx={cx(i)} cy={H - 20} r={2.5} fill="#0b1a4a" />}
                {((i % every === 0 && Math.abs(i - todayIndex) > 1) || isToday) && (
                  <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill={on || isToday ? "#0b1a4a" : VIZ.ink3}>
                    {c.date.slice(8, 10)}.{c.date.slice(5, 7)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {act && (
          <Tip
            x={(cx(idx) / W) * 100}
            y={(y(Math.max(act.actual ?? 0, act.fc?.high ?? 0)) / H) * 100}
            onClick={onOpen ? () => onOpen(act.date) : undefined}
            title={`${dayLong(act.date, act.weekday)}${act.date === today ? " (сегодня)" : ""}`}
            lines={
              isFuture(act)
                ? [`Прогноз: около ${Math.round(act.fc!.expected)} ${ordersWord(Math.round(act.fc!.expected))}`, `Вероятный коридор: ${Math.round(act.fc!.low)}–${Math.round(act.fc!.high)}`, ...(onOpen ? ["Подробнее ›"] : [])]
                : [`Поступило: ${act.actual} ${ordersWord(act.actual ?? 0)}`, ...(act.fc ? [`Ожидается за день: около ${Math.round(act.fc.expected)}`] : []), ...(onOpen ? ["Подробнее ›"] : [])]
            }
          />
        )}
      </div>
      <figcaption className="legend legend--inline">
        <span>
          <span className="legend__dot" style={{ background: "#061a44" }} />
          Поступило
        </span>
        <span>
          <span className="legend__dot legend__dot--hatch" />
          Прогноз и коридор
        </span>
        {legendExtra}
      </figcaption>
    </figure>
  );
}

