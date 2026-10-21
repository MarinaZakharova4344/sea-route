import { z } from "zod";
import { clientIp, isForeignOrigin, json } from "@/lib/auth/authorize";
import { checkCredentials } from "@/lib/auth/login";
import { REMEMBER_TTL_SECONDS, isSecureRequest, SESSION_TTL_SECONDS, sessionCookie, signSession } from "@/lib/auth/session";

const Body = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  if (isForeignOrigin(request)) return json({ error: "Запрос с недопустимого источника" }, 403);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Укажите e-mail и пароль" }, 400);

  const result = await checkCredentials(parsed.data.email, parsed.data.password, undefined, undefined, clientIp(request));
  if (!result.ok) {
    if (result.reason === "locked") {
      return json({ error: "Слишком много неудачных попыток. Попробуйте через 15 минут" }, 429);
    }
    return json({ error: "Неверный e-mail или пароль" }, 401);
  }

  const remember = parsed.data.remember === true;
  const token = await signSession(result.user.id, remember ? REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS);
  return json({ user: result.user }, 200, { "Set-Cookie": sessionCookie(token, remember, isSecureRequest(request)) });
}
