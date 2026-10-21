import { z } from "zod";

const isRealDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД")
  .refine(isRealDate, "Такой даты не существует");

const id = z.number().int().positive();
const money = z.number().int("Сумма в целых рублях").min(0, "Сумма не может быть отрицательной").max(2_000_000_000);

/** Пустая строка из формы означает «не заполнено». */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

export const SHIPMENT_STATUSES = ["draft", "booked", "in_transit", "arrived", "cancelled"] as const;

/**
 * Какими были изменяемые поля, когда человек открыл форму. Нужны для защиты от одновременной правки: если пока он
 * правил, кто-то другой уже изменил это поле, сервер откажет и не затрёт чужую правку.
 */
const expectation = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

/** Поля перевозки: все необязательны, чтобы можно было сохранить неполные сведения. */
export const ShipmentInput = z
  .object({
    clientId: id.nullable(),
    directionId: id.nullable(),
    managerId: id.nullable(),
    cargoDescription: optionalText(500),
    status: z.enum(SHIPMENT_STATUSES, "Статус «Закрыта» ставится только действием «Закрыть финансово»"),
    plannedDeparture: date.nullable(),
    actualDeparture: date.nullable(),
    plannedArrival: date.nullable(),
    actualArrival: date.nullable(),
    expect: expectation,
  })
  .partial()
  .strict();
export type ShipmentInput = z.infer<typeof ShipmentInput>;

export const ContainerInput = z
  .object({
    number: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || /^[A-Z]{4}\d{7}$/.test(v), "Номер контейнера: 4 буквы и 7 цифр, например MSKU1234567"),
    type: z.enum(["20", "40", "40HC"]).nullable(),
    weightKg: z.number().int().min(0).max(100_000).nullable(),
    comment: optionalText(300),
  })
  .partial()
  .strict();
export type ContainerInput = z.infer<typeof ContainerInput>;

export const LineInput = z
  .object({
    kind: z.enum(["income", "expense"]),
    counterpartyId: id.nullable(),
    clientId: id.nullable(),
    description: z.string().trim().min(1, "Укажите, за что строка").max(200),
    plannedAmount: money,
    actualAmount: money.nullable(),
    isUnplanned: z.boolean(),
    paymentStatus: z.enum(["unpaid", "partial", "paid"]),
    paidAmount: money,
    dueDate: date.nullable(),
    paidAt: date.nullable(),
    expect: expectation,
  })
  .partial()
  .strict();
export type LineInput = z.infer<typeof LineInput>;

export const LineCreate = LineInput.refine((v) => v.kind !== undefined, { message: "Укажите тип строки: доход или расход", path: ["kind"] }).refine(
  (v) => v.description !== undefined,
  { message: "Укажите, за что строка", path: ["description"] },
);

export const CloseFinanceInput = z.object({ confirmUnpaid: z.boolean().optional() }).strict();

export const ListQuery = z.object({
  status: z.enum([...SHIPMENT_STATUSES, "closed"]).optional(),
  clientId: z.coerce.number().int().positive().optional(),
  directionId: z.coerce.number().int().positive().optional(),
  managerId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
  attention: z.enum(["delay", "rescheduled", "overrun", "overdue_payment", "missing_fields", "stale", "any"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ClientInput = z
  .object({
    name: z.string().trim().min(1, "Укажите название").max(200),
    contactName: optionalText(200).optional(),
    contactPhone: optionalText(50).optional(),
    contactEmail: optionalText(200).optional(),
  })
  .strict();

export const CounterpartyInput = z
  .object({
    name: z.string().trim().min(1, "Укажите название").max(200),
    type: z.enum(["carrier", "terminal", "broker", "other"]),
  })
  .strict();

export const DirectionInput = z
  .object({
    origin: z.string().trim().min(1, "Укажите порт отправления").max(100),
    destination: z.string().trim().min(1, "Укажите порт назначения").max(100),
  })
  .strict();
