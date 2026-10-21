"use client";

import { useEffect } from "react";

/** Подключает service worker (только в рабочей сборке: в режиме разработки он мешал бы обновлению страниц). */
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
