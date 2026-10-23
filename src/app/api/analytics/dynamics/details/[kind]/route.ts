import { z } from "zod";
import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { ApiError, route } from "@/lib/api";
import { DYNAMICS_KINDS, getDynamicsDetail, type DynamicsKind } from "@/lib/analytics/analytics-details";
import { ensureFresh } from "@/lib/calc/recalc";

type Ctx = { params: Promise<{ kind: string }> };

const Query = z.object({ weeks: z.coerce.number().int().min(1).max(13).default(4) });

/** Подробности к блоку экрана «Динамика»: что стоит за изменением маржи. */
export const GET = route<Ctx>(["director"], async (request, _user, ctx) => {
  const { kind } = await ctx.params;
  if (!(DYNAMICS_KINDS as readonly string[]).includes(kind)) throw new ApiError(404, "Такого раздела нет");
  const q = Query.parse(Object.fromEntries(new URL(request.url).searchParams));
  const db = getDb();
  const freshness = ensureFresh(db);
  return json({ ...getDynamicsDetail(db, q.weeks, kind as DynamicsKind), freshness });
});
