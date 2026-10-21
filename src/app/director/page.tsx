import Link from "next/link";
import { getDb } from "@/db";
import FreshnessBar from "@/components/FreshnessBar";
import StatusBadge from "@/components/StatusBadge";
import { REASON_TITLES, getAttention, type ReasonCode } from "@/lib/analytics";
import { formatDate, formatMoney, formatMoneyShort } from "@/lib/format";
import { ensureFresh } from "@/lib/recalc";
import { STATUS_LABELS } from "@/lib/shipments/service";

type Params = Promise<Record<string, string | string[] | undefined>>;

const SHOWN = 6;

export default async function Today({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const db = getDb();
  const fresh = ensureFresh(db);
  const a = getAttention(db);

  const reasonParam = typeof sp.reason === "string" ? sp.reason : undefined;
  const reason = reasonParam && reasonParam in REASON_TITLES ? (reasonParam as ReasonCode) : undefined;
  const showAll = sp.all === "1";
  const filtered = reason ? a.items.filter((i) => i.reasons.some((r) => r.code === reason)) : a.items;
  const items = showAll ? filtered : filtered.slice(0, SHOWN);
  const maxCount = Math.max(1, ...a.byReason.map((r) => r.count));
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/director?${s}` : "/director";
  };

  return (
    <>
      <header className="dhead">
        <h1>Что требует внимания?</h1>
        <p>
          {new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </header>

      <FreshnessBar refreshedAt={fresh.refreshedAt} everyMinutes={fresh.refreshEveryMinutes} />

      <section className="hero-card" aria-label="Сводка">
        <div className="hero-card__num">
          <span className="hero-card__value">{a.total}</span>
          <span className="hero-card__label">
            {plural(a.total, ["перевозка требует", "перевозки требуют", "перевозок требуют"])} вашего внимания
            <small>из {a.activeShipments} в работе и ещё не закрытых финансово</small>
          </span>
        </div>

        <h2 className="h-small">Почему</h2>
        <ul className="reasons">
          {a.byReason.map((r) => (
            <li key={r.code}>
              <Link href={`/director/details/${r.code}`} className={`reason reason--${r.code}`}>
                <span className="reason__title">{r.title}</span>
                <span className="reason__bar">
                  <span style={{ width: `${(r.count / maxCount) * 100}%` }} />
                </span>
                <span className="reason__count">{r.count}</span>
                <span className="reason__chev" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="hint">Нажмите на причину, чтобы увидеть, какие перевозки и счета за ней стоят. Одна перевозка может иметь несколько причин.</p>
      </section>

      <section className="tiles" aria-label="Деньги под риском">
        <Tile href="/director/details/receivables" title="Клиенты не заплатили в срок" value={formatMoneyShort(a.receivables.amount)} sub={`${a.receivables.count} ${plural(a.receivables.count, ["счёт", "счёта", "счетов"])} просрочено`} />
        <Tile href="/director/details/payables" title="Мы не заплатили подрядчикам" value={formatMoneyShort(a.payables.amount)} sub={`${a.payables.count} ${plural(a.payables.count, ["счёт", "счёта", "счетов"])} просрочено`} />
        <Tile href="/director/details/overrun" title="Расходы сверх плана" value={formatMoneyShort(a.overrunExtra)} sub="по перевозкам, не закрытым финансово" />
      </section>

      <section aria-label="Перевозки, требующие внимания">
        <div className="section-head">
          <h2>{reason ? `Причина: ${REASON_TITLES[reason].toLowerCase()}` : "Начните с этих перевозок"}</h2>
          {reason && (
            <Link href="/director" className="link">
              Показать все причины
            </Link>
          )}
        </div>

        {items.length === 0 ? (
          <div className="empty">
            <strong>Всё под контролем</strong>
            <span>Сейчас нет перевозок, требующих вашего внимания.</span>
          </div>
        ) : (
          <ul className="attn">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`/director/shipments/${i.id}`} className={`attn__card attn__card--${i.reasons[0].code}`}>
                  <div className="attn__top">
                    <strong>{i.number}</strong>
                    <StatusBadge status={i.status} label={STATUS_LABELS[i.status]} />
                  </div>
                  <div className="cell-main">{i.client ?? "Клиент не указан"}</div>
                  <div className="cell-sub">{i.direction ?? "Направление не указано"}</div>
                  <div className="chips attn__chips">
                    {i.reasons.map((r) => (
                      <span key={r.code} className={`chip chip--${r.code}`}>
                        {r.text}
                      </span>
                    ))}
                  </div>
                  <p className="attn__action">
                    <span>Что сделать</span>
                    {i.reasons[0].action}
                  </p>
                  <div className="attn__foot">
                    <span className="muted">
                      {i.manager ?? "Менеджер не назначен"} · обновлена {formatDate(i.updatedAt)}
                    </span>
                    <span className={i.margin < 0 ? "neg" : ""}>
                      {formatMoney(i.margin)}
                      {i.isPreliminary ? " *" : ""}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {filtered.length > SHOWN && (
          <div className="more">
            {showAll ? (
              <Link href={href({ reason })} className="btn btn--ghost">
                Свернуть
              </Link>
            ) : (
              <Link href={href({ reason, all: "1" })} className="btn btn--ghost">
                Показать все {filtered.length}
              </Link>
            )}
          </div>
        )}
        <p className="hint">* маржа предварительная: перевозка ещё не закрыта финансово или по части расходов нет фактической суммы.</p>
      </section>
    </>
  );
}

function Tile({ href, title, value, sub }: { href: string; title: string; value: string; sub: string }) {
  return (
    <Link href={href} className="tile tile--link">
      <span className="tile__title">{title}</span>
      <span className="tile__value">{value}</span>
      <span className="tile__sub">{sub}</span>
      <span className="tile__more">Подробнее ›</span>
    </Link>
  );
}

function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
