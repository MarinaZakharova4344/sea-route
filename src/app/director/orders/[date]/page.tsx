import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import FreshnessBar from "@/components/director/FreshnessBar";
import BackLink from "@/components/layout/BackLink";
import { getOrdersOn } from "@/lib/overview";
import { ensureFresh } from "@/lib/recalc";

const dayLong = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const weekdayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", timeZone: "UTC" });
const ordersWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "заказ" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "заказа" : "заказов");

export default async function OrdersOfDay({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) notFound();
  const db = getDb();
  const fresh = ensureFresh(db);
  const orders = getOrdersOn(db, date);

  return (
    <>
      <BackLink href="/director/changes">← Что изменилось</BackLink>
      <header className="dhead">
        <h1>Заказы за {dayLong(date)}</h1>
        <p>
          {weekdayName(date)}, поступило {orders.length} {ordersWord(orders.length)}
        </p>
      </header>

      <FreshnessBar refreshedAt={fresh.refreshedAt} everyMinutes={fresh.refreshEveryMinutes} />

      {orders.length === 0 ? (
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
      )}
    </>
  );
}
