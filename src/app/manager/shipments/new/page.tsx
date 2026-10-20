import Link from "next/link";
import { getDb } from "@/db";
import ShipmentForm from "@/components/manager/ShipmentForm";
import { requirePageRole } from "@/lib/auth/server";
import { referenceData } from "@/lib/shipments/service";

export default async function NewShipment() {
  const user = await requirePageRole("manager");
  const reference = referenceData(getDb());
  return (
    <div className="mpage">
      <Link href="/manager" className="back">
        ← Все перевозки
      </Link>
      <div className="mpage__head">
        <div>
          <h1 className="page__title">Новая перевозка</h1>
          <p className="page__sub">Заполните то, что известно сейчас. Остальное можно добавить позже.</p>
        </div>
      </div>
      <section className="panel msec">
        <h2>Основное</h2>
        <ShipmentForm
          mode="new"
          reference={reference}
          currentUserId={user.id}
          initial={{
            clientId: null,
            directionId: null,
            managerId: user.id,
            cargoDescription: null,
            status: "draft",
            plannedDeparture: null,
            actualDeparture: null,
            plannedArrival: null,
            actualArrival: null,
          }}
        />
      </section>
    </div>
  );
}
