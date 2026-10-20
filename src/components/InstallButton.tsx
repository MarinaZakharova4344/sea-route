"use client";

import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Кнопка «Установить»: появляется, когда браузер разрешает установку; на iPhone показывает подсказку. */
export default function InstallButton() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!event && !ios)) return null;

  async function install() {
    if (!event) return setHelp((v) => !v);
    await event.prompt();
    await event.userChoice;
    setEvent(null);
  }

  return (
    <span className="install">
      <button type="button" className="btn--text install__btn" onClick={install}>
        Установить
      </button>
      {help && ios && (
        <span className="install__help" role="note">
          В Safari нажмите «Поделиться» и выберите «На экран Домой».
        </span>
      )}
    </span>
  );
}
