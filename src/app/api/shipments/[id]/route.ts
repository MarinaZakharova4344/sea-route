import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { idParam, readJson, route } from "@/lib/api";
import { ensureFresh } from "@/lib/calc/recalc";
import { ShipmentInput } from "@/lib/shipments/schemas";
import { getShipment, updateShipment } from "@/lib/shipments/service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(["manager", "director"], async (_request, _user, ctx) => {
  const db = getDb();
  const id = await idParam(ctx);
  const analytics = ensureFresh(db);
  return json({ ...getShipment(db, id), analytics });
});

export const PATCH = route<Ctx>(["manager"], async (request, user, ctx) => {
  const id = await idParam(ctx);
  const input = await readJson(request, ShipmentInput);
  return json(updateShipment(getDb(), user, id, input));
});
