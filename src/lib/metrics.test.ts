import { describe, expect, it } from "vitest";
import { computeShipmentMetrics, type LineInput, type ShipmentInput } from "./metrics";

const TODAY = "2026-10-20";

function shipment(over: Partial<ShipmentInput> = {}): ShipmentInput {
  return {
    status: "arrived",
    clientId: 1,
    directionId: 1,
    cargoDescription: "Мебель",
    plannedDeparture: "2026-09-01",
    plannedArrival: "2026-10-10",
    actualArrival: "2026-10-12",
    financeClosedAt: null,
    updatedAt: "2026-10-19T10:00:00Z",
    containers: [{ number: "MSKU1234567" }],
    ...over,
  };
}

function line(over: Partial<LineInput> = {}): LineInput {
  return { kind: "expense", plannedAmount: 0, actualAmount: null, paymentStatus: "unpaid", dueDate: null, ...over };
}

const income = (amount = 10_000) => line({ kind: "income", plannedAmount: amount, actualAmount: amount, paymentStatus: "paid" });

describe("маржа: факт, где он есть, иначе план (ситуация 1)", () => {
  // Пример из ответа заказчику: доход 10 000, фрахт план 6 000 / факт 6 200, терминал план 1 000 без факта.
  const freight = line({ plannedAmount: 6_000, actualAmount: 6_200 });
  const terminal = line({ plannedAmount: 1_000, actualAmount: null });

  it("груз прибыл, терминал без факта: расходы 7 200, маржа 2 800, предварительно", () => {
    const m = computeShipmentMetrics(shipment(), [income(), freight, terminal], TODAY);
    expect(m.revenue).toBe(10_000);
    expect(m.cost).toBe(7_200);
    expect(m.margin).toBe(2_800);
    expect(m.isPreliminary).toBe(true);
  });

  it("появились хранение 500 и факт по терминалу 1 000: расходы 7 700, маржа 2 300, всё ещё предварительно", () => {
    const storage = line({ plannedAmount: 0, actualAmount: 500 });
    const m = computeShipmentMetrics(shipment(), [income(), freight, { ...terminal, actualAmount: 1_000 }, storage], TODAY);
    expect(m.cost).toBe(7_700);
    expect(m.margin).toBe(2_300);
    expect(m.isPreliminary).toBe(true);
  });

  it("после финансового закрытия маржа окончательная", () => {
    const storage = line({ plannedAmount: 0, actualAmount: 500 });
    const lines = [income(), freight, { ...terminal, actualAmount: 1_000 }, storage];
    const m = computeShipmentMetrics(shipment({ status: "closed", financeClosedAt: "2026-10-18" }), lines, TODAY);
    expect(m.margin).toBe(2_300);
    expect(m.isPreliminary).toBe(false);
  });

  it("закрытие не делает результат окончательным, пока по строке нет факта", () => {
    const m = computeShipmentMetrics(shipment({ status: "closed", financeClosedAt: "2026-10-18" }), [income(), freight, terminal], TODAY);
    expect(m.isPreliminary).toBe(true);
  });
});

describe("к какому периоду относится результат (ситуация 3)", () => {
  it("по дате фактической доставки, а не отправления или оплаты", () => {
    const m = computeShipmentMetrics(
      shipment({ plannedDeparture: "2026-09-25", actualArrival: "2026-10-12" }),
      [income()],
      TODAY,
    );
    expect(m.resultDate).toBe("2026-10-12");
  });

  it("пока груз не доставлен, даты результата нет", () => {
    const m = computeShipmentMetrics(shipment({ status: "in_transit", actualArrival: null }), [income()], TODAY);
    expect(m.resultDate).toBeNull();
  });
});

describe("отменённая перевозка", () => {
  it("расходы без дохода дают убыток, результат окончательный, дата результата — дата последнего обновления", () => {
    const fine = line({ plannedAmount: 0, actualAmount: 45_000, paymentStatus: "paid" });
    const m = computeShipmentMetrics(
      shipment({ status: "cancelled", actualArrival: null, updatedAt: "2026-09-22T09:00:00Z" }),
      [fine],
      TODAY,
    );
    expect(m.margin).toBe(-45_000);
    expect(m.isPreliminary).toBe(false);
    expect(m.resultDate).toBe("2026-09-22");
  });
});

