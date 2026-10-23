"use client";

import BrandIcon from "@/components/layout/BrandIcon";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useInstall } from "./install";

/** «Позже» помним только, пока страница открыта: после перезагрузки или нового входа окно появляется снова. */
let postponed = false;
/** Страница уже загружена и показана: окно появляется только после этого, а не поверх пустого экрана. */
let pageSeen = false;

/**
 * Окно сверху с предложением установить приложение. Появляется, когда человек открыл сайт в браузере.
 * Не появляется в установленном приложении. «Позже» скрывает окно до следующего захода на сайт.
 */
export default function InstallPrompt() {
  const { installed, canPrompt, ios, install } = useInstall();
  const [later, setLater] = useState(postponed);
  const [steps, setSteps] = useState(false);
  const onLogin = usePathname() === "/login";
  const [ready, setReady] = useState(pageSeen);

  // Ждём, пока на экране появится настоящая страница (шапка и содержимое, без заглушек загрузки), и ещё немного.
  useEffect(() => {
    if (onLogin) {
      // Вышли из аккаунта: после следующего входа окно снова должно дождаться загрузки страницы.
      pageSeen = false;
      setReady(false);
      return;
    }
    if (ready) return;
    const t = setInterval(() => {
      if (document.querySelector(".topbar") && document.querySelector("main.page") && !document.querySelector('[aria-busy="true"]')) {
        clearInterval(t);
        setTimeout(() => {
          pageSeen = true;
          setReady(true);
        }, 1200);
      }
    }, 300);
    return () => clearInterval(t);
  }, [ready, onLogin]);

  if (installed || later || onLogin || !ready) return null;

  const dismiss = () => {
    postponed = true;
    setLater(true);
  };

  return (
    <div className="install-prompt" role="dialog" aria-label="Установка приложения">
      <BrandIcon className="install-prompt__icon" />
      <div className="install-prompt__text">
        <strong>Установить «Морской маршрут»?</strong>
        {steps ? (
          <span>{ios ? "В Safari нажмите «Поделиться» (квадрат со стрелкой), затем «На экран Домой»." : "Откройте меню браузера (три точки или три полоски) и выберите «Установить приложение» или «Установить как приложение». В Chrome и Edge это также значок в адресной строке."}</span>
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
