"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Состояние связи с сервером: проверяется при открытии, при возвращении на вкладку и раз в 15 секунд, а не только по сигналу
 * браузера «сети нет» (он не замечает, что сервер недоступен). Без связи приложение показывает последние загруженные данные:
 * об этом сообщается явно, с временем загрузки страницы, а изменения сохранить нельзя.
 */
export default function ConnectionBanner({ renderedAt }: { renderedAt: string }) {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [justBack, setJustBack] = useState(false);

  useEffect(() => {
    let alive = true;

    /** Сервер отвечает? Любой ответ (даже «нужен вход») считается связью; ошибка сети или тишина дольше 5 секунд нет. */
    async function check() {
      if (!navigator.onLine) return report(false);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        await fetch("/api/auth/me", { cache: "no-store", signal: ctrl.signal });
        report(true);
      } catch {
        report(false);
      } finally {
        clearTimeout(timer);
      }
    }

    function report(ok: boolean) {
      if (!alive) return;
      setOnline((was) => {
        if (!was && ok) setJustBack(true);
        if (was && !ok) setJustBack(false);
        return ok;
      });
    }

    check();
    const onOffline = () => report(false);
    const onOnline = () => void check();
    const onVisible = () => document.visibilityState === "visible" && void check();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const time = new Date(renderedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  if (online && !justBack) return null;
  if (online && justBack) {
    return (
      <div className="conn conn--back" role="status">
        <span>Связь восстановлена.</span>
        <button
          type="button"
          onClick={() => {
            setJustBack(false);
            router.refresh();
          }}
        >
          Обновить данные
        </button>
      </div>
    );
  }
  return (
    <div className="conn conn--off" role="alert">
      <strong>Нет связи с сервером.</strong>
      <span>Показаны данные, загруженные {time}. Изменения сейчас сохранить нельзя.</span>
    </div>
  );
}
