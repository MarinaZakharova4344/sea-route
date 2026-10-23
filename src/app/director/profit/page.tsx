import Link from "next/link";
import { getDb } from "@/db";
import FreshnessBar from "@/components/director/FreshnessBar";
import { RevenueMarginBars, SegmentedBar, VIZ } from "@/components/charts/charts";
import { getPayments, getProfit, getStaleSummary, type GroupBy } from "@/lib/analytics";
import { formatDate, formatMoney, formatMoneyShort, formatPercent } from "@/lib/format";
import { ensureFresh } from "@/lib/recalc";

type Params = Promise<Record<string, string | string[] | undefined>>;

const PERIODS = [
  { days: 30, label: "30 дней" },
  { days: 90, label: "90 дней" },
  { days: 180, label: "180 дней" },
];

export default async function Profit({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const days = PERIODS.some((p) => String(p.days) === sp.days) ? Number(sp.days) : 90;
  const by: GroupBy = sp.by === "direction" ? "direction" : "client";
  const db = getDb();
  const fresh = ensureFresh(db);
  const p = getProfit(db, days, by);
  const pay = getPayments(db, days);
  const stale = getStaleSummary(db);
  const maxRevenue = Math.max(1, ...p.groups.map((g) => g.revenue));
  const href = (d: number, b: GroupBy) => `/director/profit?days=${d}&by=${b}`;

  return (
    <>
      <header className="dhead">
        <h1>Что приносит прибыль?</h1>
        <p>
          {formatDate(p.from)} — {formatDate(p.to)}
        </p>
      </header>

      <FreshnessBar refreshedAt={fresh.refreshedAt} everyMinutes={fresh.refreshEveryMinutes} />

      <section className="hero-card" aria-label="Итог за период">
        <h2 className="xcard__title">Маржа по перевозкам</h2>
        <div className="seg-inline seg-inline--left" role="tablist" aria-label="Период">
          {PERIODS.map((x) => (
            <Link scroll={false} key={x.days} href={href(x.days, by)} className={`seg-inline__btn${x.days === days ? " seg-inline__btn--on" : ""}`} aria-current={x.days === days ? "true" : undefined}>
              {x.label}
            </Link>
          ))}
        </div>
        <Link href={`/director/profit/details/margin?days=${days}`} className="hero-card__big hero-card__big--link">
          <span className={p.totals.margin < 0 ? "neg" : "pos"}>{formatMoneyShort(p.totals.margin)}</span>
          <span className="hero-card__pct">{formatPercent(p.totals.marginPct)} от оборота</span>
          <span className="more-link">Из чего сложилась ›</span>
        </Link>
        <dl className="facts facts--links">
          <Link href={`/director/profit/details/revenue?days=${days}`} className="fact">
            <dt>Оборот</dt>
            <dd>{formatMoneyShort(p.totals.revenue)}</dd>
          </Link>
          <Link href={`/director/profit/details/cost?days=${days}`} className="fact">
            <dt>Расходы</dt>
            <dd>{formatMoneyShort(p.totals.cost)}</dd>
          </Link>
          <Link href={`/director/profit/details/shipments?days=${days}`} className="fact">
            <dt>Перевозок</dt>
            <dd>{p.totals.count}</dd>
          </Link>
          <Link href={`/director/profit/details/problems?days=${days}`} className="fact">
            <dt>С проблемами</dt>
            <dd>
              {p.totals.problemCount} <small>({formatPercent(p.totals.count ? (p.totals.problemCount / p.totals.count) * 100 : 0)})</small>
            </dd>
          </Link>
        </dl>

        <h2 className="h-small">Насколько цифра окончательная?</h2>
        <SegmentedBar
          segments={[
            { label: "Окончательная", value: Math.max(p.totals.finalMargin, 0), color: VIZ.strong, href: `/director/profit/details/final?days=${days}` },
            { label: `Предварительная (${p.totals.preliminaryCount})`, value: Math.max(p.totals.preliminaryMargin, 0), color: VIZ.pending, href: `/director/profit/details/preliminary?days=${days}` },
          ]}
        />
      </section>

      {stale.stale > 0 && (
        <Link href="/director/details/stale" className="warn-note">
          <span aria-hidden="true">⚠</span>
          <span>
            {stale.stale} из {stale.active} активных перевозок не обновлялись больше {stale.days} дн.: показатели по ним могут быть неточными. <u>Какие именно</u>
          </span>
        </Link>
      )}

      <section aria-label="Оплаты клиентов">
        <Link href={`/director/profit/details/payments?days=${days}`} className="pay-card">
          <h2 className="xcard__title pay-card__cap">Оплаты клиентов за период</h2>
          <strong className="pay-card__sum">{formatMoneyShort(pay.received)}</strong>
          <span className="pay-card__sub">
            {pay.lines} {pay.lines === 1 ? "оплата" : "оплат"}
            <br />
            Считаются по дате прихода денег, это не прибыль
          </span>
          <em className="more-link">Какие оплаты ›</em>
        </Link>
      </section>

      <section aria-label="Клиенты и направления">
        <div className="section-head">
          <h2>{by === "client" ? "Оборот и маржа по клиентам" : "Оборот и маржа по направлениям"}</h2>
          <div className="seg-control seg-control--small">
            <Link scroll={false} href={href(days, "client")} className={`seg-control__btn${by === "client" ? " seg-control__btn--on" : ""}`}>
              Клиенты
            </Link>
            <Link scroll={false} href={href(days, "direction")} className={`seg-control__btn${by === "direction" ? " seg-control__btn--on" : ""}`}>
              Направления
            </Link>
          </div>
        </div>
        <ul className="legend legend--inline legend--top">
          <li>
            <span className="legend__dot" style={{ background: VIZ.soft }} />
            Оборот
          </li>
          <li>
            <span className="legend__dot" style={{ background: VIZ.strong }} />
            Маржа
          </li>
        </ul>

        {p.groups.length === 0 ? (
          <div className="empty">
            <strong>За этот период нет доставленных перевозок</strong>
            <span>Выберите период длиннее.</span>
          </div>
        ) : (
          <ul className="groups">
            {p.groups.map((g) => (
              <li key={g.id ?? g.name}>
                <Link href={g.id ? `/director/profit/${by}/${g.id}?days=${days}` : "#"} className="group">
                  <div className="group__head">
                    <span className="group__name">{g.name}</span>
                    <span className={`group__pct${g.marginPct < p.totals.marginPct * 0.5 ? " group__pct--low" : ""}`}>{formatPercent(g.marginPct)}</span>
                  </div>
                  <div className="group__sub">
                    {g.count} {g.count === 1 ? "перевозка" : "перевозок"} · {formatPercent(g.revenueShare)} оборота
                  </div>
                  <RevenueMarginBars revenue={g.revenue} margin={g.margin} max={maxRevenue} />
                  <div className="group__nums">
                    <span>
                      Оборот: <strong>{formatMoneyShort(g.revenue)}</strong>
                    </span>
                    <span>
                      Маржа: <strong className={g.margin < 0 ? "neg" : ""}>{formatMoneyShort(g.margin)}</strong>
                    </span>
                    <span>
                      Проблемных: <strong>{formatPercent(g.problemShare)}</strong>
                    </span>
                  </div>
                  {g.verdict && (
                    <p className={`verdict verdict--${g.verdict.kind}`}>
                      <span aria-hidden="true">{g.verdict.kind === "looks_better" ? "⚠" : "✓"}</span>
                      <span>
                        <strong>{g.verdict.kind === "looks_better" ? "Выглядит лучше, чем работает" : "Работает хорошо"}.</strong> {g.verdict.text}.
                      </span>
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
                      </section>
    </>
  );
}
