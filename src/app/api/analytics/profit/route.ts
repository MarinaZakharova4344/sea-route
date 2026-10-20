import { z } from "zod";
import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { route } from "@/lib/api";
import { getProfit } from "@/lib/analytics";
import { ensureFresh } from "@/lib/recalc";

const Query = z.object({
  days: z.coerce.number().int().min(7).max(366).default(90),
  groupBy: z.enum(["client", "direction"]).default("client"),
});

/** «Доходность»: результат по клиентам или направлениям за период (по дате доставки). */
export const GET = route(["director"], (request) => {
  const q = Query.parse(Object.fromEntries(new URL(request.url).searchParams));
  const db = getDb();
  const freshness = ensureFresh(db);
  return json({ ...getProfit(db, q.days, q.groupBy), freshness });
});
