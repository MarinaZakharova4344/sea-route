"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * «Данные на HH:MM» и кнопка «Обновить». Аналитика пересчитывается с небольшой задержкой,
 * поэтому правки менеджера видны не сразу; кнопка пересчитывает сразу.
 */
export default function FreshnessBar({ refreshedAt, everyMinutes }: { refreshedAt: string | null; everyMinutes: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const time = refreshedAt
    ? new Date(refreshedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "ещё не считались";

  async function refresh() {
    setState("loading");
    try {
      const res = await fetch("/api/analytics/refresh", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="fresh" role="status">
      <div className="fresh__text">
        <strong>Данные на {time}</strong>
        <span>Обновляются каждые {everyMinutes} мин. Правки менеджеров появляются после обновления.</span>
        {state === "error" && <span className="fresh__error">Не удалось обновить: нет связи с сервером. Показаны прежние данные.</span>}
      </div>
      <button type="button" className="btn" onClick={refresh} disabled={state === "loading"}>
        {state === "loading" ? "Обновляем…" : "Обновить"}
      </button>
    </div>
  );
}