describe("опоздание (порог: больше 2 дней)", () => {
  const inTransit = (plannedArrival: string) => shipment({ status: "in_transit", actualArrival: null, plannedArrival });

  it("плановая дата прошла 3 дня назад: причина внимания", () => {
    const m = computeShipmentMetrics(inTransit("2026-10-17"), [], TODAY);
    expect(m.delayDays).toBe(3);
    expect(m.attentionReasons.map((r) => r.code)).toContain("delay");
  });

  it("ровно 2 дня: ещё не причина", () => {
    const m = computeShipmentMetrics(inTransit("2026-10-18"), [], TODAY);
    expect(m.delayDays).toBe(2);
    expect(m.attentionReasons.map((r) => r.code)).not.toContain("delay");
  });

  it("груз прибыл с опозданием: задержка фиксируется, но вмешательства уже не требует", () => {
    const m = computeShipmentMetrics(shipment({ plannedArrival: "2026-10-01", actualArrival: "2026-10-09" }), [], TODAY);
    expect(m.delayDays).toBe(8);
    expect(m.attentionReasons.map((r) => r.code)).not.toContain("delay");
  });
});

describe("перерасход (порог: больше 10 % от плана)", () => {
  const open = (planned: number, actual: number) =>
    computeShipmentMetrics(shipment(), [line({ plannedAmount: planned, actualAmount: actual })], TODAY);

  it("3 900 при плане 3 500: 11,4 % — причина внимания", () => {
    const m = open(3_500, 3_900);
    expect(m.overrunPct).toBe(11.4);
    expect(m.attentionReasons.map((r) => r.code)).toContain("overrun");
  });

  it("ровно 10 %: не причина", () => {
    const m = open(3_500, 3_850);
    expect(m.overrunPct).toBe(10);
    expect(m.attentionReasons.map((r) => r.code)).not.toContain("overrun");
  });

  it("внеплановый расход входит в перерасход целиком", () => {
    const m = computeShipmentMetrics(
      shipment(),
      [line({ plannedAmount: 1_000, actualAmount: 1_000 }), line({ plannedAmount: 0, actualAmount: 300 })],
      TODAY,
    );
    expect(m.overrunPct).toBe(30);
  });

  it("расходы без факта в перерасход не входят", () => {
    const m = computeShipmentMetrics(
      shipment(),
      [line({ plannedAmount: 1_000, actualAmount: 1_000 }), line({ plannedAmount: 9_000, actualAmount: null })],
      TODAY,
    );
    expect(m.overrunPct).toBe(0);
  });

  it("у финансово закрытой перевозки перерасход уже не требует внимания", () => {
    const m = computeShipmentMetrics(
      shipment({ status: "closed", financeClosedAt: "2026-10-15" }),
      [line({ plannedAmount: 3_500, actualAmount: 4_500 })],
      TODAY,
    );
    expect(m.overrunPct).toBeGreaterThan(10);
    expect(m.attentionReasons.map((r) => r.code)).not.toContain("overrun");
  });
});

describe("просроченная оплата", () => {
  const withLine = (l: Partial<LineInput>) =>
    computeShipmentMetrics(shipment({ status: "closed", financeClosedAt: "2026-10-15" }), [line({ plannedAmount: 100, actualAmount: 100, ...l })], TODAY);

  it("счёт выставлен, не оплачен, срок прошёл", () => {
    const m = withLine({ dueDate: "2026-10-10" });
    expect(m.hasOverduePayment).toBe(true);
    expect(m.attentionReasons.map((r) => r.code)).toContain("overdue_payment");
  });

  it("оплаченный счёт не считается просроченным", () => {
    expect(withLine({ dueDate: "2026-10-10", paymentStatus: "paid" }).hasOverduePayment).toBe(false);
  });

  it("срок ещё не наступил", () => {
    expect(withLine({ dueDate: "2026-10-25" }).hasOverduePayment).toBe(false);
  });

  it("счёта ещё нет (нет факта): просрочки нет", () => {
    expect(withLine({ dueDate: "2026-10-10", actualAmount: null }).hasOverduePayment).toBe(false);
  });
});

describe("актуальность данных (порог: больше 5 дней)", () => {
  const stale = (status: ShipmentInput["status"], updatedAt: string) =>
    computeShipmentMetrics(
      shipment({ status, updatedAt, actualArrival: status === "in_transit" ? null : "2026-10-12", financeClosedAt: status === "closed" ? "2026-10-13" : null }),
      [],
      TODAY,
    );

  it("в пути, не обновлялась 7 дней: причина внимания", () => {
    const m = stale("in_transit", "2026-10-13T08:00:00Z");
    expect(m.staleDays).toBe(7);
    expect(m.attentionReasons.map((r) => r.code)).toContain("stale");
  });

  it("ровно 5 дней: ещё не причина", () => {
    expect(stale("in_transit", "2026-10-15T08:00:00Z").attentionReasons.map((r) => r.code)).not.toContain("stale");
  });

  it("закрытая перевозка не требует обновлений", () => {
    const m = stale("closed", "2026-09-01T08:00:00Z");
    expect(m.staleDays).toBe(0);
    expect(m.attentionReasons.map((r) => r.code)).not.toContain("stale");
  });
});

