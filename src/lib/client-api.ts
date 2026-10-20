/** Вызовы API из браузера: единый разбор ответов и ошибок. */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; fieldErrors: Record<string, string>; details: unknown };

export async function call<T = unknown>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "Нет связи с сервером. Изменения не сохранены, повторите позже", fieldErrors: {}, details: null };
  }
  const data = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: data as T };

  const fieldErrors: Record<string, string> = {};
  const details = data?.details;
  if (Array.isArray(details)) {
    for (const d of details) if (d && typeof d.field === "string" && !fieldErrors[d.field]) fieldErrors[d.field] = String(d.message);
  }
  const error =
    res.status === 401 ? "Сессия закончилась. Войдите снова" : res.status === 403 ? "Недостаточно прав для этого действия" : (data?.error ?? "Не удалось выполнить действие");
  return { ok: false, status: res.status, error, fieldErrors, details };
}

/** Число из поля ввода: пустое поле означает «нет значения». */
export function toIntOrNull(v: string): number | null {
  const t = v.replace(/\s/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}
