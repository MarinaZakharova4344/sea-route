import BackLink from "@/components/layout/BackLink";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import ContainersEditor from "@/components/manager/ContainersEditor";
import FinanceActions from "@/components/manager/FinanceActions";
import LinesEditor from "@/components/manager/LinesEditor";
import ShipmentForm from "@/components/manager/ShipmentForm";
import { HistorySection, ResultSection } from "@/components/shipment/ShipmentSections";
import StatusBadge from "@/components/shipment/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { ensureFresh } from "@/lib/recalc";
import { getShipment, referenceData } from "@/lib/shipments/service";

export default async function ManagerShipment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const db = getDb();
  ensureFresh(db);
  let s;
  try {
    s = getShipment(db, n);
  } catch {
    notFound();
  }
  const reference = referenceData(db);
  const locked = s.financeClosedAt !== null;

  return (
    <div className="mpage">
      <BackLink href="/manager">
        ← Все перевозки
      </BackLink>

      <div className="mpage__head">
        <div>
          <h1 className="page__title">{s.number}</h1>
          <p className="page__sub">
            {s.client?.name ?? "Клиент не указан"}
            {s.direction ? ` · ${s.direction.origin} → ${s.direction.destination}` : ""}
          </p>
        </div>
        <StatusBadge status={s.status} label={s.statusLabel} />
      </div>
      <p className="mpage__meta">
        Сведения обновлены {formatDateTime(s.updatedAt)}
        {s.updatedBy ? `, ${s.updatedBy}` : ""}
      </p>

      <FinanceActions shipmentId={s.id} status={s.status} financeClosedAt={s.financeClosedAt} />

      <section className="panel msec">
        <h2>Основное</h2>
        <ShipmentForm
          mode="edit"
          shipmentId={s.id}
          locked={locked}
          reference={reference}
          initial={{
            clientId: s.client?.id ?? null,
            directionId: s.direction?.id ?? null,
            managerId: s.manager?.id ?? null,
            cargoDescription: s.cargoDescription,
            status: s.status === "closed" ? "arrived" : s.status,
            plannedDeparture: s.plannedDeparture,
            actualDeparture: s.actualDeparture,
            plannedArrival: s.plannedArrival,
            actualArrival: s.actualArrival,
          }}
        />
      </section>

      <section className="panel msec">
        <h2>Контейнеры</h2>
        <ContainersEditor shipmentId={s.id} containers={s.containers} locked={locked} />
      </section>

      <section className="panel msec">
        <h2>Доходы и расходы</h2>
        <LinesEditor shipmentId={s.id} lines={s.lines} counterparties={reference.counterparties as { id: number; name: string; type: string }[]} locked={locked} />
      </section>

      <div className="msec msec--plain">
        <ResultSection s={s} />
      </div>
      <div className="msec msec--plain">
        <HistorySection s={s} />
      </div>
    </div>
  );
}
