import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { idParam, route } from "@/lib/api";
import { reopenFinance } from "@/lib/shipments/service";

type Ctx = { params: Promise<{ id: string }> };

/** Открыть перевозку заново, например когда после закрытия пришёл ещё один счёт. */
export const POST = route<Ctx>(["manager"], async (_request, user, ctx) => json(reopenFinance(getDb(), user, await idParam(ctx))));
