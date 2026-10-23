import Link from "next/link";
import { getDb } from "@/db";
import StatusBadge from "@/components/shipment/StatusBadge";
import ListFilters from "@/components/manager/ListFilters";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth/server";
import { ensureFresh } from "@/lib/calc/recalc";
import { ListQuery } from "@/lib/shipments/schemas";
import { listShipments, referenceData } from "@/lib/shipments/service";

type Params = Promise<Record<string, string | string[] | undefined>>;

const PAGE = 25;

function pick(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : undefined;
}

export default async function ManagerHome({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const db = getDb();
  const user = await getCurrentUser();
  const mine = pick(sp, "mine") === "1";
  const parsed = ListQuery.safeParse({
    q: pick(sp, "q"),
    status: pick(sp, "status"),
    clientId: pick(sp, "clientId"),
    managerId: mine && user ? String(user.id) : undefined,
    attention: pick(sp, "attention") === "any" ? "any" : undefined,
    limit: PAGE,
    offset: pick(sp, "offset") ?? 0,
  });
  const query = parsed.success ? parsed.data : ListQuery.parse({ limit: PAGE });
  const analytics = ensureFresh(db);
  const result = listShipments(db, query);
  const ref = referenceData(db);

  const filters = { q: query.q, status: query.status, clientId: query.clientId, attention: query.attention, mine: mine ? "1" : undefined };
  const link = (offset: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, String(v));
    if (offset) p.set("offset", String(offset));
    const s = p.toString();
    return s ? `/manager?${s}` : "/manager";
  };
  const from = result.total === 0 ? 0 : query.offset + 1;
  const to = Math.min(query.offset + PAGE, result.total);

  return (
    <>
      <div className="page__head">
        <div>
          <h1 className="page__title">Перевозки</h1>
          <p className="page__sub">
            {result.total} {declension(result.total, ["перевозка", "перевозки", "перевозок"])}
            {analytics.refreshedAt && (
              <>
                <br />
                Показатели обновлены: {formatDateTime(analytics.refreshedAt)}
              </>
            )}
          </p>
        </div>
        <Link href="/manager/shipments/new" className="btn btn--accent">
          + Новая перевозка
        </Link>
      </div>

      <section className="panel panel--list">
      <ListFilters
        q={query.q ?? ""}
        status={query.status ?? ""}
        clientId={query.clientId ? String(query.clientId) : ""}
        attention={query.attention === "any"}
        mine={mine}
        statuses={ref.statuses}
        clients={ref.clients as { id: number; name: string }[]}
      />

      {result.items.length === 0 ? (
        <div className="empty">
          <strong>Ничего не найдено</strong>
          <span>Измените условия поиска или сбросьте фильтры.</span>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Клиент и направление</th>
                  <th>Статус</th>
                  <th>Отправление → прибытие</th>
                  <th className="num">Маржа</th>
                  <th>Что не так</th>
                  <th>Обновлена</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((s) => (
                  <tr key={s.id} className="row-link">
                    <td>
                      <Link href={`/manager/shipments/${s.id}`} className="row-link__a">
                        {s.number}
                      </Link>
                    </td>
                    <td>
                      <div className="cell-main">{s.client?.name ?? <span className="muted">клиент не указан</span>}</div>
                      <div className="cell-sub">{s.direction ? `${s.direction.origin} → ${s.direction.destination}` : "направление не указано"}</div>
                    </td>
                    <td>
                      <StatusBadge status={s.status} label={s.statusLabel} />
                    </td>
                    <td className="nowrap">
                      {formatDate(s.actualDeparture ?? s.plannedDeparture)} → {formatDate(s.actualArrival ?? s.plannedArrival)}
                    </td>
                    <td className="num">
                      {s.metrics && s.status !== "draft" ? (
                        <>
                          <div className={s.metrics.margin < 0 ? "neg" : ""}>{formatMoney(s.metrics.margin)}</div>
                          {s.metrics.isPreliminary && <div className="cell-sub">предварительно</div>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <Reasons reasons={s.metrics?.attentionReasons ?? []} />
                    </td>
                    <td className="nowrap muted">{formatDateTime(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="cards">
            {result.items.map((s) => (
              <li key={s.id}>
                <Link href={`/manager/shipments/${s.id}`} className="card-item">
                  <div className="card-item__top">
                    <strong>{s.number}</strong>
                    <StatusBadge status={s.status} label={s.statusLabel} />
                  </div>
                  <div className="cell-main">{s.client?.name ?? <span className="muted">клиент не указан</span>}</div>
                  <div className="cell-sub">{s.direction ? `${s.direction.origin} → ${s.direction.destination}` : "направление не указано"}</div>
                  <div className="card-item__row">
                    <span className="muted">
                      {formatDate(s.actualDeparture ?? s.plannedDeparture)} → {formatDate(s.actualArrival ?? s.plannedArrival)}
                    </span>
                    {s.metrics && s.status !== "draft" && (
                      <span className={s.metrics.margin < 0 ? "neg" : ""}>
                        {formatMoney(s.metrics.margin)}
                        {s.metrics.isPreliminary ? " *" : ""}
                      </span>
                    )}
                  </div>
                  <Reasons reasons={s.metrics?.attentionReasons ?? []} dash={false} />
                </Link>
              </li>
            ))}
          </ul>

          <nav className="pager" aria-label="Страницы">
            <span className="muted">
              {from}–{to} из {result.total}
            </span>
            <span className="pager__btns">
              {query.offset > 0 && (
                <Link className="btn btn--ghost" href={link(Math.max(0, query.offset - PAGE))}>
                  ← Назад
                </Link>
              )}
              {to < result.total && (
                <Link className="btn btn--ghost" href={link(query.offset + PAGE)}>
                  Дальше →
                </Link>
              )}
            </span>
          </nav>
        </>
      )}
      </section>
    </>
  );
}

function Reasons({ reasons, dash = true }: { reasons: { code: string; text: string }[]; dash?: boolean }) {
  if (reasons.length === 0) return dash ? <span className="muted">—</span> : null;
  return (
    <span className="chips">
      {reasons.map((r) => (
        <span key={r.code} className={`chip chip--${r.code}`}>
          {r.text}
        </span>
      ))}
    </span>
  );
}

function declension(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
