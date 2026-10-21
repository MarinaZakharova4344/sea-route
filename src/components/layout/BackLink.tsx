"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { previousIs, restoreScroll } from "@/components/pwa/ScrollMemory";

/**
 * Ссылка «Назад». Если предыдущая страница та же, куда она ведёт, работает как кнопка «Назад» в браузере
 * и возвращает на то место списка, где человек был. Иначе просто открывает нужную страницу (и тоже возвращает
 * на запомненное место, если оно есть).
 */
export default function BackLink({ href, className = "back", children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        if (previousIs(href)) {
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
