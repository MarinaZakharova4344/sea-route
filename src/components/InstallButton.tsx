"use client";

import { useState } from "react";
import { useInstall } from "./install";

/** Кнопка «Установить» в шапке: видна, только пока приложение не установлено и браузер разрешает установку. */
export default function InstallButton() {
  const { installed, canPrompt, ios, install } = useInstall();
  const [help, setHelp] = useState(false);

  if (installed || (!canPrompt && !ios)) return null;

  return (
    <span className="install">
      <button type="button" className="btn--text install__btn" onClick={() => (canPrompt ? install() : setHelp((v) => !v))} aria-label="Установить приложение">
        <svg className="install__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
        </svg>
        <span className="install__label">Установить</span>
      </button>
      {help && ios && (
        <span className="install__help" role="note">
          В Safari нажмите «Поделиться» и выберите «На экран Домой».
        </span>
      )}
    </span>
  );
}
