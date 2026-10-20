import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { readJson, route } from "@/lib/api";
import { ensureFresh } from "@/lib/recalc";
import { ListQuery, ShipmentInput } from "@/lib/shipments/schemas";
import { createShipment, listShipments } from "@/lib/shipments/service";

export const GET = route(["manager", "director"], (request) => {
  const db = getDb();
  const query = ListQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  const analytics = ensureFresh(db);
  return json({ ...listShipments(db, query), analytics });
});

export const POST = route(["manager"], async (request, user) => {
  const input = await readJson(request, ShipmentInput);
  return json(createShipment(getDb(), user, input), 201);
});
