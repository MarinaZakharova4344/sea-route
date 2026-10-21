import Link from "next/link";
import { getDb } from "@/db";
import FreshnessBar from "@/components/director/FreshnessBar";
import ColumnChart from "@/components/charts/ColumnChart";
import { Delta, DivergingBars, axisMoney } from "@/components/charts/charts";
import { getDynamics } from "@/lib/analytics";
import { formatDate, formatMoney, formatMoneyShort, formatPercent } from "@/lib/format";
import { ensureFresh } from "@/lib/recalc";

type Params = Promise<Record<string, string | string[] | undefined>>;

const PERIODS = [
  { weeks: 2, label: "2 недели" },
  { weeks: 4, label: "4 недели" },
  { weeks: 8, label: "8 недель" },
];

const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export default async function Changes({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const weeks = PERIODS.some((p) => String(p.weeks) === sp.weeks) ? Number(sp.weeks) : 4;
  const db = getDb();
  const fresh = ensureFresh(db);
  const y = getDynamics(db, weeks);
  const dir = y.delta.margin;
  const fewBefore = y.previousTotals.count < 3;

  return (
    <>
      <header className="dhead">
        <h1>Что изменилось?</h1>
        <p>
          {formatDate(y.current.from)} — {formatDate(y.current.to)} в сравнении с {formatDate(y.previous.from)} — {formatDate(y.previous.to)}
        </p>
      </header>

      <FreshnessBar refreshedAt={fresh.refreshedAt} everyMinutes={fresh.refreshEveryMinutes} />

      {y.revisedCount > 0 && (
        <Link href={`/director/changes/details/revised?weeks=${weeks}`} className="warn-note">
          <span aria-hidden="true">⚠</span>
          <span>
            {y.revisedCount} {y.revisedCount === 1 ? "перевозка" : "перевозок"} этих периодов пересчитано задним числом: после закрытия в них внесли правки, поэтому прошлые цифры могли измениться. <u>Какие именно</u>
          </span>
        </Link>
      )}

      <div className="seg-control" role="tablist" aria-label="Период">
        {PERIODS.map((x) => (
          <Link scroll={false} key={x.weeks} href={`/director/changes?weeks=${x.weeks}`} className={`seg-control__btn${x.weeks === weeks ? " seg-control__btn--on" : ""}`} aria-current={x.weeks === weeks ? "true" : undefined}>
            {x.label}
          </Link>
        ))}
      </div>

      <section className="hero-card" aria-label="Изменение маржи">
        <span className="hero-card__cap">Маржа по сравнению с предыдущим периодом</span>
        <div className="hero-card__big">
          <span className={dir < 0 ? "neg" : "pos"}>
            <Delta value={dir} />
          </span>
          <span className="hero-card__pct">{y.delta.marginPct === null ? "в прошлом периоде перевозок не было" : `${y.delta.marginPct > 0 ? "+" : ""}${formatPercent(y.delta.marginPct)}`}</span>
        </div>
        <div className="compare">
          <Link href={`/director/changes/details/current?weeks=${weeks}`} className="compare__col">
            <span>Сейчас · {short(y.current.from)}–{short(y.current.to)}</span>
            <strong>{formatMoneyShort(y.currentTotals.margin)}</strong>
            <small>
              {y.currentTotals.count} перевозок · маржа {formatPercent(y.currentTotals.marginPct)}
            </small>
            <em className="more-link">Какие перевозки ›</em>
          </Link>
          <Link href={`/director/changes/details/previous?weeks=${weeks}`} className="compare__col compare__col--before">
            <span>Раньше · {short(y.previous.from)}–{short(y.previous.to)}</span>
            <strong>{formatMoneyShort(y.previousTotals.margin)}</strong>
            <small>
              {y.previousTotals.count} перевозок · маржа {formatPercent(y.previousTotals.marginPct)}
            </small>
            <em className="more-link">Какие перевозки ›</em>
          </Link>
        </div>
        {fewBefore && <p className="note">В предыдущем периоде мало перевозок ({y.previousTotals.count}), поэтому сравнение может быть неточным.</p>}
      </section>

      <section aria-label="Маржа по неделям">
        <div className="section-head">
          <h2>Маржа по неделям</h2>
        </div>
        <ColumnChart
          ariaLabel="Маржа по неделям: выбранный период и предыдущий"
          columns={y.weeklySeries.map((w) => ({
            label: short(w.start),
            value: w.margin,
            tone: w.period,
            tip: {
              title: `${formatDate(w.start)} — ${formatDate(w.end)}`,
              lines: [`Маржа ${formatMoney(w.margin)}`, `Доставлено перевозок: ${w.count}`, w.period === "current" ? "Выбранный период" : "Предыдущий период"],
            },
          }))}
        />
        <p className="hint">Неделя считается по дате доставки груза. Наведите на столбик (на телефоне нажмите на него), чтобы увидеть сумму и число перевозок.</p>
      </section>

      <section aria-label="Почему изменилось">
        <div className="section-head">
          <h2>Почему так вышло</h2>
        </div>
        <div className="why">
          <Link href={`/director/changes/details/volume?weeks=${weeks}`} className="why__card why__card--link">
            <span className="why__title">Число перевозок</span>
            <Delta value={y.effects.volume} />
            <p>
              {y.delta.count === 0 ? "Перевозок столько же." : `${y.delta.count > 0 ? "Больше" : "Меньше"} на ${Math.abs(y.delta.count)}`} ({y.previousTotals.count} → {y.currentTotals.count}) при средней марже прошлого периода {axisMoney(y.effects.averagePrevious)} ₽ на перевозку.
            </p>
            <em className="more-link">Подробнее: у каких клиентов ›</em>
          </Link>
          <Link href={`/director/changes/details/rate?weeks=${weeks}`} className="why__card why__card--link">
            <span className="why__title">Маржа с одной перевозки</span>
            <Delta value={y.effects.rate} />
            <p>
              В среднем {axisMoney(y.effects.averagePrevious)} ₽ → {axisMoney(y.effects.averageCurrent)} ₽ на перевозку.
            </p>
            <em className="more-link">Подробнее: какие перевозки ›</em>
          </Link>
        </div>
        <p className="hint">Вместе эти две причины дают полное изменение маржи ({formatMoney(dir)}). Нажмите на причину, чтобы увидеть, из чего она сложилась.</p>
      </section>

      <section aria-label="Какие перевозки повлияли">
        <div className="section-head">
          <h2>Какие перевозки повлияли</h2>
        </div>
        <Contributors title="Потянули вниз" empty="Нет перевозок с маржой ниже обычной." rows={y.dragging} />
        <Contributors title="Помогли" empty="Нет перевозок с маржой выше обычной." rows={y.boosting} />
        <p className="hint">Влияние перевозки = её маржа минус средняя маржа перевозки в предыдущем периоде.</p>
      </section>

      <section aria-label="Изменение по клиентам">
        <div className="section-head">
          <h2>По клиентам</h2>
        </div>
        {y.byClient.length === 0 ? (
          <div className="empty">
            <strong>Нет данных</strong>
            <span>В этих периодах нет доставленных перевозок.</span>
          </div>
        ) : (
          <DivergingBars
            rows={y.byClient.slice(0, 8).map((c) => ({
              key: String(c.id),
              label: c.name,
              sub: c.countDelta === 0 ? undefined : `перевозок ${c.countDelta > 0 ? "+" : "−"}${Math.abs(c.countDelta)}`,
              value: c.delta,
              href: c.id ? `/director/profit/client/${c.id}` : undefined,
            }))}
          />
        )}
      </section>
    </>
  );
}

function Contributors({ title, rows, empty }: { title: string; empty: string; rows: { id: number; number: string; client: string | null; direction: string | null; margin: number; effect: number; reasons: string[]; revisedAt: string | null }[] }) {
  return (
    <div className="contrib">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/director/shipments/${r.id}`} className="contrib__row">
                <span className="contrib__main">
                  <strong>{r.number}</strong> {r.client ?? "Клиент не указан"}
                  <small>
                    {r.direction ?? "—"}
                    {r.reasons.length > 0 && ` · ${r.reasons[0]}`}
                  </small>
                  {r.revisedAt && <small className="contrib__revised">Пересчитано задним числом ({formatDate(r.revisedAt)})</small>}
                </span>
                <span className="contrib__nums">
                  <Delta value={r.effect} />
                  <small>маржа {formatMoney(r.margin)}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
