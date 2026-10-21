const TONE: Record<string, string> = {
  draft: "badge--gray",
  booked: "badge--blue",
  in_transit: "badge--sky",
  arrived: "badge--teal",
  closed: "badge--green",
  cancelled: "badge--red",
};

export default function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge ${TONE[status] ?? "badge--gray"}`}>{label}</span>;
}
