import type { ReactNode } from "react";
import AppHeader from "@/components/AppHeader";
import AppScene from "@/components/AppScene";
import { MANAGER_NAV } from "@/lib/nav-config";
import { requirePageRole } from "@/lib/auth/server";
import "../app.css";
import "./manager.css";

export const dynamic = "force-dynamic";

export default async function ManagerLayout({ children }: { children: ReactNode }) {
  const user = await requirePageRole("manager");
  return (
    <div className="app">
      <AppScene />
      <AppHeader userName={user.name} roleLabel="Менеджер" home="/manager" nav={MANAGER_NAV} />
      <main className="page">{children}</main>
    </div>
  );
}
