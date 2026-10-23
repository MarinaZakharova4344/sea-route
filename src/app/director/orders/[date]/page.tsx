import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import FreshnessBar from "@/components/director/FreshnessBar";
import BackLink from "@/components/layout/BackLink";
import { todayIso } from "@/lib/dates";
import { plural, ruNumber } from "@/lib/format";
import { getOrdersOn, getOverview } from "@/lib/analytics/overview";
import { ensureFresh } from "@/lib/calc/recalc";

const dayLong = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const weekdayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", timeZone: "UTC" });

export default async function OrdersOfDay({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) notFound();
  const db = getDb();
  const fresh = ensureFresh(db);
  const today = todayIso();
  const future = date > today;
  const overview = getOverview(db);
  const forecast = overview.forecast.find((f) => f.date === date);
  const orders = future ? [] : getOrdersOn(db, date);

  return (
    <>
      <BackLink href="/director/changes">← Что изменилось</BackLink>
      <header className="dhead">
        <h1>{future ? `Прогноз на ${dayLong(date)}` : `Заказы за ${dayLong(date)}`}</h1>
      </header>

      <FreshnessBar refreshedAt={fresh.refreshedAt} everyMinutes={fresh.refreshEveryMinutes} />

      <section className="hero-card" aria-label="Пояснение">
        <h2 className="h-small h-small--first">Что это значит?</h2>
        {future ? (
          <>
            <p className="lead">
              Это расчёт, а не факт: заказов на {dayLong(date)} ({weekdayName(date)}) ещё нет. Прогноз берёт такие же дни недели за последние 6 недель и последние дни того же типа (будни или выходные).
              Вероятный коридор показывает, в каких пределах число заказов обычно колеблется.
            </p>
            {forecast && (
              <dl className="facts">
                <div>
                  <dt>Ожидается</dt>
                  <dd>≈{Math.round(forecast.expected)}</dd>
                </div>
                <div>
                  <dt>Коридор</dt>
                  <dd>
                    {Math.round(forecast.low)}–{Math.round(forecast.high)}
                  </dd>
                </div>
                <div>
                  <dt>Точность</dt>
                  <dd>±{ruNumber(overview.accuracy.mae)}</dd>
                </div>
              </dl>
            )}
            <p className="hint">Точность проверена на последних {overview.accuracy.days} днях: в коридор попадало {overview.accuracy.withinBandPct} % дней. Прогноз не знает о праздниках и акциях.</p>
          </>
        ) : (
          <>
            <p className="lead">
              «Заказ» здесь это перевозка, которую завели в системе в этот день ({weekdayName(date)}).
            </p>
            <dl className="facts">
              <div>
                <dt>Поступило</dt>
                <dd>
                  {orders.length} {plural(orders.length, ["заказ", "заказа", "заказов"])}
                </dd>
              </div>
              {date === today && forecast && (
                <div>
                  <dt>Ожидается за день</dt>
                  <dd>≈{Math.round(forecast.expected)}</dd>
                </div>
              )}
            </dl>
          </>
        )}
      </section>

      {!future &&
        (orders.length === 0 ? (
          <div className="empty">
            <strong>В этот день заказов не поступало</strong>
          </div>
        ) : (
          <ul className="ditems">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/director/shipments/${o.id}`} className="ditem ditem--link">
                  <span className="ditem__main">
                    <strong>{o.number}</strong>
                    <small>{o.client ?? "Клиент не указан"}</small>
                    <small>{o.direction ?? "направление не указано"}</small>
                  </span>
                  <span className="ditem__value">{o.statusLabel}</span>
                  <span className="ditem__chev" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}
