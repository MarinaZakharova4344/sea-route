import { getDb } from "@/db";
import { json } from "@/lib/auth/authorize";
import { route } from "@/lib/api";
import { referenceData } from "@/lib/shipments/service";

/** Справочники для форм и фильтров: клиенты, направления, контрагенты, менеджеры, статусы. */
export const GET = route(["manager", "director"], () => json(referenceData(getDb())));
