"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Ссылка «Назад». Если пользователь пришёл с другой страницы приложения, она работает как кнопка «Назад»
 * в браузере: возвращает на то же место списка, где он был. Если страницу открыли напрямую, ведёт на `href`.
 */
export default function BackLink({ href, className = "back", children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        const cameFromApp = typeof document !== "undefined" && document.referrer.startsWith(window.location.origin) && window.history.length > 1;
        if (cameFromApp) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}
