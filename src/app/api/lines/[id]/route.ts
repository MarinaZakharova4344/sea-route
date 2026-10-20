import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { idParam, readJson, route } from "@/lib/api";
import { LineInput } from "@/lib/shipments/schemas";
import { deleteLine, updateLine } from "@/lib/shipments/service";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(["manager"], async (request, user, ctx) => {
  const id = await idParam(ctx);
  return json(updateLine(getDb(), user, id, await readJson(request, LineInput)));
});

export const DELETE = route<Ctx>(["manager"], async (_request, user, ctx) => json(deleteLine(getDb(), user, await idParam(ctx))));
