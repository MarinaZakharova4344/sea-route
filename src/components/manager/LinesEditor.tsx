"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call, toIntOrNull } from "@/lib/client-api";
import Field from "./Field";

export interface Line {
  id: number;
  kind: "income" | "expense";
  counterpartyId: number | null;
  description: string;
  plannedAmount: number;
  actualAmount: number | null;
  isUnplanned: boolean;
  paymentStatus: "unpaid" | "partial" | "paid";
  paidAmount: number;
  dueDate: string | null;
  paidAt: string | null;
}

type Counterparty = { id: number; name: string; type: string };

const PAYMENT = [
  { value: "unpaid", label: "Не оплачено" },
  { value: "partial", label: "Оплачено частично" },
  { value: "paid", label: "Оплачено" },
];

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

interface Draft {
  kind: "income" | "expense";
  description: string;
  counterpartyId: string;
  plannedAmount: string;
  actualAmount: string;
  isUnplanned: boolean;
  paymentStatus: string;
  paidAmount: string;
  dueDate: string;
  paidAt: string;
}

const emptyDraft = (kind: "income" | "expense"): Draft => ({
  kind,
  description: "",
  counterpartyId: "",
  plannedAmount: "",
  actualAmount: "",
  isUnplanned: false,
  paymentStatus: "unpaid",
  paidAmount: "",
  dueDate: "",
  paidAt: "",
});

const fromLine = (l: Line): Draft => ({
  kind: l.kind,
  description: l.description,
  counterpartyId: s(l.counterpartyId),
  plannedAmount: s(l.plannedAmount),
  actualAmount: s(l.actualAmount),
  isUnplanned: l.isUnplanned,
  paymentStatus: l.paymentStatus,
  paidAmount: l.paymentStatus === "partial" ? s(l.paidAmount) : "",
  dueDate: s(l.dueDate),
  paidAt: s(l.paidAt),
});

function toBody(d: Draft, includeKind: boolean) {
  const planned = toIntOrNull(d.plannedAmount);
  const actual = toIntOrNull(d.actualAmount);
  const paid = toIntOrNull(d.paidAmount);
  return {
    ...(includeKind ? { kind: d.kind } : {}),
    description: d.description,
    counterpartyId: d.counterpartyId === "" ? null : Number(d.counterpartyId),
    plannedAmount: planned === null ? 0 : planned,
    actualAmount: actual,
    isUnplanned: d.isUnplanned,
    paymentStatus: d.paymentStatus,
    ...(d.paymentStatus === "partial" && paid !== null ? { paidAmount: paid } : {}),
    dueDate: d.dueDate === "" ? null : d.dueDate,
    ...(d.paymentStatus !== "unpaid" && d.paidAt !== "" ? { paidAt: d.paidAt } : {}),
  };
}

/** Поля одной строки дохода или расхода. */
const COUNTERPARTY_TYPES = [
  { value: "carrier", label: "Перевозчик" },
  { value: "terminal", label: "Терминал" },
  { value: "broker", label: "Брокер" },
  { value: "other", label: "Другой подрядчик" },
];

