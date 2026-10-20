import LogoutButton from "../LogoutButton";
import { requirePageRole } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function ManagerHome() {
  const user = await requirePageRole("manager");
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Перевозки</h1>
      <p>
        {user.name}, менеджер. Раздел в разработке. <LogoutButton />
      </p>
    </main>
  );
}
