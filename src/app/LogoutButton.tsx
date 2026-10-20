"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    // сохранённые для чтения без связи страницы принадлежат вошедшему пользователю: удаляем их при выходе
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("sr-pages-")).map((k) => caches.delete(k)));
    }
    router.replace("/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} className="btn--text">
      Выйти
    </button>
  );
}
