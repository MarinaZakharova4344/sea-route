import "@/app/shipment-view.css";
import StatusBadge from "./StatusBadge";
import { HistorySection, ResultSection } from "./ShipmentSections";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { getShipment } from "@/lib/shipments/service";

type Shipment = ReturnType<typeof getShipment>;

const PAY: Record<string, string> = { unpaid: "не оплачено", partial: "частично", paid: "оплачено" };

/** Карточка перевозки только для чтения: используется руководителем, чтобы дойти до причины. */
export default function ShipmentView({ s }: { s: Shipment }) {
  const m = s.metrics;
  return (
    <div className="sv">
      <section className="sv__card">
        <div className="sv__top">
          <h1>{s.number}</h1>
          <StatusBadge status={s.status} label={s.statusLabel} />
        </div>
        <p className="cell-main">{s.client?.name ?? "Клиент не указан"}</p>
        <p className="cell-sub">{s.direction ? `${s.direction.origin} → ${s.direction.destination}` : "Направление не указано"}</p>
        <dl className="kv">
          <div>
            <dt>Груз</dt>
            <dd>{s.cargoDescription ?? "—"}</dd>
          </div>
          <div>
            <dt>Ответственный</dt>
            <dd>{s.manager?.name ?? "—"}</dd>
          </div>
          <div>
            <dt>Отправление</dt>
            <dd>
              план {formatDate(s.plannedDeparture)}
              {s.actualDeparture && <>, факт {formatDate(s.actualDeparture)}</>}
            </dd>
          </div>
          <div>
            <dt>Прибытие</dt>
            <dd>
              план {formatDate(s.plannedArrival)}
              {s.actualArrival && <>, факт {formatDate(s.actualArrival)}</>}
            </dd>
          </div>
          <div>
            <dt>Финансовое закрытие</dt>
            <dd>{s.financeClosedAt ? formatDate(s.financeClosedAt) : "не закрыта"}</dd>
          </div>
          <div>
            <dt>Сведения обновлены</dt>
            <dd>
              {formatDateTime(s.updatedAt)}
              {s.updatedBy && <>, {s.updatedBy}</>}
            </dd>
          </div>
        </dl>
      </section>

      <ResultSection s={s} />

      <section className="sv__card">
        <h2>Доходы и расходы</h2>
        {s.lines.length === 0 ? (
          <p className="muted">Строк пока нет.</p>
        ) : (
          <ul className="sv__lines">
            {s.lines.map((l) => (
              <li key={l.id}>
                <div className="sv__line-main">
                  <span className={`kind kind--${l.kind}`}>{l.kind === "income" ? "Доход" : "Расход"}</span>
                  <strong>{l.description}</strong>
                  {l.isUnplanned && <span className="chip chip--overrun">внеплановый</span>}
                </div>
                <div className="sv__line-sub">
                  {l.counterpartyName ?? (l.kind === "income" ? s.client?.name : null) ?? "—"} · {PAY[l.paymentStatus]}
                  {l.dueDate && <> · срок {formatDate(l.dueDate)}</>}
                </div>
                <div className="sv__line-sum">
                  <span>
                    план <strong>{formatMoney(l.plannedAmount)}</strong>
                  </span>
                  <span>
                    факт <strong>{l.actualAmount === null ? "ещё нет" : formatMoney(l.actualAmount)}</strong>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sv__card">
        <h2>Контейнеры</h2>
        {s.containers.length === 0 ? (
          <p className="muted">Не указаны.</p>
        ) : (
          <ul className="sv__plain">
            {s.containers.map((c) => (
              <li key={c.id}>
                {c.number ?? <span className="muted">номер не указан</span>}
                {c.type && <> · {c.type === "40HC" ? "40' HC" : `${c.type}'`}</>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <HistorySection s={s} />
    </div>
  );
}
