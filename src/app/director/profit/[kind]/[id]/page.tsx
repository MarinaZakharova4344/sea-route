import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getGroupDetail, type GroupBy } from "@/lib/analytics";
import { formatDate, formatMoney, formatMoneyShort, formatPercent } from "@/lib/format";
import { ensureFresh } from "@/lib/recalc";

type Props = { params: Promise<{ kind: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function GroupPage({ params, searchParams }: Props) {
  const { kind, id } = await params;
  const sp = await searchParams;
  if (kind !== "client" && kind !== "direction") notFound();
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const days = [30, 90, 180].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const by = kind as GroupBy;
  const db = getDb();
  ensureFresh(db);
  const d = getGroupDetail(db, by, n, days);
  if (d.name === "Не найдено") notFound();
  const g = d.group;

  return (
    <>
      <Link href={`/director/profit?days=${days}&by=${by}`} className="back">
        ← К списку
      </Link>
      <header className="dhead">
        <h1>{d.name}</h1>
        <p>
          Перевозки, доставленные {formatDate(d.from)} — {formatDate(d.to)}
        </p>
      </header>

      {g ? (
        <section className="hero-card">
          <span className="hero-card__cap">Маржа</span>
          <div className="hero-card__big">
            <span className={g.margin < 0 ? "neg" : ""}>{formatMoneyShort(g.margin)}</span>
            <span className="hero-card__pct">{formatPercent(g.marginPct)} от оборота</span>
          </div>
          <dl className="facts">
            <div>
              <dt>Оборот</dt>
              <dd>{formatMoneyShort(g.revenue)}</dd>
            </div>
            <div>
              <dt>Расходы</dt>
              <dd>{formatMoneyShort(g.cost)}</dd>
            </div>
            <div>
              <dt>Перевозок</dt>
              <dd>{g.count}</dd>
            </div>
            <div>
              <dt>С проблемами</dt>
              <dd>{g.problemCount}</dd>
            </div>
          </dl>
          {g.verdict && (
            <p className={`verdict verdict--${g.verdict.kind}`}>
              <span aria-hidden="true">{g.verdict.kind === "looks_better" ? "⚠" : "✓"}</span>
              <span>
                <strong>{g.verdict.kind === "looks_better" ? "Выглядит лучше, чем работает" : "Работает хорошо"}.</strong> {g.verdict.text}.
              </span>
            </p>
          )}
        </section>
      ) : (
        <div className="empty">
          <strong>За этот период перевозок нет</strong>
          <span>Выберите период длиннее на предыдущем экране.</span>
        </div>
      )}

      {d.shipments.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Перевозки: от слабых к сильным</h2>
          </div>
          <ul className="attn">
            {d.shipments.map((s) => (
              <li key={s.id}>
                <Link href={`/director/shipments/${s.id}`} className="attn__card">
                  <div className="attn__top">
                    <strong>{s.number}</strong>
                    <span className={s.margin < 0 ? "neg" : ""}>
                      {formatMoney(s.margin)}
                      {s.isPreliminary ? " *" : ""}
                    </span>
                  </div>
                  <div className="cell-main">{by === "client" ? (s.direction ?? "Направление не указано") : (s.client ?? "Клиент не указан")}</div>
                  <div className="cell-sub">
                    доставлена {formatDate(s.resultDate)} · оборот {formatMoney(s.revenue)}
                  </div>
                  {s.reasons.length > 0 && (
                    <div className="chips attn__chips">
                      {s.reasons.map((r) => (
                        <span key={r} className="chip">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                  {s.isProblem && s.reasons.length === 0 && <p className="muted">Проблемная: опоздание, перерасход или просроченная оплата.</p>}
                </Link>
              </li>
            ))}
          </ul>
          <p className="hint">* маржа предварительная.</p>
        </section>
      )}
    </>
  );
}