describe("неполные данные", () => {
  const empty = shipment({
    status: "draft", clientId: null, directionId: null, cargoDescription: null,
    plannedDeparture: null, plannedArrival: null, actualArrival: null, containers: [],
  });

  it("черновик: список недостающих полей есть, но причиной внимания он не становится", () => {
    const m = computeShipmentMetrics(empty, [], TODAY);
    expect(m.missingFields).toEqual(["Клиент", "Направление", "Груз", "Плановая дата отправления", "Плановая дата прибытия", "Контейнеры"]);
    expect(m.attentionReasons).toEqual([]);
  });

  it("в пути без номеров контейнеров: причина внимания", () => {
    const m = computeShipmentMetrics(shipment({ status: "in_transit", actualArrival: null, containers: [{ number: null }] }), [], TODAY);
    expect(m.missingFields).toEqual(["Номера контейнеров"]);
    expect(m.attentionReasons.map((r) => r.code)).toContain("missing_fields");
  });

  it("неполную перевозку можно считать: пустые суммы дают нули, а не ошибку", () => {
    const m = computeShipmentMetrics(empty, [], TODAY);
    expect(m.margin).toBe(0);
    expect(m.isPreliminary).toBe(true);
  });
});

describe("настраиваемые пороги", () => {
  it("при пороге опоздания 1 день 2 дня уже причина", () => {
    const m = computeShipmentMetrics(
      shipment({ status: "in_transit", actualArrival: null, plannedArrival: "2026-10-18" }),
      [],
      TODAY,
      { delayDays: 1, overrunPct: 10, staleDays: 5 },
    );
    expect(m.attentionReasons.map((r) => r.code)).toContain("delay");
  });
});

describe("перенос срока прибытия не прячет задержку", () => {
  const TODAY = "2026-10-20";
  const base = { status: "in_transit" as const, actualArrival: null, updatedAt: "2026-10-19T10:00:00Z" };

  it("срок передвинули в будущее: опоздания по текущему плану нет, но к первоначальной дате груз уже опаздывает", () => {
    const m = computeShipmentMetrics(shipment({ ...base, plannedArrival: "2026-10-25", rescheduling: { originalPlannedArrival: "2026-10-12", count: 1 } }), [], TODAY);
    expect(m.delayDays).toBe(0);
    expect(m.originalDelayDays).toBe(8);
    expect(m.attentionReasons.map((r) => r.code)).toEqual(["rescheduled"]);
    expect(m.attentionReasons[0].text).toContain("8 дн.");
  });

  it("два переноса и больше — причина, даже если к первоначальной дате ещё не опаздывает", () => {
    const m = computeShipmentMetrics(shipment({ ...base, plannedArrival: "2026-11-10", rescheduling: { originalPlannedArrival: "2026-10-30", count: 2 } }), [], TODAY);
    expect(m.attentionReasons.map((r) => r.code)).toEqual(["rescheduled"]);
    expect(m.attentionReasons[0].text).toContain("2 раза");
  });

  it("один небольшой перенос без опоздания к первоначальной дате — не причина", () => {
    const m = computeShipmentMetrics(shipment({ ...base, plannedArrival: "2026-10-28", rescheduling: { originalPlannedArrival: "2026-10-26", count: 1 } }), [], TODAY);
    expect(m.attentionReasons.map((r) => r.code)).not.toContain("rescheduled");
  });

  it("если опоздание уже видно по текущему плану, причина одна («Опоздание»), и в ней сказано про перенос", () => {
    const m = computeShipmentMetrics(shipment({ ...base, plannedArrival: "2026-10-15", rescheduling: { originalPlannedArrival: "2026-10-05", count: 1 } }), [], TODAY);
    expect(m.attentionReasons.map((r) => r.code)).toEqual(["delay"]);
    expect(m.attentionReasons[0].text).toContain("Опоздание 5 дн.");
    expect(m.attentionReasons[0].text).toContain("к первоначальной дате 15 дн.");
  });

  it("прибывшая и закрытая перевозки причиной не становятся, но опоздание к первоначальной дате считается", () => {
    const m = computeShipmentMetrics(shipment({ status: "arrived", plannedArrival: "2026-10-20", actualArrival: "2026-10-20", rescheduling: { originalPlannedArrival: "2026-10-10", count: 1 } }), [], TODAY);
    expect(m.attentionReasons.map((r) => r.code)).not.toContain("rescheduled");
    expect(m.originalDelayDays).toBe(10);
  });
});
