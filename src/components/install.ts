"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /** Событие установки, перехваченное скриптом в <head> (см. app/layout.tsx). */
    __installEvent?: InstallEvent | null;
    __installed?: boolean;
  }
}

/**
 * Общее состояние установки для кнопки в шапке и всплывающего окна.
 * Само событие beforeinstallprompt перехватывает маленький скрипт в <head> страницы: браузер присылает его один раз
 * при загрузке сайта, ещё до входа в систему, и позже его уже не повторит.
 */
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("install-state", emit);
  return () => {
    listeners.delete(l);
    window.removeEventListener("install-state", emit);
  };
};

export interface InstallState {
  /** Приложение уже установлено или открыто как приложение: ничего предлагать не нужно. */
  installed: boolean;
  /** Браузер готов показать окно установки (Chrome, Edge, Android). */
  canPrompt: boolean;
  /** iPhone и iPad: установка вручную через «Поделиться». */
  ios: boolean;
  install: () => Promise<void>;
}

export function useInstall(): InstallState {
  const hasEvent = useSyncExternalStore(subscribe, () => Boolean(window.__installEvent), () => false);
  const installed = useSyncExternalStore(subscribe, () => Boolean(window.__installed) || isStandalone(), () => false);
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone()), []);

  return {
    installed,
    canPrompt: hasEvent,
    ios,
    async install() {
      const e = window.__installEvent;
      if (!e) return;
      window.__installEvent = null;
      emit();
      await e.prompt();
      await e.userChoice;
    },
  };
}
