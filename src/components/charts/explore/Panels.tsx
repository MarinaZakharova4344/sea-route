"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Bucket, DayPoint, Overview } from "@/lib/analytics/overview";
import { formatMoney, formatMoneyShort, plural, ruNumber } from "@/lib/format";
import BarList from "./BarList";
import Donut from "./Donut";
import OrdersChart from "./OrdersChart";
import { STATUS_NOTES } from "@/lib/analytics/status-notes";
import { ChartCard, DrillPanel, dayLong, ordersWord } from "./shared";

const RANGES = [
  { days: 7, label: "7 дней" },
  { days: 14, label: "14 дней" },
  { days: 30, label: "30 дней" },
];

const iso = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Что открывается под графиком по нажатию на день: заказы дня или расчёт прогноза. */
function dayPanel(o: Overview, date: string | null, close: () => void) {
  if (!date) return null;
  const point: DayPoint | undefined = o.days.find((d) => d.date === date);
  const fc = o.forecast.find((f) => f.date === date);
  const weekday = point?.weekday ?? fc?.weekday ?? 0;
  if (date > o.today && fc) {
    return (
      <DrillPanel
        title={`${dayLong(date, weekday)}: прогноз`}
        facts={[
          { label: "Ожидается", value: `≈${Math.round(fc.expected)} ${ordersWord(Math.round(fc.expected))}` },
          { label: "Вероятный коридор", value: `${Math.round(fc.low)}–${Math.round(fc.high)}` },
        ]}
        note={`Прогноз ошибался в среднем на ±${o.accuracy.mae} заказа (проверено на последних ${o.accuracy.days} днях).`}
        items={[]}
        empty="Заказов на этот день ещё нет: это расчёт по таким же дням недели и последним дням."
        onClose={close}
      />
    );
  }
  return (
    <DrillPanel
      title={`${dayLong(date, weekday)}${date === o.today ? " (сегодня)" : ""}`}
      facts={[
        { label: "Поступило", value: `${point?.count ?? 0} ${ordersWord(point?.count ?? 0)}` },
        ...(fc && date === o.today ? [{ label: "Ожидается за день", value: `≈${Math.round(fc.expected)}` }] : []),
      ]}
      items={point?.orders ?? []}
      total={point?.count}
      empty="В этот день заказов не поступало."
      href={point && point.count > 0 ? `/director/orders/${date}` : undefined}
      onClose={close}
    />
  );
}

function bucketPanel(list: Bucket[], key: string | null, close: () => void, opts: { money?: boolean; title: (b: Bucket) => string; empty: string; explain?: (b: Bucket) => string }) {
  const b = list.find((x) => x.key === key);
  if (!b) return null;
  return (
    <DrillPanel
      title={opts.title(b)}
      facts={[{ label: opts.money ? "Счетов" : "Перевозок", value: String(b.count) }, ...(opts.money ? [{ label: "Сумма", value: formatMoney(b.amount) }] : [])]}
      items={b.items}
      total={b.count}
      empty={opts.empty}
      note={opts.explain?.(b)}
      onClose={close}
    />
  );
}

