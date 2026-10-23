"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VIZ, axisMoney } from "../charts";
import { Tip, niceMax } from "./shared";

export interface Step {
  key: string;
  label: string;
  /** итог (столбец от нуля) или изменение (плавает над предыдущим) */
  kind: "total" | "delta";
  value: number;
  href?: string;
  hint?: string;
}

/**
 * «Мост»: как из одной суммы получилась другая (водопад). Итоги стоят на нулевой линии,
 * изменения висят между предыдущим и следующим значением. Нажатие на столбец ведёт к перевозкам за ним.
 */
export default function Waterfall({ steps, ariaLabel }: { steps: Step[]; ariaLabel: string }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const W = 360;
  const H = 220;
  const pad = { l: 8, r: 8, t: 26, b: 40 };

  let run = 0;
  const bars = steps.map((s) => {
    const from = s.kind === "total" ? 0 : run;
    const to = s.kind === "total" ? s.value : run + s.value;
    run = to;
    return { s, from, to };
  });
  const lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to]));
  const hi = Math.max(0, ...bars.flatMap((b) => [b.from, b.to]));
  const top = hi > 0 ? niceMax(hi) : 0;
  const span = Math.max(1, top - lo);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / span);
  const slot = (W - pad.l - pad.r) / steps.length;
  const bw = Math.min(54, slot - 14);
  const colour = (s: Step) => (s.kind === "total" ? VIZ.soft : s.value >= 0 ? VIZ.strong : VIZ.negative);
  const active = bars.find((b) => b.s.key === hover);

  return (
    <figure className="chart chart--tip" onMouseLeave={() => setHover(null)}>
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="chart__svg">
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke={VIZ.axis} />
          {bars.map((b, i) => {
            const cx = pad.l + slot * i + slot / 2;
            const yTop = y(Math.max(b.from, b.to));
            const yBot = y(Math.min(b.from, b.to));
            const next = bars[i + 1];
            const words = b.s.label.split(" ");
            const mid = Math.ceil(words.length / 2);
            const lines = words.length > 2 ? [words.slice(0, mid).join(" "), words.slice(mid).join(" ")] : [b.s.label];
            return (
              <g key={b.s.key}>
                {next && <line x1={cx + bw / 2} x2={cx + slot - bw / 2} y1={y(b.to)} y2={y(b.to)} stroke={VIZ.axis} strokeDasharray="2 3" />}
                <rect
                  x={cx - bw / 2}
                  y={yTop}
                  width={bw}
                  height={Math.max(2, yBot - yTop)}
                  rx={4}
                  fill={colour(b.s)}
                  opacity={hover && hover !== b.s.key ? 0.55 : 1}
                  tabIndex={0}
                  role={b.s.href ? "link" : "img"}
                  aria-label={`${b.s.label}: ${axisMoney(b.s.value)} ₽`}
                  style={{ cursor: b.s.href ? "pointer" : "default", outline: "none" }}
                  onMouseEnter={() => setHover(b.s.key)}
                  onFocus={() => setHover(b.s.key)}
                  onBlur={() => setHover(null)}
                  onClick={() => b.s.href && router.push(b.s.href)}
                  onKeyDown={(e) => e.key === "Enter" && b.s.href && router.push(b.s.href)}
                />
                <text x={cx} y={yTop - 6} textAnchor="middle" fontSize="11.5" fontWeight={700} fill="#0b1a4a">
                  {b.s.kind === "delta" && b.s.value > 0 ? "+" : ""}
                  {axisMoney(b.s.value)}
                </text>
                {lines.map((t, k) => (
                  <text key={k} x={cx} y={H - pad.b + 14 + k * 12} textAnchor="middle" fontSize="10.5" fill={VIZ.ink3}>
                    {t}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
        {active && (
          <Tip
            x={((pad.l + slot * bars.indexOf(active) + slot / 2) / W) * 100}
            y={(y(Math.max(active.from, active.to)) / H) * 100}
            title={active.s.label}
            lines={[`${active.s.kind === "delta" && active.s.value > 0 ? "+" : ""}${axisMoney(active.s.value)} ₽`, ...(active.s.hint ? [active.s.hint] : []), ...(active.s.href ? ["Нажмите, чтобы увидеть перевозки"] : [])]}
          />
        )}
      </div>
    </figure>
  );
}
