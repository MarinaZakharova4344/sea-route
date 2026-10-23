"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { onTrailChange, previousPages } from "@/components/pwa/ScrollMemory";

export interface NavItem {
  href: string;
  label: string;
  icon: "ship" | "bell" | "bars" | "trend" | "chart";
  /** Адреса, при которых вкладка считается активной (по началу пути). */
  match: string[];
}

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const ICONS: Record<NavItem["icon"], ReactNode> = {
  ship: svg(
    <>
      <path d="M3 17l2 3h14l2-3-9-3-9 3Z" />
      <path d="M6 14V9h12v5M12 9V4" />
    </>,
  ),
  bell: svg(
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>,
  ),
  bars: svg(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  chart: svg(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v8h8" />
    </>,
  ),
  trend: svg(
    <>
      <path d="M3 17l6-6 4 4 8-9" />
      <path d="M15 6h6v6" />
    </>,
  ),
};

function matches(pathname: string, item: NavItem): boolean {
  // Корень раздела ("/director", "/manager") сопоставляется точно, иначе подсвечивалась бы любая его страница;
  // остальные адреса: сама страница и всё, что внутри неё (страница клиента, подробности).
  return item.match.some((m) => (m.split("/").length <= 2 ? pathname === m : pathname === m || pathname.startsWith(m + "/")));
}

/**
 * Какая вкладка подсвечена. Карточка перевозки открывается из любого экрана, поэтому подсвечивается вкладка,
 * из которой человек пришёл (по умолчанию «Сегодня» для руководителя).
 */
function isActive(pathname: string, item: NavItem, items: NavItem[]): boolean {
  if (pathname.startsWith("/director/shipments/")) {
    const from = previousPages().find((p) => !p.startsWith("/director/shipments/") && items.some((i) => matches(p.split("?")[0], i)));
    if (from) return matches(from.split("?")[0], item);
  }
  return matches(pathname, item);
}

/** Перерисовывает панель, когда обновился «след» переходов: он дописывается чуть позже, чем отрисована новая страница. */
function useRefreshOnTrailChange() {
  const [, force] = useState(0);
  useEffect(() => onTrailChange(() => force((n) => n + 1)), []);
}

/** Навигация в шапке (компьютер). */
export function HeaderNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "";
  useRefreshOnTrailChange();
  if (items.length < 2) return null;
  return (
    <nav className="topbar__nav" aria-label="Разделы">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={isActive(pathname, i, items) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Нижняя панель вкладок (телефон). */
export function TabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "";
  useRefreshOnTrailChange();
  if (items.length < 2) return null;
  return (
    <nav className="tabbar" aria-label="Разделы">
      {items.map((i) => {
        const active = isActive(pathname, i, items);
        return (
          <Link key={i.href} href={i.href} className={active ? "tabbar__tab tabbar__tab--on" : "tabbar__tab"} aria-current={active ? "page" : undefined}>
            {ICONS[i.icon]}
            <span>{i.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
