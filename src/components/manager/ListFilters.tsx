"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

interface Props {
  q: string;
  status: string;
  clientId: string;
  attention: boolean;
  statuses: { value: string; label: string }[];
  clients: { id: number; name: string }[];
}

/**
 * Фильтры списка перевозок. Статус, клиент и флажок применяются сразу, поиск — через четверть секунды после
 * последней набранной буквы. Страница не перезагружается и не прокручивается наверх; кнопка «Найти» остаётся
 * для тех, кто привык нажимать Enter.
 */
export default function ListFilters({ q, status, clientId, attention, statuses, clients }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({ q, status, clientId, attention });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Если адрес изменили снаружи (кнопка «Сбросить», «Назад» в браузере), показываем актуальные значения.
  useEffect(() => setV({ q, status, clientId, attention }), [q, status, clientId, attention]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function apply(next: typeof v) {
    const p = new URLSearchParams();
    if (next.q.trim()) p.set("q", next.q.trim());
    if (next.status) p.set("status", next.status);
    if (next.clientId) p.set("clientId", next.clientId);
    if (next.attention) p.set("attention", "any");
    const s = p.toString();
    startTransition(() => router.replace(s ? `/manager?${s}` : "/manager", { scroll: false }));
  }

  function change(patch: Partial<typeof v>, delay = 0) {
    const next = { ...v, ...patch };
    setV(next);
    if (timer.current) clearTimeout(timer.current);
    if (delay) timer.current = setTimeout(() => apply(next), delay);
    else apply(next);
  }

  const hasFilters = Boolean(v.q || v.status || v.clientId || v.attention);

  return (
    <form
      className="toolbar"
      role="search"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        apply(v);
      }}
    >
      <input className="control control--search" type="search" name="q" value={v.q} onChange={(e) => change({ q: e.target.value }, 250)} placeholder="Номер, клиент или груз" aria-label="Поиск" />
      <select className="control" name="status" value={v.status} onChange={(e) => change({ status: e.target.value })} aria-label="Статус">
        <option value="">Все статусы</option>
        {statuses.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <select className="control" name="clientId" value={v.clientId} onChange={(e) => change({ clientId: e.target.value })} aria-label="Клиент">
        <option value="">Все клиенты</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="check-inline">
        <input type="checkbox" name="attention" checked={v.attention} onChange={(e) => change({ attention: e.target.checked })} />
        Требуют внимания
      </label>
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? "Ищем…" : "Найти"}
      </button>
      {hasFilters && (
        <Link href="/manager" scroll={false} className="btn btn--ghost">
          Сбросить
        </Link>
      )}
    </form>
  );
}
