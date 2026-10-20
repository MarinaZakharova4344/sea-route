import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { idParam, readJson, route } from "@/lib/api";
import { LineCreate } from "@/lib/shipments/schemas";
import { addLine } from "@/lib/shipments/service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(["manager"], async (request, user, ctx) => {
  const id = await idParam(ctx);
  return json(addLine(getDb(), user, id, await readJson(request, LineCreate)), 201);
});
