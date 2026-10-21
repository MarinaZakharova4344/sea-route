"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { useInstall } from "./install";

/** «Позже» помним только, пока страница открыта: после перезагрузки или нового входа окно появляется снова. */
let postponed = false;

/**
 * Окно сверху с предложением установить приложение. Появляется, когда человек открыл сайт в браузере.
 * Не появляется в установленном приложении. «Позже» скрывает окно до следующего захода на сайт.
 */
export default function InstallPrompt() {
  const { installed, canPrompt, ios, install } = useInstall();
  const [later, setLater] = useState(postponed);
  const [steps, setSteps] = useState(false);
  const onLogin = usePathname() === "/login";

  if (installed || later || onLogin) return null;

  const dismiss = () => {
    postponed = true;
    setLater(true);
  };

  return (
    <div className="install-prompt" role="dialog" aria-label="Установка приложения">
      <img src="/icons/icon-192.png" alt="" width="44" height="44" className="install-prompt__icon" />
      <div className="install-prompt__text">
        <strong>Установить «Морской маршрут»?</strong>
        {steps ? (
          <span>{ios ? "В Safari нажмите «Поделиться» (квадрат со стрелкой), затем «На экран Домой»." : "Нажмите значок установки в правой части адресной строки или откройте меню браузера (три точки) и выберите «Установить приложение»."}</span>
        ) : (
          <span>Откроется как обычное приложение, значок появится на экране.</span>
        )}
      </div>
      <div className="install-prompt__btns">
        {steps ? (
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
