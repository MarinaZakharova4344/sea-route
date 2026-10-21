"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Общее состояние установки для кнопки в шапке и всплывающего окна.
 * Браузер присылает событие beforeinstallprompt один раз, поэтому его хранит один общий модуль.
 */
let deferred: InstallEvent | null = null;
let installedFlag = false;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  installedFlag = isStandalone();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installedFlag = true;
    deferred = null;
    emit();
  });
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

const subscribe = (l: () => void) => {
  start();
  listeners.add(l);
  return () => void listeners.delete(l);
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
  const hasEvent = useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  const installed = useSyncExternalStore(subscribe, () => installedFlag, () => false);
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone()), []);

  return {
    installed,
    canPrompt: hasEvent,
    ios,
    async install() {
      if (!deferred) return;
      const e = deferred;
      deferred = null;
      emit();
      await e.prompt();
      await e.userChoice;
    },
  };
}
