/**
 * Графики для экранов руководителя. Серверные компоненты без JavaScript в браузере.
 * Цвета: один оттенок синего для величин, серый для контекста, красный и синий для знака изменения.
 * Подсказки при наведении даёт <title>; все цифры дублируются подписями или таблицей рядом с графиком.
 */
import Link from "next/link";
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
  ink3: "#b4c4de",
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

// ---------- Горизонтальный сегментированный индикатор ----------

export interface Segment {
  label: string;
  value: number;
  color: string;
  /** Куда ведёт нажатие на часть и на подпись. */
  href?: string;
}

/** Одна полоса из частей целого (например, окончательная и предварительная маржа). */
export function SegmentedBar({ segments, format = formatMoney }: { segments: Segment[]; format?: (n: number) => string }) {
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0);
  return (
    <div>
      <div className="seg" role="img" aria-label={segments.map((s) => `${s.label}: ${format(s.value)}`).join("; ")}>
        {segments.map((s) =>
          s.value > 0 && total > 0 ? (
            s.href ? (
              <Link key={s.label} href={s.href} className="seg__part seg__part--link" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${format(s.value)}. Нажмите, чтобы увидеть перевозки`} />
            ) : (
              <span key={s.label} className="seg__part" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${format(s.value)}`} />
            )
          ) : null,
        )}
      </div>
      <ul className="legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="legend__dot" style={{ background: s.color }} />
            {s.href ? (
              <Link href={s.href} className="legend__link">
                {s.label}: <strong>{format(s.value)}</strong> ›
              </Link>
            ) : (
              <>
                {s.label}: <strong>{format(s.value)}</strong>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Расходящиеся полосы: изменение по клиентам ----------

export function DivergingBars({ rows }: { rows: { key: string; label: string; sub?: string; value: number; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="div-bars">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / max) * 50;
        const body = (
<>
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
            </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="div-bars__row div-bars__row--link">
                {body}
                <span className="div-bars__chev" aria-hidden="true">
                  ›
                </span>
              </Link>
            ) : (
              <div className="div-bars__row">{body}</div>
            )}
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
