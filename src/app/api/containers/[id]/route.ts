import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { idParam, readJson, route } from "@/lib/api";
import { ContainerInput } from "@/lib/shipments/schemas";
import { deleteContainer, updateContainer } from "@/lib/shipments/service";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(["manager"], async (request, user, ctx) => {
  const id = await idParam(ctx);
  return json(updateContainer(getDb(), user, id, await readJson(request, ContainerInput)));
});

export const DELETE = route<Ctx>(["manager"], async (_request, user, ctx) => json(deleteContainer(getDb(), user, await idParam(ctx))));
