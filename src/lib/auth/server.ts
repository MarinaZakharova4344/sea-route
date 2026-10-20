import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUserByToken, type AuthUser, type Role } from "./authorize";
import { SESSION_COOKIE } from "./session";

/** Для серверных страниц: текущий пользователь или null. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  return getUserByToken(store.get(SESSION_COOKIE)?.value);
}

export function homeFor(role: Role): string {
  return role === "director" ? "/director" : "/manager";
}

/** Серверная защита страницы: без входа отправляем на /login, чужую роль на свою главную. */
export async function requirePageRole(role: Role): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect(homeFor(user.role));
  return user;
}
