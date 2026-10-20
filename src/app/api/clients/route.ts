import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { readJson, route } from "@/lib/api";
import { ClientInput } from "@/lib/shipments/schemas";
import { createClient } from "@/lib/shipments/service";

export const POST = route(["manager"], async (request) => json(createClient(getDb(), await readJson(request, ClientInput)), 201));
