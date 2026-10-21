import { isForeignOrigin, json } from "@/lib/auth/authorize";
import { clearedSessionCookie, isSecureRequest } from "@/lib/auth/session";

export async function POST(request: Request): Promise<Response> {
  if (isForeignOrigin(request)) return json({ error: "Запрос с недопустимого источника" }, 403);
  return json({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie(isSecureRequest(request)) });
}
