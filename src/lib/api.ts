import { ZodError, type ZodType } from "zod";
import { json, withAuth, type AuthUser, type Role } from "@/lib/auth/authorize";

/** Ошибка с понятным пользователю текстом и кодом ответа. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function toResponse(e: unknown): Response {
  if (e instanceof ApiError) return json({ error: e.message, details: e.details }, e.status);
  if (e instanceof ZodError) {
    return json(
      {
        error: "Проверьте введённые данные",
        details: e.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      422,
    );
  }
  console.error(e);
  return json({ error: "Внутренняя ошибка сервера" }, 500);
}

type Handler<C> = (request: Request, user: AuthUser, context: C) => Response | Promise<Response>;

/** Обработчик API: проверка входа и роли + единообразная обработка ошибок. */
export function route<C = unknown>(roles: readonly Role[] | undefined, handler: Handler<C>) {
  return withAuth<C>(roles, async (request, user, context) => {
    try {
      return await handler(request, user, context);
    } catch (e) {
      return toResponse(e);
    }
  });
}

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "Тело запроса должно быть в формате JSON");
  }
  return schema.parse(body);
}

export async function idParam(context: { params: Promise<{ id: string }> }): Promise<number> {
  const { id } = await context.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, "Не найдено");
  return n;
}
