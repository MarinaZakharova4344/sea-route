import "@/app/shipment-view.css";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { getShipment } from "@/lib/shipments/service";

type Shipment = ReturnType<typeof getShipment>;

/** В истории даты хранятся как 2026-10-21; на экране показываем 21.10.2026, как везде. */
const shown = (v: string | null) => (v === null ? "—" : /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : v);

/** Блок «Результат»: доход, расходы, маржа, пометки и причины внимания. */
export function ResultSection({ s }: { s: Shipment }) {
  const m = s.metrics;
  return (
    <>
      {m && (
        <section className="sv__card">
          <h2>Результат</h2>
          <div className="sv__nums">
            <div>
              <span>Доход</span>
              <strong>{formatMoney(m.revenue)}</strong>
            </div>
            <div>
              <span>Расходы</span>
              <strong>{formatMoney(m.cost)}</strong>
            </div>
            <div>
              <span>Маржа</span>
              <strong className={m.margin < 0 ? "neg" : ""}>{formatMoney(m.margin)}</strong>
            </div>
          </div>
          <p className="hint">
            {m.isPreliminary ? "Предварительно: перевозка не закрыта финансово." : "Окончательно: перевозка закрыта финансово."}
          </p>
          {m.attentionReasons.length > 0 && (
            <div className="chips">
              {m.attentionReasons.map((r) => (
                <span key={r.code} className={`chip chip--${r.code}`}>
                  {r.text}
                </span>
              ))}
            </div>
          )}
          {m.missingFields.length > 0 && <p className="note">Не заполнено: {m.missingFields.join(", ")}.</p>}
          {s.analyticsPending && <p className="note">Есть изменения, которые ещё не попали в аналитику. Они появятся при следующем обновлении данных.</p>}
        </section>
      )}

    </>
  );
}

/** Блок «Что и кто менял»: история изменений перевозки. */
export function HistorySection({ s }: { s: Shipment }) {
  return (
      <section className="sv__card">
        <h2>Что и кто менял</h2>
        {s.changes.length === 0 ? (
          <p className="muted">Изменений пока нет.</p>
        ) : (
          <ol className="history">
            {s.changes.map((c) => (
              <li key={c.id}>
                <span className="history__time">
                  {formatDateTime(c.changedAt)}
                  <br />
                  {c.changedBy ?? "—"}
                </span>
                <span className="history__what">
                  <strong>{c.field}</strong>
                  {c.oldValue !== null || c.newValue !== null ? (
                    <>
                      : {shown(c.oldValue)} → {shown(c.newValue)}
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
  );
}