function LineFields({
  d,
  set,
  errors,
  counterparties,
  onCounterpartyAdded,
}: {
  d: Draft;
  set: (patch: Partial<Draft>) => void;
  errors: Record<string, string>;
  counterparties: Counterparty[];
  onCounterpartyAdded: (c: Counterparty) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("carrier");
  const [addError, setAddError] = useState<string | null>(null);

  async function addCounterparty() {
    setAddError(null);
    const res = await call<Counterparty>("POST", "/api/counterparties", { name, type });
    if (!res.ok) return setAddError(res.fieldErrors.name ?? res.error);
    onCounterpartyAdded(res.data);
    set({ counterpartyId: String(res.data.id) });
    setName("");
    setAdding(false);
  }

  return (
    <div className="lgrid">
      <Field label="За что" error={errors.description} wide>
        <input className="control" value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder={d.kind === "income" ? "Например: морская перевозка" : "Например: морской фрахт"} maxLength={200} />
      </Field>
      <Field label={d.kind === "income" ? "От кого" : "Контрагент"} error={errors.counterpartyId}>
        <select className="control" value={d.counterpartyId} onChange={(e) => set({ counterpartyId: e.target.value })}>
          <option value="">{d.kind === "income" ? "Клиент перевозки" : "Не выбран"}</option>
          {counterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {d.kind === "expense" && !adding && (
          <button type="button" className="linkbtn" onClick={() => setAdding(true)}>
            + Новый контрагент
          </button>
        )}
      </Field>
      {adding && (
        <div className="inline-add field--wide">
          <input className="control" placeholder="Название перевозчика или подрядчика" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? (e.preventDefault(), addCounterparty()) : e.key === "Escape" && setAdding(false))} maxLength={200} autoFocus />
          <select className="control" value={type} onChange={(e) => setType(e.target.value)} aria-label="Вид подрядчика">
            {COUNTERPARTY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={addCounterparty}>
            Добавить
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setAdding(false)}>
            Отмена
          </button>
          {addError && <span className="msg msg--error">{addError}</span>}
        </div>
      )}
      <Field label="План, ₽" error={errors.plannedAmount}>
        <input className="control" inputMode="numeric" value={d.plannedAmount} onChange={(e) => set({ plannedAmount: e.target.value })} />
      </Field>
      <Field label="Факт, ₽" error={errors.actualAmount} hint="Пусто, пока нет счёта">
        <input className="control" inputMode="numeric" value={d.actualAmount} onChange={(e) => set({ actualAmount: e.target.value })} />
      </Field>
      <Field label="Оплата" error={errors.paymentStatus}>
        <select className="control" value={d.paymentStatus} onChange={(e) => set({ paymentStatus: e.target.value })}>
          {PAYMENT.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {d.paymentStatus === "partial" && (
        <Field label="Оплачено, ₽" error={errors.paidAmount}>
          <input className="control" inputMode="numeric" value={d.paidAmount} onChange={(e) => set({ paidAmount: e.target.value })} />
        </Field>
      )}
      <Field label="Срок оплаты" error={errors.dueDate}>
        <input className="control" type="date" value={d.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
      </Field>
      {d.paymentStatus !== "unpaid" && (
        <Field label="Дата оплаты" error={errors.paidAt} hint="Если пусто, будет сегодняшняя">
          <input className="control" type="date" value={d.paidAt} onChange={(e) => set({ paidAt: e.target.value })} />
        </Field>
      )}
      {d.kind === "expense" && (
        <label className="check-inline lgrid__check">
          <input type="checkbox" checked={d.isUnplanned} onChange={(e) => set({ isUnplanned: e.target.checked })} />
          Внеплановый расход (например, хранение в порту)
        </label>
      )}
    </div>
  );
}

function LineCard({ line, counterparties, locked, onCounterpartyAdded }: { line: Line; counterparties: Counterparty[]; locked: boolean; onCounterpartyAdded: (c: Counterparty) => void }) {
  const router = useRouter();
  const initial = fromLine(line);
  const [d, setD] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  async function save() {
    setMsg(null);
    setErrors({});
    for (const [k, val] of [["plannedAmount", d.plannedAmount], ["actualAmount", d.actualAmount], ["paidAmount", d.paidAmount]] as const) {
      if (Number.isNaN(toIntOrNull(val))) return setErrors({ [k]: "Введите число" });
    }
    setBusy(true);
    const res = await call("PATCH", `/api/lines/${line.id}`, toBody(d, false));
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      return setMsg(Object.keys(res.fieldErrors).length ? "Проверьте поля, отмеченные красным" : res.error);
    }
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Удалить строку «${line.description}»?`)) return;
    setBusy(true);
    const res = await call("DELETE", `/api/lines/${line.id}`);
    setBusy(false);
    if (!res.ok) return setMsg(res.error);
    router.refresh();
  }

  return (
    <li className={`lcard lcard--${line.kind}`}>
      <div className="lcard__head">
        <span className={`kind kind--${line.kind}`}>{line.kind === "income" ? "Доход" : "Расход"}</span>
        {line.isUnplanned && <span className="chip chip--overrun">внеплановый</span>}
        {line.actualAmount === null && <span className="chip">нет факта</span>}
      </div>
      <fieldset disabled={locked || busy} className="lcard__fields">
        <LineFields d={d} set={(p) => setD((x) => ({ ...x, ...p }))} errors={errors} counterparties={counterparties} onCounterpartyAdded={onCounterpartyAdded} />
      </fieldset>
      {!locked && (
        <div className="lcard__foot">
          <button type="button" className="btn" onClick={save} disabled={!dirty || busy}>
            Сохранить строку
          </button>
          <button type="button" className="btn btn--danger" onClick={remove} disabled={busy}>
            Удалить
          </button>
          {msg && <span className="msg msg--error">{msg}</span>}
        </div>
      )}
    </li>
  );
}

function NewLine({ shipmentId, counterparties, onDone, onCounterpartyAdded }: { shipmentId: number; counterparties: Counterparty[]; onDone: () => void; onCounterpartyAdded: (c: Counterparty) => void }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(emptyDraft("expense"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setMsg(null);
    setErrors({});
    for (const [k, val] of [["plannedAmount", d.plannedAmount], ["actualAmount", d.actualAmount], ["paidAmount", d.paidAmount]] as const) {
      if (Number.isNaN(toIntOrNull(val))) return setErrors({ [k]: "Введите число" });
    }
    setBusy(true);
    const res = await call("POST", `/api/shipments/${shipmentId}/lines`, toBody(d, true));
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      return setMsg(Object.keys(res.fieldErrors).length ? "Проверьте поля, отмеченные красным" : res.error);
    }
    onDone();
    router.refresh();
  }

  return (
    <div className="lcard lcard--new">
      <div className="lcard__head">
        <div className="seg-control seg-control--small" role="group" aria-label="Тип строки">
          {(["expense", "income"] as const).map((k) => (
            <button key={k} type="button" className={`seg-control__btn${d.kind === k ? " seg-control__btn--on" : ""}`} onClick={() => setD((x) => ({ ...x, kind: k, isUnplanned: false }))} aria-pressed={d.kind === k}>
              {k === "expense" ? "Расход" : "Доход"}
            </button>
          ))}
        </div>
      </div>
      <fieldset disabled={busy} className="lcard__fields">
        <LineFields d={d} set={(p) => setD((x) => ({ ...x, ...p }))} errors={errors} counterparties={counterparties} onCounterpartyAdded={onCounterpartyAdded} />
      </fieldset>
      <div className="lcard__foot">
        <button type="button" className="btn" onClick={add} disabled={busy}>
          Добавить строку
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Отмена
        </button>
        {msg && <span className="msg msg--error">{msg}</span>}
      </div>
    </div>
  );
}

export default function LinesEditor({ shipmentId, lines, counterparties: initialCounterparties, locked }: { shipmentId: number; lines: Line[]; counterparties: Counterparty[]; locked: boolean }) {
  const [adding, setAdding] = useState(false);
  const [counterparties, setCounterparties] = useState(initialCounterparties);
  const addCounterparty = (c: Counterparty) => setCounterparties((list) => [...list.filter((x) => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name, "ru")));
  return (
    <div>
      {lines.length === 0 && !adding ? <p className="muted">Строк пока нет. Расходы можно вносить по мере поступления счетов.</p> : null}
      <ul className="llist">
        {lines.map((l) => (
          <LineCard key={`${l.id}-${l.plannedAmount}-${l.actualAmount}-${l.paymentStatus}-${l.dueDate}-${l.paidAt}-${l.description}-${l.counterpartyId}-${l.isUnplanned}`} line={l} counterparties={counterparties} locked={locked} onCounterpartyAdded={addCounterparty} />
        ))}
      </ul>
      {!locked && (adding ? <NewLine shipmentId={shipmentId} counterparties={counterparties} onDone={() => setAdding(false)} onCounterpartyAdded={addCounterparty} /> : (
        <div className="sec-foot">
          <button type="button" className="btn btn--ghost" onClick={() => setAdding(true)}>
            + Добавить доход или расход
          </button>
        </div>
      ))}
    </div>
  );
}
