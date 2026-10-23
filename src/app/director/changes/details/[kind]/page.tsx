import { notFound } from "next/navigation";
import { getDb } from "@/db";
import DetailView from "@/components/director/DetailView";
import { DYNAMICS_KINDS, getDynamicsDetail, type DynamicsKind } from "@/lib/analytics/analytics-details";
import { ensureFresh } from "@/lib/calc/recalc";

type Props = { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ChangesDetails({ params, searchParams }: Props) {
  const { kind } = await params;
  const sp = await searchParams;
  if (!(DYNAMICS_KINDS as readonly string[]).includes(kind)) notFound();
  const weeks = [2, 4, 8].includes(Number(sp.weeks)) ? Number(sp.weeks) : 4;
  const db = getDb();
  const freshness = ensureFresh(db);
  return <DetailView page={getDynamicsDetail(db, weeks, kind as DynamicsKind)} back={{ href: `/director/changes?weeks=${weeks}`, label: "Что изменилось" }} freshness={freshness} />;
}
