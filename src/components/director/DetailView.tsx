import Link from "next/link";
import BackLink from "@/components/layout/BackLink";
import FreshnessBar from "./FreshnessBar";
import type { DetailPage } from "@/lib/analytics-details";

const TONE: Record<string, string> = { neg: "ditem__value--neg", pos: "ditem__value--pos", warn: "ditem__value--warn", muted: "ditem__value--muted" };

/** Страница подробностей к блоку: что это, из чего сложилось, что делать. Одинаковая для всех блоков. */
export default function DetailView({
  page,
  back,
  freshness,
}: {
  page: DetailPage;
  back: { href: string; label: string };
  freshness: { refreshedAt: string | null; refreshEveryMinutes: number };
}) {
  const empty = page.groups.length === 0 || page.groups.every((g) => g.items.length === 0);
  return (
    <>
      <BackLink href={back.href}>
        ← {back.label}
      </BackLink>
      <header className="dhead">
        <h1>{page.title}</h1>
      </header>

      <FreshnessBar refreshedAt={freshness.refreshedAt} everyMinutes={freshness.refreshEveryMinutes} />

      <section className="hero-card" aria-label="Что это">
        <h2 className="h-small h-small--first">Что это значит</h2>
        <p className="lead">{page.lead}</p>
        {page.summary.length > 0 && (
          <dl className="facts">
            {page.summary.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {page.action && (
          <p className="attn__action attn__action--hero">
            <span>Что сделать</span>
            {page.action}
          </p>
        )}
      </section>

      {empty ? (
        <div className="empty">
          <strong>{page.empty}</strong>
        </div>
      ) : (
        page.groups.map((g) => (
          <section key={g.title} className="dgroup" aria-label={g.title}>
            <div className="section-head">
              <h2>{g.title}</h2>
              {g.totalText && <span className="dgroup__total">{g.totalText}</span>}
            </div>
            {g.sub && <p className="hint hint--top">{g.sub}</p>}
            <ul className="ditems">
              {g.items.map((it, i) => {
                const body = (
                  <>
                    <span className="ditem__main">
                      <strong>{it.title}</strong>
                      {it.sub && <small>{it.sub}</small>}
                      {it.note && <small className="ditem__note">{it.note}</small>}
                    </span>
                    <span className={`ditem__value ${it.tone ? TONE[it.tone] : ""}`}>{it.valueText}</span>
                    {it.href && (
                      <span className="ditem__chev" aria-hidden="true">
                        ›
                      </span>
                    )}
                  </>
                );
                return (
                  <li key={`${it.shipmentId ?? it.title}-${i}`}>
                    {it.href ? (
                      <Link href={it.href} className="ditem ditem--link">
                        {body}
                      </Link>
                    ) : (
                      <div className="ditem">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
