import { z } from "zod";
import { isForeignOrigin, json } from "@/lib/auth/authorize";
import { checkCredentials } from "@/lib/auth/login";
import { sessionCookie, signSession } from "@/lib/auth/session";

const Body = z.object({ email: z.string().min(1).max(200), password: z.string().min(1).max(200) });

export async function POST(request: Request): Promise<Response> {
  if (isForeignOrigin(request)) return json({ error: "Запрос с недопустимого источника" }, 403);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Укажите e-mail и пароль" }, 400);

  const result = await checkCredentials(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    if (result.reason === "locked") {
      return json({ error: "Слишком много неудачных попыток. Попробуйте через 15 минут" }, 429);
    }
    return json({ error: "Неверный e-mail или пароль" }, 401);
  }

  const token = await signSession(result.user.id);
  return json({ user: result.user }, 200, { "Set-Cookie": sessionCookie(token) });
}