/** Главный график экрана «Сегодня»: плитки сегодня, вчера, завтра, неделя и заказы по дням с прогнозом. */
export function OrdersHero({ overview: o }: { overview: Overview }) {
  const router = useRouter();
  const [range, setRange] = useState(7);
  const [selected, setSelected] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const byDate = new Map(o.days.map((d) => [d.date, d]));
  const today = byDate.get(o.today)!;
  const yesterdayDate = iso(o.today, -1);
  const yesterday = byDate.get(yesterdayDate)!;
  const yesterdayDelta = yesterday.count - (byDate.get(iso(yesterdayDate, -7))?.count ?? 0);
  const tomorrow = o.forecast[1];
  const last7 = o.days.slice(-7).reduce((s, d) => s + d.count, 0);
  const prev7 = o.days.slice(-14, -7).reduce((s, d) => s + d.count, 0);

  function pick(date: string) {
    setSelected(date);
    document.getElementById("orders")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const top = Math.max(1, today.count, yesterday.count, Math.round(tomorrow.high));
  const bar = (label: string, value: number, shown: string, sub: string, date: string, kind: "now" | "past" | "fc") => (
    <li>
      <button type="button" className={`xbar${selected === date ? " xbar--on" : ""}`} onClick={() => (kind === "fc" ? pick(date) : router.push(`/director/orders/${date}`))}>
        <span className="xbar__label">
          {label}
          {kind === "fc" && <small>прогноз</small>}
        </span>
        <span className="xbar__track">
          <span className={`xbar__fill xbar__fill--${kind}`} style={{ width: `${Math.max(2, (value / top) * 100)}%` }} />
        </span>
        <strong className="xbar__value">{shown}</strong>
      </button>
    </li>
  );

  return (
    <section className="xhero" aria-label="Заказы по дням">
      <ChartCard id="orders" title="Сколько заказов поступает?" onDismiss={() => setSelected(null)}>
        <div className="chartbox">
          <div className="seg-inline" role="group" aria-label="Период графика">
            {RANGES.map((r) => (
              <button key={r.days} type="button" className={`seg-inline__btn${range === r.days ? " seg-inline__btn--on" : ""}`} onClick={() => setRange(r.days)} aria-pressed={range === r.days}>
                {r.label}
              </button>
            ))}
          </div>
          <OrdersChart days={o.days.slice(-range)} forecast={o.forecast} today={o.today} selected={selected} onSelect={setSelected} onOpen={(d) => router.push(`/director/orders/${d}`)} legendExtra={<button type="button" className="legend__help" onClick={() => setHelp((v) => !v)} aria-expanded={help} aria-label="Как проверен прогноз">?</button>} />
        </div>
        {help && (
          <p className="xcard__note">
          Прогноз проверен на последних {o.accuracy.days} днях: в среднем ошибается на ±{ruNumber(o.accuracy.mae)} заказа, в коридор попадало {o.accuracy.withinBandPct} % дней.
        </p>
        )}
      </ChartCard>

      <div className="xsum">
        <ul className="xbars">
          {bar("Сегодня", today.count, String(today.count), `ждём за день ≈${Math.max(today.count, Math.round(o.forecast[0].expected))}`, o.today, "now")}
          {bar("Вчера", yesterday.count, String(yesterday.count), `${yesterdayDelta >= 0 ? "+" : "−"}${Math.abs(yesterdayDelta)} к такому же дню неделей ранее`, yesterdayDate, "past")}
          {bar("Завтра", Math.round(tomorrow.expected), `≈${Math.round(tomorrow.expected)}`, `прогноз, коридор ${Math.round(tomorrow.low)}–${Math.round(tomorrow.high)}`, tomorrow.date, "fc")}
        </ul>
        <button type="button" className="xweek" onClick={() => setRange(7)}>
          <span>За 7 дней</span>
          <strong>{last7}</strong>
          <small>{last7 - prev7 >= 0 ? "+" : "−"}{Math.abs(last7 - prev7)} к прошлой неделе ({prev7})</small>
        </button>
      </div>
    </section>
  );
}

export function StatusDonut({ overview: o }: { overview: Overview }) {
  const [sel, setSel] = useState<string | null>(null);
  const b = o.statuses.find((x) => x.key === sel);
  return (
    <ChartCard onDismiss={() => setSel(null)} title="Статус перевозок">
      <Donut buckets={o.statuses} selected={sel} onSelect={(k) => setSel(k === sel ? null : k)} />
      {b && <DrillPanel title={`${b.label}: ${b.count}`} items={[]} note={STATUS_NOTES[b.key]} href={`/director/status/${b.key}`} onClose={() => setSel(null)} />}
    </ChartCard>
  );
}

export function AgingChart({ overview: o }: { overview: Overview }) {
  const router = useRouter();
  return (
    <ChartCard title="Неоплаченные счета клиентов">
      <p className="xcard__line">
        Просрочено: <strong>{formatMoneyShort(o.aging.totalOverdue)}</strong>
        <br />
        Срок не наступил: <strong>{formatMoneyShort(o.aging.totalOpen)}</strong>
      </p>
      <BarList buckets={o.aging.buckets} selected={null} onSelect={(k) => router.push(`/director/receivables/${k}`)} value={(b) => b.amount} format={(b) => formatMoneyShort(b.amount)} sub={(b) => `${b.count} ${plural(b.count, ["счёт", "счёта", "счетов"])}`} />
    </ChartCard>
  );
}

