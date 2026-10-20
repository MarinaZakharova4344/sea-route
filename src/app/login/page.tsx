import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/auth/server";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>Морской маршрут</h1>
      <p style={{ marginTop: 0, color: "#556" }}>Вход для менеджеров и руководителя</p>
      <LoginForm />
    </main>
  );
}
