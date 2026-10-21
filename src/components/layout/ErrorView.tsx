"use client";

import { useEffect, useState } from "react";

/** Экран ошибки загрузки: понятный текст и кнопка «Повторить». */
export default function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    setOffline(!navigator.onLine);
    console.error(error);
  }, [error]);

  return (
    <div className="panel errview" role="alert">
      <h1>{offline ? "Нет связи с интернетом" : "Не удалось загрузить данные"}</h1>
      <p>
        {offline
          ? "Страница, которую вы открывали раньше, доступна для чтения. Эту страницу без связи показать нельзя."
          : "Что-то пошло не так на сервере. Ваши данные не потеряны. Попробуйте ещё раз через несколько секунд."}
      </p>
      <button type="button" className="btn" onClick={reset}>
        Повторить
      </button>
    </div>
  );
}
