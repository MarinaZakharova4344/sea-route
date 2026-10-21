import { notFound } from "next/navigation";
import { getDb } from "@/db";
import DetailView from "@/components/director/DetailView";
import { PROFIT_METRICS, getProfitDetail, type ProfitMetric } from "@/lib/analytics-details";
import { ensureFresh } from "@/lib/recalc";

type Props = { params: Promise<{ metric: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProfitDetails({ params, searchParams }: Props) {
  const { metric } = await params;
  const sp = await searchParams;
  if (!(PROFIT_METRICS as readonly string[]).includes(metric)) notFound();
  const days = [30, 90, 180].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const db = getDb();
  const freshness = ensureFresh(db);
  return <DetailView page={getProfitDetail(db, days, metric as ProfitMetric)} back={{ href: `/director/profit?days=${days}`, label: "Что приносит прибыль" }} freshness={freshness} />;
}
