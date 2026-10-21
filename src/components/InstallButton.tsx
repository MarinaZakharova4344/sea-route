"use client";

import { useState } from "react";
import { useInstall } from "./install";

/**
 * Кнопка «Установить» в шапке: видна, пока приложение не установлено (и не открыто как приложение).
 * Если браузер готов показать окно установки, открывает его; иначе показывает, как установить вручную.
 */
export default function InstallButton() {
  const { installed, canPrompt, ios, install } = useInstall();
  const [help, setHelp] = useState(false);

  if (installed) return null;

  return (
    <span className="install">
      <button type="button" className="btn--text install__btn" onClick={() => (canPrompt ? install() : setHelp((v) => !v))} aria-label="Установить приложение" aria-expanded={help}>
        <svg className="install__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
        </svg>
        <span className="install__label">Установить</span>
      </button>
      {help && (
        <span className="install__help" role="note">
          {ios
            ? "В Safari нажмите «Поделиться» и выберите «На экран Домой»."
            : "Нажмите значок установки в правой части адресной строки или откройте меню браузера (три точки) и выберите «Установить приложение»."}
        </span>
      )}
    </span>
  );
}
