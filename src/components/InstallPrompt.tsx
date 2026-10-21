"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useInstall } from "./install";

const KEY = "install-prompt-later";

/**
 * Окно сверху с предложением установить приложение. Появляется, когда человек открыл сайт в браузере.
 * Не появляется в установленном приложении. «Позже» скрывает окно до следующего захода на сайт.
 */
export default function InstallPrompt() {
  const { installed, canPrompt, ios, install } = useInstall();
  const [later, setLater] = useState(true);
  const [steps, setSteps] = useState(false);
  const noHeader = usePathname() === "/login";

  useEffect(() => {
    try {
      setLater(sessionStorage.getItem(KEY) === "1");
    } catch {
      setLater(false);
    }
  }, []);

  if (installed || later || (!canPrompt && !ios)) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {}
    setLater(true);
  };

  return (
    <div className={`install-prompt${noHeader ? " install-prompt--top" : ""}`} role="dialog" aria-label="Установка приложения">
      <img src="/icons/icon-192.png" alt="" width="44" height="44" className="install-prompt__icon" />
      <div className="install-prompt__text">
        <strong>Установить «Морской маршрут»?</strong>
        {steps && ios ? (
          <span>В Safari нажмите «Поделиться» (квадрат со стрелкой), затем «На экран Домой».</span>
        ) : (
          <span>Откроется как обычное приложение, значок появится на экране.</span>
        )}
      </div>
      <div className="install-prompt__btns">
        {steps && ios ? (
          <button type="button" className="btn btn--primary" onClick={dismiss}>
            Понятно
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => (canPrompt ? install() : setSteps(true))}>
            Установить
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={dismiss}>
          Позже
        </button>
      </div>
    </div>
  );
}
