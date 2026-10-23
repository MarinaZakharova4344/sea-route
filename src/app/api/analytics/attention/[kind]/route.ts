import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { ApiError, route } from "@/lib/api";
import { ATTENTION_KINDS, getAttentionDetail, type AttentionKind } from "@/lib/analytics/analytics-details";
import { ensureFresh } from "@/lib/calc/recalc";

type Ctx = { params: Promise<{ kind: string }> };

/** Подробности к блоку экрана «Сегодня»: причина внимания или деньги под риском. Только для руководителя. */
export const GET = route<Ctx>(["director"], async (_request, _user, ctx) => {
  const { kind } = await ctx.params;
  if (!(ATTENTION_KINDS as readonly string[]).includes(kind)) throw new ApiError(404, "Такого раздела нет");
  const db = getDb();
  const freshness = ensureFresh(db);
  return json({ ...getAttentionDetail(db, kind as AttentionKind), freshness });
});
