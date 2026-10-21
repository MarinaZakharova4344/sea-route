"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { call } from "@/lib/client-api";
import type { referenceData } from "@/lib/shipments/service";
import Field from "./Field";

type Reference = ReturnType<typeof referenceData>;
type Option = { id: number; name: string };
type Direction = { id: number; origin: string; destination: string };

export interface MainValues {
  clientId: number | null;
  directionId: number | null;
  managerId: number | null;
  cargoDescription: string | null;
  status: string;
  plannedDeparture: string | null;
  actualDeparture: string | null;
  plannedArrival: string | null;
  actualArrival: string | null;
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "booked", label: "Забронирована" },
  { value: "in_transit", label: "В пути" },
  { value: "arrived", label: "Прибыла" },
  { value: "cancelled", label: "Отменена" },
];

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** Форма основных данных: создание новой перевозки и правка существующей. Неполные данные сохранять можно. */
export default function ShipmentForm({
  mode,
  shipmentId,
  initial,
  reference,
  locked = false,
  currentUserId,
}: {
  mode: "new" | "edit";
  shipmentId?: number;
  initial: MainValues;
  reference: Reference;
  locked?: boolean;
  currentUserId?: number;
}) {
  const router = useRouter();
  const [clients, setClients] = useState<Option[]>(reference.clients as Option[]);
  const [directions, setDirections] = useState<Direction[]>(reference.directions as Direction[]);
  const [v, setV] = useState({
    clientId: str(initial.clientId),
    directionId: str(initial.directionId),
    managerId: str(initial.managerId ?? currentUserId),
    cargoDescription: str(initial.cargoDescription),
    status: initial.status,
    plannedDeparture: str(initial.plannedDeparture),
    actualDeparture: str(initial.actualDeparture),
    plannedArrival: str(initial.plannedArrival),
    actualArrival: str(initial.actualArrival),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [adding, setAdding] = useState<null | "client" | "direction">(null);
  const [newClient, setNewClient] = useState("");
  const [newOrigin, setNewOrigin] = useState("");
  const [newDestination, setNewDestination] = useState("");

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const id = (s: string) => (s === "" ? null : Number(s));
  const text = (s: string) => (s.trim() === "" ? null : s.trim());

  function payload() {
    const all = {
      clientId: id(v.clientId),
      directionId: id(v.directionId),
      managerId: id(v.managerId),
      cargoDescription: text(v.cargoDescription),
      status: v.status,
      plannedDeparture: text(v.plannedDeparture),
      actualDeparture: text(v.actualDeparture),
      plannedArrival: text(v.plannedArrival),
      actualArrival: text(v.actualArrival),
    };
    if (mode === "new") return all;
    // при правке отправляем только изменённое и то, каким оно было на экране: сервер заметит, что поле успел изменить другой
    const was = initial as unknown as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    const expect: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(all)) {
      if (val !== was[k]) {
        changed[k] = val;
        expect[k] = was[k] ?? null;
      }
    }
    return Object.keys(changed).length > 0 ? { ...changed, expect } : changed;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setErrors({});
    const body = payload();
    if (mode === "edit" && Object.keys(body).length === 0) {
      setMessage({ kind: "ok", text: "Изменений нет" });
      return;
    }
    setPending(true);
    const res = mode === "new" ? await call<{ id: number }>("POST", "/api/shipments", body) : await call("PATCH", `/api/shipments/${shipmentId}`, body);
    setPending(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      const conflict = res.status === 409 && (res.details as { code?: string } | null)?.code === "conflict";
      setConflict(conflict);
      setMessage({ kind: "error", text: Object.keys(res.fieldErrors).length ? "Проверьте поля, отмеченные красным" : res.error });
      return;
    }
    setConflict(false);
    if (mode === "new") {
      router.push(`/manager/shipments/${(res.data as { id: number }).id}`);
    } else {
      setMessage({ kind: "ok", text: "Сохранено" });
      router.refresh();
    }
  }

  /** Enter в поле «нового клиента/направления» добавляет его, а не отправляет всю форму перевозки; Esc отменяет. */
  const onInlineKey = (add: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    } else if (e.key === "Escape") {
      setAdding(null);
    }
  };

  async function addClient() {
    if (!newClient.trim()) return;
    const res = await call<{ id: number; name: string }>("POST", "/api/clients", { name: newClient });
    if (!res.ok) return setErrors({ clientId: res.fieldErrors.name ?? res.error });
    setClients((c) => [...c, res.data].sort((a, b) => a.name.localeCompare(b.name, "ru")));
    setV((s) => ({ ...s, clientId: String(res.data.id) }));
    setNewClient("");
    setAdding(null);
  }

  async function addDirection() {
    const res = await call<Direction>("POST", "/api/directions", { origin: newOrigin, destination: newDestination });
    if (!res.ok) {
      const existing = (res.details as { id?: number } | null)?.id;
      if (res.status === 409 && existing) {
        setV((s) => ({ ...s, directionId: String(existing) }));
        setAdding(null);
        return;
      }
      return setErrors({ directionId: res.fieldErrors.origin ?? res.fieldErrors.destination ?? res.error });
    }
    setDirections((d) => [...d, res.data]);
    setV((s) => ({ ...s, directionId: String(res.data.id) }));
    setNewOrigin("");
    setNewDestination("");
    setAdding(null);
  }

  return (
    <form className="mform" onSubmit={submit} noValidate>
      <fieldset disabled={locked || pending} className="mform__fields">
        <div className="mform__grid">
          <Field label="Клиент" error={errors.clientId}>
            <select className="control" value={v.clientId} onChange={set("clientId")}>
              <option value="">Не выбран</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {adding !== "client" && (
              <button type="button" className="linkbtn" onClick={() => setAdding("client")}>
                + Новый клиент
              </button>
            )}
          </Field>

          <Field label="Направление" error={errors.directionId}>
            <select className="control" value={v.directionId} onChange={set("directionId")}>
              <option value="">Не выбрано</option>
              {directions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.origin} → {d.destination}
                </option>
              ))}
            </select>
            {adding !== "direction" && (
              <button type="button" className="linkbtn" onClick={() => setAdding("direction")}>
                + Новое направление
              </button>
            )}
          </Field>

          {adding === "client" && (
            <div className="inline-add field--wide">
              <input className="control" placeholder="Название клиента" value={newClient} onChange={(e) => setNewClient(e.target.value)} onKeyDown={onInlineKey(addClient)} autoFocus />
              <button type="button" className="btn" onClick={addClient}>
                Добавить
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setAdding(null)}>
                Отмена
              </button>
            </div>
          )}
          {adding === "direction" && (
            <div className="inline-add field--wide">
              <input className="control" placeholder="Порт отправления" value={newOrigin} onChange={(e) => setNewOrigin(e.target.value)} onKeyDown={onInlineKey(addDirection)} autoFocus />
              <input className="control" placeholder="Порт назначения" value={newDestination} onChange={(e) => setNewDestination(e.target.value)} onKeyDown={onInlineKey(addDirection)} />
              <button type="button" className="btn" onClick={addDirection}>
                Добавить
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setAdding(null)}>
                Отмена
              </button>
            </div>
          )}

          <Field label="Ответственный менеджер" error={errors.managerId}>
            <select className="control" value={v.managerId} onChange={set("managerId")}>
              <option value="">Не назначен</option>
              {(reference.managers as Option[]).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Статус" error={errors.status}>
            <select className="control" value={v.status} onChange={set("status")}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Груз" error={errors.cargoDescription} wide>
            <input className="control" value={v.cargoDescription} onChange={set("cargoDescription")} placeholder="Например: мебель, бытовая техника" maxLength={500} />
          </Field>

          <Field label="Отправление: план" error={errors.plannedDeparture}>
            <input className="control" type="date" value={v.plannedDeparture} onChange={set("plannedDeparture")} />
          </Field>
          <Field label="Отправление: факт" error={errors.actualDeparture} hint="Нужно для статусов «В пути» и «Прибыла»">
            <input className="control" type="date" value={v.actualDeparture} onChange={set("actualDeparture")} />
          </Field>
          <Field label="Прибытие: план" error={errors.plannedArrival}>
            <input className="control" type="date" value={v.plannedArrival} onChange={set("plannedArrival")} />
          </Field>
          <Field label="Прибытие: факт" error={errors.actualArrival} hint="Нужно для статуса «Прибыла»">
            <input className="control" type="date" value={v.actualArrival} onChange={set("actualArrival")} />
          </Field>
        </div>
      </fieldset>

      <div className="mform__foot">
        {message && (
          <span className={`msg msg--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </span>
        )}
        {conflict && (
          <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
            Загрузить актуальные данные
          </button>
        )}
        {!locked && (
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Сохраняем…" : mode === "new" ? "Создать перевозку" : "Сохранить"}
          </button>
        )}
      </div>
      {mode === "new" && <p className="field__hint">Можно сохранить неполные сведения и дополнить позже: обязательных полей нет.</p>}
    </form>
  );
}
