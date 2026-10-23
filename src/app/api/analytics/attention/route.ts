import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { route } from "@/lib/api";
import { getAttention } from "@/lib/analytics/analytics";
import { ensureFresh } from "@/lib/calc/recalc";

/** «Сегодня»: что требует внимания. Только для руководителя. */
export const GET = route(["director"], () => {
  const db = getDb();
  const freshness = ensureFresh(db);
  return json({ ...getAttention(db), freshness });
});
