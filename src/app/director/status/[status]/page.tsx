import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import FreshnessBar from "@/components/director/FreshnessBar";
import BackLink from "@/components/layout/BackLink";
import { STATUS_LABELS } from "@/lib/shipments/service";
import { STATUS_NOTES, getShipmentsByStatus } from "@/lib/analytics/overview";
import { ensureFresh } from "@/lib/calc/recalc";
import { plural } from "@/lib/format";

const SHOWN = 100;

export default async function ShipmentsInStatus({ params }: { params: Promise<{ status: string }> }) {
  const { status } = await params;
  if (!(status in STATUS_LABELS)) notFound();
  const db = getDb();
  const fresh = ensureFresh(db);
  const list = getShipmentsByStatus(db, status);

  const row = (o: (typeof list)[number]) => (
    <li key={o.id}>
      <Link href={`/director/shipments/${o.id}`} className="ditem ditem--link">
        <span className="ditem__main">
          <strong>{o.number}</strong>
          <small>{o.client ?? "Клиент не указан"}</small>
          <small>{o.direction ?? "направление не указано"}</small>
        </span>
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
        <h1>{STATUS_LABELS[status]}</h1>
        <p>
          {list.length} {plural(list.length, ["перевозка", "перевозки", "перевозок"])}. {STATUS_NOTES[status]}
        </p>
      </header>

      <FreshnessBar refreshedAt={fresh.refreshedAt} everyMinutes={fresh.refreshEveryMinutes} />

      {list.length === 0 ? (
        <div className="empty">
          <strong>Перевозок в этом статусе нет</strong>
        </div>
      ) : (
        <>
          <ul className="ditems">{list.slice(0, SHOWN).map(row)}</ul>
          {list.length > SHOWN && (
            <details className="ditems-more">
              <summary>
                Показать ещё {list.length - SHOWN} из {list.length}
              </summary>
              <ul className="ditems">{list.slice(SHOWN).map(row)}</ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
