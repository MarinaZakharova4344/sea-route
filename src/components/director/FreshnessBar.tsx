"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "ещё не считались";

const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * «Данные на HH:MM:SS» и кнопка «Обновить». Аналитика пересчитывается с небольшой задержкой,
 * поэтому правки менеджеров видны не сразу; кнопка пересчитывает сразу, показывает сообщение
 * «Обновлено» и сразу меняет время в надписи.
 */
export default function FreshnessBar({ refreshedAt, everyMinutes }: { refreshedAt: string | null; everyMinutes: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [shown, setShown] = useState<string | null>(refreshedAt);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Если страница пересчиталась сама (в пределах заданных минут), берём время с сервера.
  useEffect(() => {
    setShown((prev) => (refreshedAt && (!prev || refreshedAt > prev) ? refreshedAt : prev));
  }, [refreshedAt]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function refresh() {
    setState("loading");
    setToast(null);
    try {
      const res = await fetch("/api/analytics/refresh", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { refreshedAt: string | null; recalculated: number };
      if (data.refreshedAt) setShown(data.refreshedAt);
      setState("idle");
      setToast(`Обновлено в ${data.refreshedAt ? timeOnly(data.refreshedAt) : "сейчас"}`);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 3500);
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <div className="fresh" role="status" title={`Данные обновляются каждые ${everyMinutes} мин. Правки менеджеров появляются после обновления.`}>
        <span className="fresh__text">
          Данные на <strong>{fmt(shown)}</strong>
        </span>
        {state === "error" && <span className="fresh__error">нет связи, показаны прежние</span>}
        <button type="button" className="fresh__btn" onClick={refresh} disabled={state === "loading"}>
          {state === "loading" ? "Обновляем…" : "Обновить"}
        </button>
      </div>
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span className="toast__icon" aria-hidden="true">
            ✓
          </span>
          {toast}
        </div>
      )}
    </>
  );
}
