"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { hasPreviousPage, restoreScroll } from "@/components/pwa/ScrollMemory";

/**
 * Ссылка «Назад». Если человек пришёл с другой страницы приложения, она работает как кнопка «Назад» в браузере:
 * возвращает туда, откуда он пришёл (например, в «Динамику»), на то же место страницы. Если страницу открыли напрямую,
 * ведёт на `href`.
 */
export default function BackLink({ href, className = "back", children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        if (hasPreviousPage()) {
          router.back();
        } else {
          router.push(href);
          restoreScroll(href);
        }
      }}
    >
      {children}
    </Link>
  );
}
