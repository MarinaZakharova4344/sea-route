import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { idParam, readJson, route } from "@/lib/api";
import { CloseFinanceInput } from "@/lib/shipments/schemas";
import { closeFinance } from "@/lib/shipments/service";

type Ctx = { params: Promise<{ id: string }> };

/** «Закрыть финансово»: после этого маржа по перевозке считается окончательной. */
export const POST = route<Ctx>(["manager"], async (request, user, ctx) => {
  const id = await idParam(ctx);
  const raw = await request.text();
  const body = raw ? await readJson(new Request(request.url, { method: "POST", body: raw }), CloseFinanceInput) : {};
  return json(closeFinance(getDb(), user, id, body.confirmUnpaid === true));
});
