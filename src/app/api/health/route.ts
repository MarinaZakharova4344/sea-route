import { getDb } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Проверка работоспособности для мониторинга и балансировщика: приложение запущено и база отвечает.
 * Без входа, и без каких-либо данных в ответе.
 */
export function GET(): Response {
  try {
    getDb().prepare("SELECT 1").get();
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error" }, { status: 503 });
  }
}
