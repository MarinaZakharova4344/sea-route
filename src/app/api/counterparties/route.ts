import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { readJson, route } from "@/lib/api";
import { CounterpartyInput } from "@/lib/shipments/schemas";
import { createCounterparty } from "@/lib/shipments/service";

export const POST = route(["manager"], async (request) => json(createCounterparty(getDb(), await readJson(request, CounterpartyInput)), 201));
