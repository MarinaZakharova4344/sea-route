import { notFound } from "next/navigation";
import { getDb } from "@/db";
import DetailView from "@/components/DetailView";
import { ATTENTION_KINDS, getAttentionDetail, type AttentionKind } from "@/lib/analytics-details";
import { ensureFresh } from "@/lib/recalc";

export default async function AttentionDetails({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(ATTENTION_KINDS as readonly string[]).includes(kind)) notFound();
  const db = getDb();
  const freshness = ensureFresh(db);
  return <DetailView page={getAttentionDetail(db, kind as AttentionKind)} back={{ href: "/director", label: "Что требует внимания" }} freshness={freshness} />;
}
