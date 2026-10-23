import { z } from "zod";
import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { ApiError, route } from "@/lib/api";
import { PROFIT_METRICS, getProfitDetail, type ProfitMetric } from "@/lib/analytics/analytics-details";
import { ensureFresh } from "@/lib/calc/recalc";

type Ctx = { params: Promise<{ metric: string }> };

const Query = z.object({ days: z.coerce.number().int().min(7).max(366).default(90) });

/** Подробности к показателю экрана «Доходность»: из чего сложилась цифра за период. */
export const GET = route<Ctx>(["director"], async (request, _user, ctx) => {
  const { metric } = await ctx.params;
  if (!(PROFIT_METRICS as readonly string[]).includes(metric)) throw new ApiError(404, "Такого показателя нет");
  const q = Query.parse(Object.fromEntries(new URL(request.url).searchParams));
  const db = getDb();
  const freshness = ensureFresh(db);
  return json({ ...getProfitDetail(db, q.days, metric as ProfitMetric), freshness });
});
