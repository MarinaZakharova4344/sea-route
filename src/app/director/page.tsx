import LogoutButton from "../LogoutButton";
import { requirePageRole } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function DirectorHome() {
  const user = await requirePageRole("director");
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Сегодня</h1>
      <p>
        {user.name}, руководитель. Раздел в разработке. <LogoutButton />
      </p>
    </main>
  );
}
