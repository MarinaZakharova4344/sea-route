import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { readJson, route } from "@/lib/api";
import { DirectionInput } from "@/lib/shipments/schemas";
import { createDirection } from "@/lib/shipments/service";

export const POST = route(["manager"], async (request) => json(createDirection(getDb(), await readJson(request, DirectionInput)), 201));
