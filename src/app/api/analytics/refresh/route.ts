import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { route } from "@/lib/api";
import { recalcAll, refreshInfo } from "@/lib/recalc";

/** Кнопка «Обновить»: пересчитать аналитику сейчас, не дожидаясь планового обновления. */
export const POST = route(["manager", "director"], () => {
  const db = getDb();
  const count = recalcAll(db);
  return json({ recalculated: count, ...refreshInfo(db) });
});
