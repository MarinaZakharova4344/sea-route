import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

const TODAY = "2026-10-20";

let db: Database.Database;

beforeAll(async () => {
  // Дата для демо-данных задаётся до загрузки модуля seed.
  process.env.SEED_TODAY = TODAY;
  const { openDb, applySchema } = await import("../../db");
  const { seed } = await import("../../db/seed");
  const { recalcAll } = await import("./recalc");
  db = openDb(":memory:");
  applySchema(db);
  seed(db);
  recalcAll(db, new Date(`${TODAY}T14:05:00Z`));
});

interface ClientRow {
  name: string;
  revenue: number;
  margin: number;
}

function byClient(): ClientRow[] {
  return db
    .prepare(
      `SELECT c.name, SUM(m.revenue) AS revenue, SUM(m.margin) AS margin
       FROM shipment_metrics m
       JOIN shipments s ON s.id = m.shipment_id
       JOIN clients c ON c.id = s.client_id
       WHERE s.status IN ('arrived', 'closed')
       GROUP BY c.id`,
    )
    .all() as ClientRow[];
}

describe("пересчёт по демо-данным", () => {
  it("метрики посчитаны для каждой перевозки и записано время обновления аналитики", () => {
    const shipments = (db.prepare("SELECT COUNT(*) n FROM shipments").get() as { n: number }).n;
    const metrics = (db.prepare("SELECT COUNT(*) n FROM shipment_metrics").get() as { n: number }).n;
    expect(metrics).toBe(shipments);
    const r = db.prepare("SELECT refreshed_at FROM analytics_refresh WHERE id = 1").get() as { refreshed_at: string };
    expect(r.refreshed_at).toBe(`${TODAY}T14:05:00.000Z`);
  });

  it("повторный пересчёт не дублирует строки", async () => {
    const { recalcAll } = await import("./recalc");
    const before = (db.prepare("SELECT COUNT(*) n FROM shipment_metrics").get() as { n: number }).n;
    recalcAll(db, new Date(`${TODAY}T15:00:00Z`));
    const after = (db.prepare("SELECT COUNT(*) n FROM shipment_metrics").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("клиент с самым большим оборотом почти ничего не зарабатывает, спокойный небольшой клиент зарабатывает хорошо", () => {
    const rows = byClient();
    const biggest = rows.reduce((a, b) => (b.revenue > a.revenue ? b : a));
    expect(biggest.name).toBe("ООО «Рассвет»");
    expect(biggest.margin / biggest.revenue).toBeLessThan(0.08);

    const north = rows.find((r) => r.name === "ТД «Север»");
    expect(north).toBeDefined();
    expect(north!.margin / north!.revenue).toBeGreaterThan(0.25);
  });

  it("в демо-данных есть перевозки со всеми видами причин внимания", () => {
    const rows = db.prepare("SELECT attention_reasons FROM shipment_metrics").all() as { attention_reasons: string }[];
    const codes = new Set(rows.flatMap((r) => (JSON.parse(r.attention_reasons) as { code: string }[]).map((x) => x.code)));
    for (const code of ["delay", "overrun", "overdue_payment", "missing_fields", "stale"]) {
      expect(codes.has(code), `нет причины «${code}»`).toBe(true);
    }
  });

  it("есть и предварительные, и окончательные результаты", () => {
    const rows = db.prepare("SELECT is_preliminary, COUNT(*) n FROM shipment_metrics GROUP BY is_preliminary").all() as { is_preliminary: number; n: number }[];
    expect(rows.map((r) => r.is_preliminary).sort()).toEqual([0, 1]);
  });

  it("смена порога в настройках меняет причины внимания", async () => {
    const { recalcAll } = await import("./recalc");
    const count = () =>
      (db.prepare("SELECT COUNT(*) n FROM shipment_metrics WHERE attention_reasons LIKE '%\"delay\"%'").get() as { n: number }).n;
    const at2 = count();
    db.prepare("UPDATE settings SET value = '30' WHERE key = 'delay_days_threshold'").run();
    recalcAll(db, new Date(`${TODAY}T16:00:00Z`));
    expect(count()).toBeLessThan(at2);
    db.prepare("UPDATE settings SET value = '2' WHERE key = 'delay_days_threshold'").run();
  });
});
