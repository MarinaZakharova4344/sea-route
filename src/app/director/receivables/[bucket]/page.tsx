import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import FreshnessBar from "@/components/director/FreshnessBar";
import BackLink from "@/components/layout/BackLink";
import { formatDate, formatMoney, formatMoneyShort } from "@/lib/format";
import { getReceivablesBucket, type ReceivableRow } from "@/lib/analytics/overview";
import { ensureFresh } from "@/lib/calc/recalc";

const SHOWN = 100;

const invoices = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "счёт" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "счёта" : "счетов");

export default async function ReceivablesBucket({ params }: { params: Promise<{ bucket: string }> }) {
  const { bucket } = await params;
  const db = getDb();
  const fresh = ensureFresh(db);
  const data = getReceivablesBucket(db, decodeURIComponent(bucket));
  if (!data) notFound();
  const total = data.rows.reduce((s, r) => s + r.remaining, 0);

  const row = (r: ReceivableRow, i: number) => (
    <li key={`${r.shipmentId}-${i}`}>
      <Link href={`/director/shipments/${r.shipmentId}`} className="ditem ditem--link">
        <span className="ditem__main">
          <strong>{r.number}</strong>
          <small>{r.client ?? "Клиент не указан"}</small>
          <small>{r.description}</small>
          <small>Оплатить до: {formatDate(r.due)}</small>
        </span>
        <span className="ditem__value">{formatMoney(r.remaining)}</span>
        <span className="ditem__chev" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );

  return (
    <>
      <BackLink href="/director">← Что требует внимания</BackLink>
      <header className="dhead">
        <h1>{data.label}</h1>
        <p>
          {data.rows.length} {invoices(data.rows.length)} на {formatMoneyShort(total)}
        </p>
      </header>

      <FreshnessBar refreshedAt={fresh.refreshedAt} everyMinutes={fresh.refreshEveryMinutes} />

      {data.rows.length === 0 ? (
        <div className="empty">
          <strong>Здесь нет счетов</strong>
        </div>
      ) : (
        <>
          <ul className="ditems">{data.rows.slice(0, SHOWN).map(row)}</ul>
          {data.rows.length > SHOWN && (
            <details className="ditems-more">
              <summary>
                Показать ещё {data.rows.length - SHOWN} из {data.rows.length}
              </summary>
              <ul className="ditems">{data.rows.slice(SHOWN).map((r, i) => row(r, SHOWN + i))}</ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
