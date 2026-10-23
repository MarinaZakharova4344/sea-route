"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { OrderRef } from "@/lib/overview";

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const WEEKDAYS_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

/** «21.10 ср» */
export const dayShort = (iso: string, weekday: number) => `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${WEEKDAYS[weekday]}`;
/** «21 октября, среда» */
export function dayLong(iso: string, weekday: number): string {
  const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  return `${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]}, ${WEEKDAYS_FULL[weekday]}`;
}

export const plural = (n: number, f: [string, string, string]) => {
  const a = Math.abs(n) % 10;
  const b = Math.abs(n) % 100;
  return a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2];
};

export const ordersWord = (n: number) => plural(n, ["заказ", "заказа", "заказов"]);

export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Всплывающая подсказка над графиком; координаты в процентах от области графика. */
export function Tip({ x, y, title, lines }: { x: number; y: number; title: string; lines: string[] }) {
  const align = x < 22 ? "left" : x > 78 ? "right" : "center";
  return (
    <div className={`tip tip--${align}`} style={{ left: `${x}%`, top: `${y}%` }} role="tooltip">
      <strong>{title}</strong>
      {lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

/** Карточка графика: заголовок, пояснение, содержимое. */
export function ChartCard({ title, hint, children, id, onDismiss }: { title: string; hint?: string; children: ReactNode; id?: string; onDismiss?: () => void }) {
  // нажатие вне карточки (на поля экрана, на другой блок) снимает выделение на графике
  useEffect(() => {
    if (!onDismiss) return;
    // по «click», а не по «pointerdown»: при прокрутке пальцем нажатия-клика нет, и выделение не слетает
    const handler = (e: MouseEvent) => {
      // выделение остаётся только при нажатии на сами столбики, ячейки, строки графика и на панель подробностей
      const t = e.target as Element;
      // кнопка могла исчезнуть при перерисовке (например, «Подробнее» заменяется списком): это не нажатие мимо
      if (!t.isConnected) return;
      if (t.closest && t.closest('[role="button"], .heat button, .blist__row, .drill, .seg-control, .xbar, .xweek')) return;
      onDismiss();
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onDismiss]);
  return (
    <section className="xcard" aria-label={title} id={id}>
      <h2 className="xcard__title">{title}</h2>
      {hint && <p className="xcard__hint">{hint}</p>}
      {children}
    </section>
  );
}

/** Панель подробностей: что скрывается за нажатой точкой графика. */
export function DrillPanel(props: DrillProps) {
  return <DrillInner key={props.title} {...props} />;
}

interface DrillProps {
  title: string;
  facts?: { label: string; value: string }[];
  items: OrderRef[];
  total?: number;
  empty?: string;
  /** пояснение мелким текстом под цифрами */
  note?: string;
  /** ссылка «Подробнее ›» на отдельный экран вместо раскрытия списка */
  href?: string;
  onClose: () => void;
}

function DrillInner({
  title,
  facts,
  items,
  total,
  empty,
  note,
  href,
  onClose,
}: DrillProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const topBefore = useRef<number | null>(null);
  const shown = items.length;

  // при раскрытии и сворачивании списка панель остаётся на том же месте экрана, страницу не уносит вниз
  function toggle(next: boolean) {
    topBefore.current = box.current ? box.current.getBoundingClientRect().top : null;
    setOpen(next);
  }
  useLayoutEffect(() => {
    if (topBefore.current !== null && box.current) {
      const shift = box.current.getBoundingClientRect().top - topBefore.current;
      if (Math.abs(shift) > 1) window.scrollBy(0, shift);
    }
    topBefore.current = null;
  }, [open]);

  return (
    <div className="drill" role="region" aria-label={title} ref={box}>
      <div className="drill__head">
        <strong>{title}</strong>
        <button type="button" className="drill__close" onClick={onClose} aria-label="Закрыть подробности">
          Закрыть
        </button>
      </div>
      {facts && facts.length > 0 && (
        <dl className="drill__facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {note && <p className="drill__note-line">{note}</p>}
      {href ? (
        <Link href={href} className="drill__more-btn">
          Подробнее ›
        </Link>
      ) : items.length === 0 ? (
        <p className="drill__empty">{empty ?? "Здесь пока нет перевозок."}</p>
      ) : !open ? (
        <button type="button" className="drill__more-btn" onClick={() => toggle(true)}>
          Подробнее ›
        </button>
      ) : (
        <>
        <button type="button" className="drill__more-btn" onClick={() => toggle(false)}>
          Скрыть ‹
        </button>
        <ul className="drill__list">
          {items.map((o) => (
            <li key={`${o.id}-${o.note ?? ""}`}>
              <Link href={`/director/shipments/${o.id}`} className="drill__row">
                <span className="drill__main">
                  <strong>{o.number}</strong> {o.client ?? "Клиент не указан"}
                  <small>
                    {o.direction ?? "направление не указано"} · {o.statusLabel}
                  </small>
                </span>
                {o.note && <span className="drill__note">{o.note}</span>}
                <span className="drill__chev" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
        </>
      )}
      {open && total !== undefined && total > shown && <p className="drill__more">Показаны первые {shown} из {total}.</p>}
    </div>
  );
}
