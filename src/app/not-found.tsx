import AppScene from "@/components/layout/AppScene";
import NotFoundView from "@/components/layout/NotFoundView";
import { getCurrentUser, homeFor } from "@/lib/auth/server";
import "./app.css";

export const metadata = { title: "Страница не найдена · Морской маршрут" };

/** Адрес, которого нет вообще (вне разделов руководителя и менеджера): страница в стиле приложения вместо стандартной белой. */
export default async function NotFound() {
  const user = await getCurrentUser();
  return (
    <div className="app">
      <AppScene />
      <main className="page">
        <NotFoundView homeHref={user ? homeFor(user.role) : "/login"} homeLabel={user ? "К главному экрану" : "Ко входу"} />
      </main>
    </div>
  );
}
