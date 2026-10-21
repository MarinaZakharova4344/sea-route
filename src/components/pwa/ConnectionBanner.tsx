"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Состояние связи. Без интернета приложение показывает последние загруженные данные:
 * об этом сообщается явно, с временем загрузки страницы, а изменения сохранить нельзя.
 */
export default function ConnectionBanner({ renderedAt }: { renderedAt: string }) {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [justBack, setJustBack] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const off = () => {
      setOnline(false);
      setJustBack(false);
    };
    const on = () => {
      setOnline(true);
      setJustBack(true);
    };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
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
      <strong>Нет связи с интернетом.</strong>
      <span>Показаны данные, загруженные {time}. Изменения сейчас сохранить нельзя.</span>
    </div>
  );
}
