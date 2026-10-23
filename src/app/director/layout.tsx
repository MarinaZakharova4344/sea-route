import type { ReactNode } from "react";
import AppHeader from "@/components/layout/AppHeader";
import { DIRECTOR_NAV } from "@/lib/nav-config";
import { requirePageRole } from "@/lib/auth/server";
import "../app.css";
import "./director.css";

export const dynamic = "force-dynamic";

export default async function DirectorLayout({ children }: { children: ReactNode }) {
  const user = await requirePageRole("director");
  return (
    <div className="app app--director">
      <AppHeader userName={user.name} roleLabel="Руководитель" home="/director" nav={DIRECTOR_NAV} />
      <main className="page page--director">{children}</main>
    </div>
  );
}
