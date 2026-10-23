"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call, toIntOrNull } from "@/lib/client-api";
import Field from "./Field";

interface Container {
  id: number;
  number: string | null;
  type: string | null;
  weightKg: number | null;
}

const TYPES = [
  { value: "20", label: "20'" },
  { value: "40", label: "40'" },
  { value: "40HC", label: "40' HC" },
];

function Row({ c, locked }: { c: Container; locked: boolean }) {
  const router = useRouter();
  const [number, setNumber] = useState(c.number ?? "");
  const [type, setType] = useState(c.type ?? "");
  const [weight, setWeight] = useState(c.weightKg === null ? "" : String(c.weightKg));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = number !== (c.number ?? "") || type !== (c.type ?? "") || weight !== (c.weightKg === null ? "" : String(c.weightKg));

  async function save() {
    setMsg(null);
    setErrors({});
    const w = toIntOrNull(weight);
    if (Number.isNaN(w)) return setErrors({ weightKg: "Введите число" });
    setBusy(true);
    const res = await call("PATCH", `/api/containers/${c.id}`, { number: number.trim() === "" ? null : number, type: type === "" ? null : type, weightKg: w });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      return setMsg(Object.keys(res.fieldErrors).length ? "Проверьте поля" : res.error);
    }
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("Удалить контейнер?")) return;
    setBusy(true);
    const res = await call("DELETE", `/api/containers/${c.id}`);
    setBusy(false);
    if (!res.ok) return setMsg(res.error);
    router.refresh();
  }

  return (
    <li className="crow">
      <fieldset disabled={locked || busy} className="crow__fields">
        <Field label="Номер контейнера" error={errors.number}>
          <input className="control" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="MSKU1234567" maxLength={11} />
        </Field>
        <Field label="Тип">
          <select className="control" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Не указан</option>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Вес, кг" error={errors.weightKg}>
          <input className="control" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        {!locked && (
          <div className="crow__btns">
            <button type="button" className="btn" onClick={save} disabled={!dirty || busy}>
              Сохранить
            </button>
            <button type="button" className="btn btn--danger" onClick={remove}>
              Удалить
            </button>
          </div>
        )}
      </fieldset>
      {msg && <p className="msg msg--error">{msg}</p>}
    </li>
  );
}

export default function ContainersEditor({ shipmentId, containers, locked }: { shipmentId: number; containers: Container[]; locked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setMsg(null);
    const res = await call("POST", `/api/shipments/${shipmentId}/containers`, {});
    setBusy(false);
    if (!res.ok) return setMsg(res.error);
    router.refresh();
  }

  return (
    <div>
      <ul className="clist">
        {containers.map((c) => (
          <Row key={`${c.id}-${c.number}-${c.type}-${c.weightKg}`} c={c} locked={locked} />
        ))}
      </ul>
      {!locked && (
        <div className="sec-foot">
          <button type="button" className="btn btn--ghost" onClick={add} disabled={busy}>
            + Добавить контейнер
          </button>
          {msg && <span className="msg msg--error">{msg}</span>}
        </div>
      )}
    </div>
  );
}
