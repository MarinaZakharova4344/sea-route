/**
 * Графики для экранов руководителя. Серверные компоненты без JavaScript в браузере.
 * Цвета: один оттенок синего для величин, серый для контекста, красный и синий для знака изменения.
 * Подсказки при наведении даёт <title>; все цифры дублируются подписями или таблицей рядом с графиком.
 */
import { formatMoney } from "@/lib/format";

export const VIZ = {
  /** текущий период и рост: бирюзовый */
  main: "#5FD0B5",
  /** главный показатель (маржа): мятный */
  strong: "#6FD6A8",
  /** второстепенный показатель (оборот): синий */
  soft: "#3E7DB0",
  /** предварительные суммы: янтарный */
  pending: "#FFC37A",
  /** контекст: предыдущий период */
  muted: "rgba(169, 193, 232, 0.4)",
  grid: "rgba(169, 193, 232, 0.12)",
  axis: "rgba(169, 193, 232, 0.35)",
  ink2: "#c4d0ec",
  ink3: "#93A8C8",
  negative: "#FF8A7A",
  /** акцент графика динамики: оранжевый */
  accent: "#FF9F4A",
};

/** 1 250 000 → «1,25 млн», 800 000 → «800 тыс.»: компактные подписи осей. */
export function axisMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(".", ",")} млн`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} тыс.`;
  return `${sign}${Math.round(abs)}`;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

// ---------- Горизонтальный сегментированный индикатор ----------

export interface Segment {
  label: string;
  value: number;
  color: string;
}

/** Одна полоса из частей целого (например, окончательная и предварительная маржа). */
export function SegmentedBar({ segments, format = formatMoney }: { segments: Segment[]; format?: (n: number) => string }) {
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0);
  return (
    <div>
      <div className="seg" role="img" aria-label={segments.map((s) => `${s.label}: ${format(s.value)}`).join("; ")}>
        {segments.map((s) =>
          s.value > 0 && total > 0 ? (
            <span key={s.label} className="seg__part" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${format(s.value)}`} />
          ) : null,
        )}
      </div>
      <ul className="legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="legend__dot" style={{ background: s.color }} />
            {s.label}: <strong>{format(s.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Недельные столбцы: текущий период против предыдущего ----------

export interface Column {
  label: string;
  value: number;
  tone: "current" | "previous";
  title: string;
}

export function ColumnChart({ columns, ariaLabel }: { columns: Column[]; ariaLabel: string }) {
  // Размер подобран под экран телефона, чтобы подписи были читаемы без масштабирования.
  const W = 360;
  const H = 230;
  const pad = { l: 50, r: 6, t: 10, b: 26 };
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

  return (
    <figure className="chart">
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
          return (
            <g key={i}>
              {/* область наведения шире столбика */}
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={innerH} fill="transparent">
                <title>{c.title}</title>
              </rect>
              {h > 0 && (
                <path
                  d={c.value >= 0 ? roundedTop(x, top, bw, h, 4) : roundedBottom(x, top, bw, h, 4)}
                  fill={c.tone === "current" ? "url(#col-current)" : VIZ.muted}
                >
                  <title>{c.title}</title>
                </path>
              )}
              {i % every === 0 && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10.5" fill={VIZ.ink2}>
                  {c.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
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

/** Столбик со скруглением только у свободного края (4 px), основание ровное. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function roundedBottom(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y} H${x + w} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x + rr} Q${x},${y + h} ${x},${y + h - rr} Z`;
}

// ---------- Расходящиеся полосы: изменение по клиентам ----------

export function DivergingBars({ rows }: { rows: { key: string; label: string; sub?: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="div-bars">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / max) * 50;
        return (
          <li key={r.key} className="div-bars__row">
            <div className="div-bars__label">
              <span>{r.label}</span>
              {r.sub && <small>{r.sub}</small>}
            </div>
            <div className="div-bars__plot" title={`${r.label}: ${r.value > 0 ? "+" : ""}${formatMoney(r.value)}`}>
              <span className="div-bars__axis" />
              <span
                className="div-bars__bar"
                style={{
                  width: `${w}%`,
                  left: r.value >= 0 ? "50%" : `${50 - w}%`,
                  background: r.value >= 0 ? VIZ.main : VIZ.negative,
                  borderRadius: r.value >= 0 ? "0 4px 4px 0" : "4px 0 0 4px",
                }}
              />
            </div>
            <div className={`div-bars__value ${r.value < 0 ? "neg" : "pos"}`}>
              {r.value < 0 ? "▼ −" : r.value > 0 ? "▲ +" : ""}
              {axisMoney(Math.abs(r.value))} ₽
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Две полосы на одной шкале: оборот и маржа ----------

export function RevenueMarginBars({ revenue, margin, max }: { revenue: number; margin: number; max: number }) {
  const w = (v: number) => `${Math.max((Math.max(v, 0) / max) * 100, v > 0 ? 1.5 : 0)}%`;
  return (
    <div className="rm" role="img" aria-label={`Оборот ${formatMoney(revenue)}, маржа ${formatMoney(margin)}`}>
      <div className="rm__track" title={`Оборот: ${formatMoney(revenue)}`}>
        <span className="rm__bar" style={{ width: w(revenue), background: VIZ.soft }} />
      </div>
      <div className="rm__track" title={`Маржа: ${formatMoney(margin)}`}>
        <span className="rm__bar" style={{ width: w(margin), background: margin < 0 ? VIZ.negative : VIZ.strong }} />
      </div>
    </div>
  );
}

/** ▲ / ▼ со знаком и цветом: смысл не держится на одном цвете. */
export function Delta({ value, suffix = " ₽", format = axisMoney }: { value: number; suffix?: string; format?: (n: number) => string }) {
  if (value === 0) return <span className="delta">без изменений</span>;
  return (
    <span className={`delta ${value > 0 ? "delta--up" : "delta--down"}`}>
      {value > 0 ? "▲ +" : "▼ −"}
      {format(Math.abs(value))}
      {suffix}
    </span>
  );
}
