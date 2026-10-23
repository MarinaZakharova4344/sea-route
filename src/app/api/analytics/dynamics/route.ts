import { z } from "zod";
import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { route } from "@/lib/api";
import { getDynamics } from "@/lib/analytics/analytics";
import { ensureFresh } from "@/lib/calc/recalc";

const Query = z.object({ weeks: z.coerce.number().int().min(1).max(13).default(4) });

/** «Динамика»: период против предыдущего такой же длины и перевозки, которые объясняют изменение. */
export const GET = route(["director"], (request) => {
  const q = Query.parse(Object.fromEntries(new URL(request.url).searchParams));
  const db = getDb();
  const freshness = ensureFresh(db);
  return json({ ...getDynamics(db, q.weeks), freshness });
});
