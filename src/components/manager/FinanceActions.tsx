"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { call } from "@/lib/client-api";
import { formatDate, formatMoney } from "@/lib/format";

interface Problem {
  id: number;
  description: string;
  kind?: string;
  remaining?: number;
}

/** «Закрыть финансово» и «Открыть заново»: после закрытия маржа по перевозке становится окончательной. */
export default function FinanceActions({ shipmentId, status, financeClosedAt }: { shipmentId: number; status: string; financeClosedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [missing, setMissing] = useState<Problem[] | null>(null);
  const [unpaid, setUnpaid] = useState<Problem[] | null>(null);
  const [noIncome, setNoIncome] = useState(false);
  // Подтверждения копятся: подтвердили «нет дохода», потом выяснилось про неоплаченное, и первое не нужно подтверждать снова.
  const confirmed = useRef<{ confirmUnpaid?: boolean; confirmNoIncome?: boolean }>({});

  async function close(confirm: { confirmUnpaid?: boolean; confirmNoIncome?: boolean } = {}) {
    confirmed.current = { ...confirmed.current, ...confirm };
    setBusy(true);
    setMsg(null);
    setMissing(null);
    setUnpaid(null);
    setNoIncome(false);
    const res = await call("POST", `/api/shipments/${shipmentId}/close-finance`, confirmed.current);
    setBusy(false);
    if (res.ok) return router.refresh();
    const details = res.details as { code?: string; lines?: Problem[] } | null;
    if (res.status === 422 && details?.code === "missing_actual") return setMissing(details.lines ?? []);
    if (res.status === 409 && details?.code === "no_income") return setNoIncome(true);
    if (res.status === 409 && details?.code === "unpaid_lines") return setUnpaid(details.lines ?? []);
    setMsg(res.error);
  }

  async function reopen() {
    if (!window.confirm("Открыть перевозку заново? Результат снова станет предварительным.")) return;
    setBusy(true);
    setMsg(null);
    const res = await call("POST", `/api/shipments/${shipmentId}/reopen-finance`);
    setBusy(false);
    if (!res.ok) return setMsg(res.error);
    router.refresh();
  }

  if (financeClosedAt) {
    return (
      <div className="fin fin--closed" role="status">
        <div>
          <strong>Закрыта финансово {formatDate(financeClosedAt)}</strong>
          <span>Результат окончательный. Чтобы внести изменения, откройте перевозку заново.</span>
        </div>
        <button type="button" className="btn btn--ghost" onClick={reopen} disabled={busy}>
          Открыть заново
        </button>
        {msg && <p className="msg msg--error">{msg}</p>}
      </div>
    );
  }

  const eligible = status === "arrived" || status === "cancelled";
  return (
    <div className="fin">
      <div>
        <strong>Финансовое закрытие</strong>
        <span>
          {eligible
            ? "Когда по всем строкам есть фактические суммы, закройте перевозку: результат станет окончательным."
            : "Закрыть можно после доставки (статус «Прибыла») или отмены перевозки."}
        </span>
      </div>
      <button type="button" className="btn" onClick={() => { confirmed.current = {}; void close(); }} disabled={!eligible || busy}>
        {busy ? "Закрываем…" : "Закрыть финансово"}
      </button>
      {msg && <p className="msg msg--error">{msg}</p>}

      {missing && (
        <div className="fin__problem" role="alert">
          <strong>Нельзя закрыть: нет фактической суммы по строкам</strong>
          <ul>
            {missing.map((p) => (
              <li key={p.id}>{p.description}</li>
            ))}
          </ul>
          <span>Внесите факт (сумму по счёту) в блоке «Доходы и расходы» и повторите.</span>
        </div>
      )}

      {noIncome && (
        <div className="fin__problem fin__problem--warn" role="alert">
          <strong>В перевозке нет дохода</strong>
          <span>Нет ни одной строки дохода (счёта клиенту), поэтому результат будет убытком. Возможно, счёт забыли внести.</span>
          <div className="fin__btns">
            <button type="button" className="btn" onClick={() => close({ confirmNoIncome: true })} disabled={busy}>
              Закрыть без дохода
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setNoIncome(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {unpaid && (
        <div className="fin__problem fin__problem--warn" role="alert">
          <strong>Есть неоплаченные строки</strong>
          <ul>
            {unpaid.map((p) => (
              <li key={p.id}>
                {p.description}: осталось {formatMoney(p.remaining ?? 0)}
              </li>
            ))}
          </ul>
          <span>Если так и должно быть, подтвердите закрытие.</span>
          <div className="fin__btns">
            <button type="button" className="btn" onClick={() => close({ confirmUnpaid: true })} disabled={busy}>
              Закрыть всё равно
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setUnpaid(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
