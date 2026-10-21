import BackLink from "@/components/layout/BackLink";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import ShipmentView from "@/components/shipment/ShipmentView";
import { ensureFresh } from "@/lib/recalc";
import { getShipment } from "@/lib/shipments/service";

export default async function DirectorShipment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const db = getDb();
  ensureFresh(db);
  let shipment;
  try {
    shipment = getShipment(db, n);
  } catch {
    notFound();
  }
  return (
    <>
      <BackLink href="/director">
        ← Назад
      </BackLink>
      <ShipmentView s={shipment} />
    </>
  );
}
