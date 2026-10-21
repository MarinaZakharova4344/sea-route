"use client";

import { useEffect } from "react";

/**
 * Запоминает, докуда пользователь долистал каждую страницу, и возвращает его на это место,
 * когда он возвращается назад (кнопка «Назад» в браузере, жест на телефоне, ссылка «← К списку»).
 * Next.js сам этого не делает для страниц, которые строятся на сервере.
 */
const KEY = "scroll-memory";

/** Адреса страниц, с которых пользователь перешёл на текущую (последний — предыдущая страница). */
const trail: string[] = [];
let restoring = false;
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

/** Была ли предыдущая страница именно этой (тогда «Назад» вернёт на неё с нужным местом). */
export function previousIs(path: string): boolean {
  const prev = trail[trail.length - 1];
  return prev !== undefined && prev.split("?")[0] === path.split("?")[0];
}

export default function ScrollMemory() {
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

    // Переходы вперёд: запоминаем, откуда ушли.
    const push = history.pushState.bind(history);
    history.pushState = (...args: Parameters<History["pushState"]>) => {
      trail.push(here());
      return push(...args);
    };

    // Назад и вперёд средствами браузера.
    window.addEventListener("popstate", () => {
      trail.pop();
      restoreScroll(here());
    });
  }, []);

  return null;
}
