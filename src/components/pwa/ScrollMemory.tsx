"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Запоминает, докуда пользователь долистал каждую страницу, и возвращает его на это место,
 * когда он возвращается назад (кнопка «Назад» в браузере, жест на телефоне, ссылка «← К списку»).
 * Next.js сам этого не делает для страниц, которые строятся на сервере.
 */
const KEY = "scroll-memory";

/** Адреса страниц, с которых пользователь перешёл на текущую (последний — предыдущая страница). */
const trail: string[] = [];
let restoring = false;
/** Идёт переход «назад» средствами браузера: смену адреса не нужно записывать в след как переход вперёд. */
let popping = false;
let installed = false;

const here = () => window.location.pathname + window.location.search;

function read(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function write(map: Record<string, number>) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // память вкладки недоступна: просто не запоминаем
  }
}

/** Возвращает страницу на сохранённое место; ждёт, пока страница дорисуется, и не мешает, если человек сам начал листать. */
export function restoreScroll(url: string) {
  const y = read()[url];
  if (!y) return;
  restoring = true;
  let stop = false;
  const cancel = () => (stop = true);
  window.addEventListener("wheel", cancel, { passive: true, once: true });
  window.addEventListener("touchstart", cancel, { passive: true, once: true });
  window.addEventListener("keydown", cancel, { once: true });
  const started = Date.now();
  const step = () => {
    if (stop || Date.now() - started > 1500) {
      restoring = false;
      return;
    }
    if (Math.abs(window.scrollY - y) > 4 && document.documentElement.scrollHeight >= y + 100) window.scrollTo(0, y);
    setTimeout(step, 50);
  };
  step();
}

/** Есть ли внутри приложения страница, на которую можно вернуться (а не вход или чужой сайт). */
export function hasPreviousPage(): boolean {
  const prev = trail[trail.length - 1];
  return prev !== undefined && !prev.startsWith("/login");
}

const trailListeners = new Set<() => void>();

/** Подписка на изменение «следа» переходов (чтобы нижняя панель перечитала, откуда пришёл человек). */
export function onTrailChange(fn: () => void): () => void {
  trailListeners.add(fn);
  return () => void trailListeners.delete(fn);
}

/** Страницы, на которых человек был до этой, от последней к первой. Нужна, чтобы подсветить вкладку, откуда он пришёл. */
export function previousPages(): string[] {
  return [...trail].reverse();
}

export default function ScrollMemory() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (installed) return;
    installed = true;
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (restoring || ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          write({ ...read(), [here()]: Math.round(window.scrollY) });
        });
      },
      { passive: true },
    );

    // Назад и вперёд средствами браузера.
    window.addEventListener("popstate", () => {
      trail.pop();
      trailListeners.forEach((fn) => fn());
      popping = true;
      setTimeout(() => (popping = false), 1500);
      restoreScroll(here());
    });
  }, []);

  // Переходы вперёд: когда меняется страница, запоминаем, откуда пришли.
  useEffect(() => {
    const url = here();
    const before = previous.current;
    if (before !== null && before.split("?")[0] !== pathname) {
      if (popping) popping = false;
      else trail.push(before);
    }
    previous.current = url;
    trailListeners.forEach((fn) => fn());
  }, [pathname]);

  return null;
}
