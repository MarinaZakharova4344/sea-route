/**
 * Подробности к каждому блоку экранов руководителя: что стоит за цифрой, из каких перевозок и счетов она сложилась.
 * Все страницы подробностей собираются в одну структуру DetailPage, чтобы выглядели и работали одинаково.
 */
import type Database from "better-sqlite3";
import {
  METRIC_SELECT,
  REASON_ACTIONS,
  REASON_TITLES,
  addDaysIso,
  deliveredIn,
  directionName,
  getPayments,
  getRevisions,
  getProfit,
  isProblem,
  totalsOf,
  type MetricRow,
  type ReasonCode,
} from "./analytics";
import { diffDays, todayIso } from "../dates";
import { formatDate, formatMoney, formatPercent, plural } from "../format";
import { loadThresholds } from "../calc/recalc";

export interface DetailItem {
  /** Перевозка, к которой ведёт строка (если есть). */
  shipmentId: number | null;
  /** Куда вести при нажатии: карточка перевозки, клиент и т.п. */
  href: string | null;
  title: string;
  sub?: string;
  note?: string;
  valueText: string;
  tone?: "neg" | "pos" | "warn" | "muted";
}

export interface DetailGroup {
  title: string;
  sub?: string;
  totalText?: string;
  items: DetailItem[];
}

export interface DetailPage {
  kind: string;
  title: string;
  /** Что это за показатель, как посчитан и чего в нём нет: простыми словами. */
  lead: string;
  summary: { label: string; value: string }[];
  /** Что руководителю стоит сделать. */
  action: string | null;
  groups: DetailGroup[];
  empty: string;
}

const shipmentHref = (id: number) => `/director/shipments/${id}`;
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
const signedMoney = (n: number) => `${sign(n)}${formatMoney(Math.abs(n))}`;
const who = (name: string | null) => name ?? "не назначен";

// ---------- «Сегодня»: причины и деньги под риском ----------

export const ATTENTION_KINDS = ["receivables", "payables", "overrun", "overdue_payment", "delay", "rescheduled", "stale", "missing_fields"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

interface OverdueLine {
  kind: "income" | "expense";
  description: string;
  actual: number;
  paid: number;
  due: string;
  shipment_id: number;
  number: string;
  client: string | null;
  counterparty: string | null;
}

function overdueLines(db: Database.Database, kind: "income" | "expense", today: string): OverdueLine[] {
  return db
    .prepare(
      `SELECT l.kind, l.description, l.actual_amount AS actual, l.paid_amount AS paid, l.due_date AS due,
              s.id AS shipment_id, s.number, c.name AS client, cp.name AS counterparty
       FROM finance_lines l
       JOIN shipments s ON s.id = l.shipment_id
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN counterparties cp ON cp.id = l.counterparty_id
       WHERE l.kind = ? AND l.actual_amount IS NOT NULL AND l.payment_status <> 'paid'
         AND l.due_date IS NOT NULL AND l.due_date < ?
       ORDER BY l.due_date`,
    )
    .all(kind, today) as OverdueLine[];
}

function overdueGroups(lines: OverdueLine[], today: string, by: "client" | "counterparty"): DetailGroup[] {
  const map = new Map<string, OverdueLine[]>();
  for (const l of lines) {
    const key = (by === "client" ? l.client : l.counterparty) ?? (by === "client" ? "Клиент не указан" : "Контрагент не указан");
    map.set(key, [...(map.get(key) ?? []), l]);
  }
  const groups = [...map.entries()].map(([name, list]) => {
    const total = list.reduce((s, l) => s + (l.actual - l.paid), 0);
    const oldest = Math.max(...list.map((l) => diffDays(l.due, today)));
    return {
      total,
      group: {
        title: name,
        sub: `${list.length} ${plural(list.length, ["счёт", "счёта", "счетов"])}\nСамый давний просрочен на ${oldest} дн.`,
        totalText: formatMoney(total),
        items: list.map<DetailItem>((l) => ({
          shipmentId: l.shipment_id,
          href: shipmentHref(l.shipment_id),
          title: `${l.number} · ${l.description}`,
          sub: `Срок оплаты: ${formatDate(l.due)}`,
          note: l.paid > 0 ? `уже оплачено ${formatMoney(l.paid)} из ${formatMoney(l.actual)}` : undefined,
          valueText: `${formatMoney(l.actual - l.paid)}`,
          tone: "neg" as const,
        })),
      } satisfies DetailGroup,
    };
  });
  return groups.sort((a, b) => b.total - a.total).map((g) => g.group);
}

interface OverrunLine {
  description: string;
  planned: number;
  actual: number;
  shipment_id: number;
  number: string;
  client: string | null;
  unplanned: number;
}

function overrunLines(db: Database.Database): OverrunLine[] {
  return db
    .prepare(
      `SELECT l.description, l.planned_amount AS planned, l.actual_amount AS actual, l.is_unplanned AS unplanned,
              s.id AS shipment_id, s.number, c.name AS client
       FROM finance_lines l
       JOIN shipments s ON s.id = l.shipment_id
       LEFT JOIN clients c ON c.id = s.client_id
       WHERE l.kind = 'expense' AND l.actual_amount IS NOT NULL AND l.actual_amount > l.planned_amount
         AND s.finance_closed_at IS NULL AND s.status NOT IN ('draft', 'cancelled')`,
    )
    .all() as OverrunLine[];
}

function reasonRows(db: Database.Database, code: ReasonCode): MetricRow[] {
  return db.prepare(`${METRIC_SELECT} WHERE m.attention_reasons LIKE ?`).all(`%"code":"${code}"%`) as MetricRow[];
}

export function getAttentionDetail(db: Database.Database, kind: AttentionKind, today: string = todayIso()): DetailPage {
  if (kind === "receivables" || kind === "payables") {
    const income = kind === "receivables";
    const lines = overdueLines(db, income ? "income" : "expense", today);
    const groups = overdueGroups(lines, today, income ? "client" : "counterparty");
    const total = lines.reduce((s, l) => s + (l.actual - l.paid), 0);
    const oldest = lines.length ? Math.max(...lines.map((l) => diffDays(l.due, today))) : 0;
    return {
      kind,
      title: income ? "Клиенты не заплатили в срок" : "Мы не заплатили подрядчикам",
      lead: income
        ? "Счета клиентам, по которым срок оплаты уже прошёл, а деньги не получены полностью. Сумма по каждому счёту: сколько выставлено минус сколько уже оплачено. Счета, по которым ещё не внесён фактический счёт, сюда не попадают."
        : "Счета подрядчиков (перевозчиков, терминалов, брокеров), по которым срок оплаты прошёл, а мы заплатили не полностью. Сумма по каждому счёту: сколько выставлено минус сколько уже оплачено.",
      summary: [
        { label: "Всего просрочено", value: formatMoney(total) },
        { label: "Счетов", value: String(lines.length) },
        { label: income ? "Клиентов" : "Подрядчиков", value: String(groups.length) },
        { label: "Самая давняя просрочка", value: lines.length ? `${oldest} дн.` : "—" },
      ],
      action: income ? REASON_ACTIONS.overdue_payment : "Свериться с подрядчиком и согласовать срок оплаты, чтобы не получить штраф или отказ в обслуживании",
      groups,
      empty: income ? "Просроченных счетов клиентам нет." : "Просроченных счетов подрядчикам нет.",
    };
  }

  if (kind === "overdue_payment") {
    const clients = overdueLines(db, "income", today);
    const suppliers = overdueLines(db, "expense", today);
    const sum = (l: OverdueLine[]) => l.reduce((s, x) => s + (x.actual - x.paid), 0);
    return {
      kind,
      title: "Просрочена оплата",
      lead: "Перевозки, по которым есть счёт с прошедшим сроком оплаты. Ниже счета разделены: что нам не заплатили клиенты и что не заплатили мы подрядчикам.",
      summary: [
        { label: "Клиенты должны", value: formatMoney(sum(clients)) },
        { label: "Мы должны подрядчикам", value: formatMoney(sum(suppliers)) },
        { label: "Счетов всего", value: String(clients.length + suppliers.length) },
      ],
      action: REASON_ACTIONS.overdue_payment,
      groups: [
        ...overdueGroups(clients, today, "client").map((g) => ({ ...g, title: `Клиент: ${g.title}` })),
        ...overdueGroups(suppliers, today, "counterparty").map((g) => ({ ...g, title: `Подрядчик: ${g.title}` })),
      ],
      empty: "Просроченных счетов нет.",
    };
  }

  if (kind === "overrun") {
    const lines = overrunLines(db);
    const byShipment = new Map<number, OverrunLine[]>();
    for (const l of lines) byShipment.set(l.shipment_id, [...(byShipment.get(l.shipment_id) ?? []), l]);
    const groups = [...byShipment.values()]
      .map((list) => {
        const extra = list.reduce((s, l) => s + (l.actual - l.planned), 0);
        return {
          extra,
          group: {
            title: `${list[0].number} · ${list[0].client ?? "Клиент не указан"}`,
            sub: `Сверх плана: ${formatMoney(extra)}`,
            totalText: `+${formatMoney(extra)}`,
            items: list.map<DetailItem>((l) => ({
              shipmentId: l.shipment_id,
              href: shipmentHref(l.shipment_id),
              title: l.description + (l.unplanned && !/внеплан/i.test(l.description) ? " (внеплановый)" : ""),
              sub: `План: ${formatMoney(l.planned)}\nФакт: ${formatMoney(l.actual)}`,
              valueText: `+${formatMoney(l.actual - l.planned)}${l.planned > 0 ? ` (${formatPercent(((l.actual - l.planned) / l.planned) * 100)})` : ""}`,
              tone: "warn" as const,
            })),
          } satisfies DetailGroup,
        };
      })
      .sort((a, b) => b.extra - a.extra)
      .map((x) => x.group);
    const total = lines.reduce((s, l) => s + (l.actual - l.planned), 0);
    return {
      kind,
      title: "Расходы сверх плана",
      lead: "Строки расходов, где фактическая сумма по счёту больше плановой. Внеплановые расходы (которых не было в смете) считаются целиком. Учитываются перевозки, которые ещё не закрыты финансово, кроме черновиков и отменённых.",
      summary: [
        { label: "Всего сверх плана", value: formatMoney(total) },
        { label: "Строк расходов", value: String(lines.length) },
        { label: "Перевозок", value: String(groups.length) },
      ],
      action: REASON_ACTIONS.overrun,
      groups,
      empty: "Расходов сверх плана нет.",
    };
  }

  if (kind === "delay") {
    const rows = reasonRows(db, "delay").sort((a, b) => b.delay_days - a.delay_days);
    return {
      kind,
      title: REASON_TITLES.delay,
      lead: "Перевозки, по которым плановая дата прибытия уже прошла больше чем на порог (по умолчанию 2 дня), а груз не отмечен как прибывший. Опоздание считается в днях от плановой даты прибытия.",
      summary: [
        { label: "Перевозок", value: String(rows.length) },
        { label: "Максимальное опоздание", value: rows.length ? `${rows[0].delay_days} дн.` : "—" },
      ],
      action: REASON_ACTIONS.delay,
      groups: rows.length
        ? [
            {
              title: "От самых опоздавших",
              items: rows.map<DetailItem>((r) => ({
                shipmentId: r.id,
                href: shipmentHref(r.id),
                title: `${r.number} · ${r.client_name ?? "Клиент не указан"}`,
                sub: `${directionName(r) ?? "направление не указано"}\nДолжна была прибыть: ${formatDate(r.planned_arrival)}`,
                note: `Ответственный: ${who(r.manager_name)}`,
                valueText: `${r.delay_days} дн.`,
                tone: "neg",
              })),
            },
          ]
        : [],
      empty: "Опаздывающих перевозок нет.",
    };
  }

  if (kind === "rescheduled") {
    const rows = reasonRows(db, "rescheduled").sort((a, b) => b.original_delay_days - a.original_delay_days || b.reschedule_count - a.reschedule_count);
    return {
      kind,
      title: REASON_TITLES.rescheduled,
      lead: "Перевозки, у которых менеджер передвигал плановую дату прибытия. Опоздание считается от текущей плановой даты, поэтому перенос срока может скрыть задержку: груз идёт позже, чем обещали сначала, а по текущему плану всё в порядке. Сюда попадают перевозки в пути или забронированные, у которых к первоначальной дате уже опоздание больше порога, либо срок переносили два раза и больше.",
      summary: [
        { label: "Перевозок", value: String(rows.length) },
        { label: "Наибольшее опоздание к первоначальной дате", value: rows.length ? `${rows[0].original_delay_days} дн.` : "—" },
      ],
      action: REASON_ACTIONS.rescheduled,
      groups: rows.length
        ? [
            {
              title: "От самых «передвинутых»",
              items: rows.map<DetailItem>((r) => ({
                shipmentId: r.id,
                href: shipmentHref(r.id),
                title: `${r.number} · ${r.client_name ?? "Клиент не указан"}`,
                sub: `${directionName(r) ?? "направление не указано"}\nПрибытие по плану: ${formatDate(r.planned_arrival)}`,
                note: `Срок переносили: ${r.reschedule_count}\nОтветственный: ${who(r.manager_name)}`,
                valueText: r.original_delay_days > 0 ? `${r.original_delay_days} дн.` : `${r.reschedule_count} пер.`,
                tone: "warn",
              })),
            },
          ]
        : [],
      empty: "Перевозок с переносом срока, требующих внимания, нет.",
    };
  }

  if (kind === "stale") {
    const rows = reasonRows(db, "stale").sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    const editors = new Map(
      (db.prepare("SELECT s.id, u.name FROM shipments s LEFT JOIN users u ON u.id = s.updated_by").all() as { id: number; name: string | null }[]).map((r) => [r.id, r.name]),
    );
    return {
      kind,
      title: REASON_TITLES.stale,
      lead: "Перевозки в работе, по которым менеджер давно не вносил изменений (по умолчанию больше 5 дней). Цифры по таким перевозкам могут быть неактуальны: возможно, груз уже в другом статусе, а в учёте это не отмечено.",
      summary: [
        { label: "Перевозок", value: String(rows.length) },
        { label: "Самая давняя без обновлений", value: rows.length ? `${diffDays(rows[0].updated_at, today)} дн.` : "—" },
      ],
      action: REASON_ACTIONS.stale,
      groups: rows.length
        ? [
            {
              title: "От самых давних",
              items: rows.map<DetailItem>((r) => ({
                shipmentId: r.id,
                href: shipmentHref(r.id),
                title: `${r.number} · ${r.client_name ?? "Клиент не указан"}`,
                sub: `${directionName(r) ?? "направление не указано"}`,
                note: `Ответственный: ${who(r.manager_name)}\nОбновлено: ${formatDate(r.updated_at)}${editors.get(r.id) ? `\n${editors.get(r.id)}` : ""}`,
                valueText: `${diffDays(r.updated_at, today)} дн.`,
                tone: "warn",
              })),
            },
          ]
        : [],
      empty: "Все перевозки в работе обновлялись недавно.",
    };
  }

  // missing_fields
  const rows = db
    .prepare(
      `SELECT s.id, s.number, c.name AS client_name, d.origin, d.destination, u.name AS manager_name, m.missing_fields AS missing
       FROM shipments s
       JOIN shipment_metrics m ON m.shipment_id = s.id
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN directions d ON d.id = s.direction_id
       LEFT JOIN users u ON u.id = s.manager_id
       WHERE m.attention_reasons LIKE '%"code":"missing_fields"%'`,
    )
    .all() as { id: number; number: string; client_name: string | null; origin: string | null; destination: string | null; manager_name: string | null; missing: string }[];
  return {
    kind: "missing_fields",
    title: REASON_TITLES.missing_fields,
    lead: "Перевозки, где не заполнены важные сведения: клиент, направление, груз, плановые даты или контейнеры. Без них нельзя полностью оценить перевозку.",
    summary: [{ label: "Перевозок", value: String(rows.length) }],
    action: REASON_ACTIONS.missing_fields,
    groups: rows.length
      ? [
          {
            title: "Что не заполнено",
            items: rows.map<DetailItem>((r) => ({
              shipmentId: r.id,
              href: shipmentHref(r.id),
              title: `${r.number} · ${r.client_name ?? "Клиент не указан"}`,
              sub: directionName(r) ?? "направление не указано",
              note: `Не заполнено: ${(JSON.parse(r.missing) as string[]).join(", ")}\nОтветственный: ${who(r.manager_name)}`,
              valueText: `${(JSON.parse(r.missing) as string[]).length}`,
              tone: "muted",
            })),
          },
        ]
      : [],
    empty: "Во всех перевозках заполнены важные сведения.",
  };
}

// ---------- «Доходность»: что стоит за цифрами периода ----------

export const PROFIT_METRICS = ["revenue", "cost", "margin", "shipments", "problems", "final", "preliminary", "inprogress", "payments"] as const;
export type ProfitMetric = (typeof PROFIT_METRICS)[number];

function shipmentItem(r: MetricRow, valueText: string, tone?: DetailItem["tone"], note?: string): DetailItem {
  return {
    shipmentId: r.id,
    href: shipmentHref(r.id),
    title: `${r.number} · ${r.client_name ?? "Клиент не указан"}`,
    sub: `${directionName(r) ?? "направление не указано"}${r.result_date ? `\nДоставлена: ${formatDate(r.result_date)}` : ""}`,
    note,
    valueText,
    tone,
  };
}

export function getProfitDetail(db: Database.Database, days: number, metric: ProfitMetric, today: string = todayIso()): DetailPage {
  const t = loadThresholds(db);
  const from = addDaysIso(today, -(days - 1));
  const rows = deliveredIn(db, from, today);
  const totals = totalsOf(rows, t);
  const period = `${formatDate(from)} — ${formatDate(today)}`;
  const byClient = getProfit(db, days, "client", today).groups;
  const byDirection = getProfit(db, days, "direction", today).groups;
  const link = (kind: "client" | "direction", id: number | null) => (id ? `/director/profit/${kind}/${id}?days=${days}` : null);

  const breakdown = (value: (g: (typeof byClient)[number]) => number, share: (g: (typeof byClient)[number]) => string, tone?: (g: (typeof byClient)[number]) => DetailItem["tone"]): DetailGroup[] => [
    {
      title: "По клиентам",
      items: byClient.map<DetailItem>((g) => ({ shipmentId: null, href: link("client", g.id), title: g.name, sub: share(g), valueText: formatMoney(value(g)), tone: tone?.(g) })),
    },
    {
      title: "По направлениям",
      items: byDirection.map<DetailItem>((g) => ({ shipmentId: null, href: link("direction", g.id), title: g.name, sub: share(g), valueText: formatMoney(value(g)), tone: tone?.(g) })),
    },
  ];

  const base = (title: string, lead: string, summary: DetailPage["summary"], groups: DetailGroup[], empty: string, action: string | null = null): DetailPage => ({
    kind: metric,
    title,
    lead,
    summary,
    action,
    groups: groups.filter((g) => g.items.length > 0),
    empty,
  });

  switch (metric) {
    case "revenue":
      return base(
        "Оборот",
        `Сколько клиенты платят нам за перевозки, доставленные в периоде ${period}. Это сумма всех строк дохода (по факту, а если счёта ещё нет, по плану). Оборот не показывает, сколько мы заработали: часть уходит перевозчикам и подрядчикам.`,
        [{ label: "Оборот", value: formatMoney(totals.revenue) }, { label: "Перевозок", value: String(totals.count) }],
        breakdown((g) => g.revenue, (g) => `${formatPercent(g.revenueShare)} общего оборота`),
        "За период нет доставленных перевозок.",
      );
    case "cost":
      return base(
        "Расходы",
        `Сколько мы платим перевозчикам, терминалам и брокерам за перевозки периода ${period}. Сумма строк расходов (факт, а если счёта нет, план). Общие расходы компании (зарплаты, аренда) сюда не входят.`,
        [{ label: "Расходы", value: formatMoney(totals.cost) }, { label: "Доля от оборота", value: formatPercent(totals.revenue ? (totals.cost / totals.revenue) * 100 : 0) }],
        breakdown((g) => g.cost, (g) => `${formatPercent(g.revenue ? (g.cost / g.revenue) * 100 : 0)} от оборота клиента`),
        "За период нет доставленных перевозок.",
      );
    case "margin":
      return base(
        "Маржа по перевозкам",
        `Маржа = оборот − расходы по перевозкам, доставленным в периоде ${period}. Это не чистая прибыль компании: общие расходы и налоги не вычтены. Окончательной маржа становится, когда менеджер закрыл перевозку финансово.`,
        [
          { label: "Маржа", value: formatMoney(totals.margin) },
          { label: "% от оборота", value: formatPercent(totals.marginPct) },
          { label: "Окончательная", value: formatMoney(totals.finalMargin) },
          { label: "Предварительная", value: formatMoney(totals.preliminaryMargin) },
        ],
        breakdown((g) => g.margin, (g) => `маржа ${formatPercent(g.marginPct)} от оборота`, (g) => (g.margin < 0 ? "neg" : undefined)),
        "За период нет доставленных перевозок.",
      );
    case "shipments":
      return base(
        "Перевозки периода",
        `Все перевозки, доставленные в периоде ${period} (а также отменённые с расходами). От слабых к сильным по марже. В период не входят перевозки в пути: они пока не дали результата.`,
        [{ label: "Перевозок", value: String(rows.length) }, { label: "Маржа", value: formatMoney(totals.margin) }],
        [{ title: "От слабых к сильным", items: [...rows].sort((a, b) => a.margin - b.margin).map((r) => shipmentItem(r, formatMoney(r.margin) + (r.is_preliminary ? " *" : ""), r.margin < 0 ? "neg" : undefined)) }],
        "За период нет доставленных перевозок.",
      );
    case "problems": {
      const list = rows.filter((r) => isProblem(r, t));
      return base(
        "Перевозки с проблемами",
        `Перевозка считается проблемной, если у неё опоздание больше ${t.delayDays} дн., или перерасход больше ${t.overrunPct} %, или есть просроченная оплата. Показаны проблемные перевозки периода ${period}.`,
        [{ label: "Проблемных", value: String(list.length) }, { label: "Доля", value: formatPercent(rows.length ? (list.length / rows.length) * 100 : 0) }],
        [
          {
            title: "Какие и почему",
            items: list.map((r) => {
              const why: string[] = [];
              if (r.delay_days > t.delayDays) why.push(`опоздание ${r.delay_days} дн.`);
              if (r.overrun_pct > t.overrunPct) why.push(`перерасход ${formatPercent(r.overrun_pct)}`);
              if (r.has_overdue_payment === 1) why.push("просрочена оплата");
              return shipmentItem(r, formatMoney(r.margin) + (r.is_preliminary ? " *" : ""), r.margin < 0 ? "neg" : undefined, why.join(", "));
            }),
          },
        ],
        "В периоде нет проблемных перевозок.",
      );
    }
    case "final": {
      const list = rows.filter((r) => r.is_preliminary === 0);
      return base(
        "Окончательная маржа",
        "Перевозки, закрытые финансово: по всем строкам есть фактическая сумма, менеджер подтвердил расчёты. Эти цифры уже не изменятся (если перевозку не откроют заново).",
        [{ label: "Маржа", value: formatMoney(totals.finalMargin) }, { label: "Перевозок", value: String(list.length) }],
        [{ title: "Закрытые перевозки", items: [...list].sort((a, b) => b.margin - a.margin).map((r) => shipmentItem(r, formatMoney(r.margin), r.margin < 0 ? "neg" : undefined)) }],
        "В периоде нет перевозок, закрытых финансово.",
      );
    }
    case "preliminary": {
      const list = rows.filter((r) => r.is_preliminary === 1);
      return base(
        "Предварительная маржа",
        "Перевозки, по которым результат ещё может измениться: не закрыты финансово или по части строк нет фактической суммы (взята плановая). Пока менеджер не закроет перевозку, цифра ориентировочная.",
        [{ label: "Маржа", value: formatMoney(totals.preliminaryMargin) }, { label: "Перевозок", value: String(list.length) }],
        [{ title: "Ждут закрытия", items: [...list].sort((a, b) => b.margin - a.margin).map((r) => shipmentItem(r, formatMoney(r.margin) + " *", r.margin < 0 ? "neg" : undefined, r.status === "arrived" ? "груз прибыл, расчёты не закрыты" : undefined)) }],
        "Все перевозки периода закрыты финансово.",
        "Попросить менеджеров внести фактические суммы и закрыть перевозки финансово",
      );
    }
    case "payments": {
      const pay = getPayments(db, days, today);
      const lines = db
        .prepare(
          `SELECT f.description, f.paid_amount, f.actual_amount, f.paid_at, f.payment_status, s.id AS shipment_id, s.number, s.actual_arrival,
                  c.name AS client_name
           FROM finance_lines f JOIN shipments s ON s.id = f.shipment_id LEFT JOIN clients c ON c.id = s.client_id
           WHERE f.kind = 'income' AND f.paid_amount > 0 AND f.paid_at BETWEEN ? AND ? AND s.status <> 'draft'
           ORDER BY f.paid_at DESC, f.id DESC`,
        )
        .all(pay.from, pay.to) as { description: string; paid_amount: number; actual_amount: number | null; paid_at: string; payment_status: string; shipment_id: number; number: string; actual_arrival: string | null; client_name: string | null }[];
      return base(
        "Оплаты клиентов",
        `Сколько денег пришло от клиентов в периоде ${period}. Считается по дате оплаты, а не по дате доставки: перевозка, доставленная раньше и оплаченная сейчас, попадает сюда, но не в маржу этого периода. Это движение денег, а не прибыль.`,
        [{ label: "Поступило", value: formatMoney(pay.received) }, { label: "Оплат", value: String(pay.lines) }, { label: "Перевозок", value: String(pay.shipments) }],
        [
          {
            title: "От последних к более давним",
            items: lines.map<DetailItem>((l) => ({
              shipmentId: l.shipment_id,
              href: shipmentHref(l.shipment_id),
              title: `${l.number} · ${l.client_name ?? "Клиент не указан"}`,
              sub: `${l.description}\nОплачено: ${formatDate(l.paid_at)}`,
              note: l.payment_status === "partial" ? `Оплата частичная (из ${formatMoney(l.actual_amount ?? 0)})` : l.actual_arrival ? `Груз доставлен ${formatDate(l.actual_arrival)}` : undefined,
              valueText: formatMoney(l.paid_amount),
              tone: "pos",
            })),
          },
        ],
        "За период оплат от клиентов не было.",
      );
    }
    default: {
      // inprogress
      const list = db.prepare(`${METRIC_SELECT} WHERE s.status IN ('booked', 'in_transit') ORDER BY s.planned_arrival`).all() as MetricRow[];
      const expected = list.reduce((s, r) => s + r.margin, 0);
      return base(
        "Перевозки в работе",
        "Перевозки со статусом «Забронирована» и «В пути». Результата у них ещё нет, поэтому в маржу периода они не входят. Показана ожидаемая маржа по плановым суммам.",
        [{ label: "Перевозок", value: String(list.length) }, { label: "Ожидаемая маржа", value: formatMoney(expected) }],
        [
          {
            title: "Ближайшие к прибытию",
            items: list.map<DetailItem>((r) => ({
              shipmentId: r.id,
              href: shipmentHref(r.id),
              title: `${r.number} · ${r.client_name ?? "Клиент не указан"}`,
              sub: `${directionName(r) ?? "направление не указано"}\nПрибытие по плану: ${formatDate(r.planned_arrival)}`,
              valueText: formatMoney(r.margin) + " *",
              tone: r.margin < 0 ? "neg" : undefined,
            })),
          },
        ],
        "Перевозок в работе нет.",
      );
    }
  }
}

// ---------- «Динамика»: что стоит за изменением ----------

export const DYNAMICS_KINDS = ["current", "previous", "volume", "rate", "revised"] as const;
export type DynamicsKind = (typeof DYNAMICS_KINDS)[number];

export function getDynamicsDetail(db: Database.Database, weeks: number, kind: DynamicsKind, today: string = todayIso()): DetailPage {
  const t = loadThresholds(db);
  const span = weeks * 7;
  const curFrom = addDaysIso(today, -(span - 1));
  const prevTo = addDaysIso(curFrom, -1);
  const prevFrom = addDaysIso(prevTo, -(span - 1));
  const cur = deliveredIn(db, curFrom, today);
  const prev = deliveredIn(db, prevFrom, prevTo);
  const ct = totalsOf(cur, t);
  const pt = totalsOf(prev, t);
  const avgPrev = pt.count === 0 ? 0 : pt.margin / pt.count;
  const avgCur = ct.count === 0 ? 0 : ct.margin / ct.count;
  const curPeriod = `${formatDate(curFrom)} — ${formatDate(today)}`;
  const prevPeriod = `${formatDate(prevFrom)} — ${formatDate(prevTo)}`;

  const revisions = getRevisions(db);
  const revisedNote = (id: number) => {
    const v = revisions.get(id);
    return v ? `Пересчитано задним числом: после закрытия перевозку открыли заново и изменили ${formatDate(v.revisedAt)}${v.by ? `, ${v.by}` : ""}` : undefined;
  };

  const list = (rows: MetricRow[], title: string): DetailGroup => ({
    title,
    items: [...rows].sort((a, b) => a.margin - b.margin).map((r) => shipmentItem(r, formatMoney(r.margin) + (r.is_preliminary ? " *" : ""), r.margin < 0 ? "neg" : undefined, revisedNote(r.id))),
  });

  if (kind === "revised") {
    const rows = [...cur, ...prev].filter((r) => revisions.has(r.id));
    return {
      kind,
      title: "Пересчитано задним числом",
      lead: `Перевозки периодов ${prevPeriod} и ${curPeriod}, которые закрыли финансово, а потом открыли заново и изменили (например, пришёл поздний счёт). Маржа такой перевозки остаётся в месяце доставки груза, поэтому цифры уже просмотренных периодов могли измениться. Сами изменения видны в истории перевозки.`,
      summary: [{ label: "Перевозок", value: String(rows.length) }, { label: "Маржа этих перевозок", value: formatMoney(rows.reduce((s, r) => s + r.margin, 0)) }],
      action: rows.length ? "Открыть перевозку и посмотреть в истории, что и когда изменили, и почему счёт пришёл после закрытия" : null,
      groups: rows.length ? [{ title: "От самых давних правок", items: [...rows].sort((a, b) => (revisions.get(a.id)!.revisedAt < revisions.get(b.id)!.revisedAt ? -1 : 1)).map((r) => shipmentItem(r, formatMoney(r.margin) + (r.is_preliminary ? " *" : ""), r.margin < 0 ? "neg" : undefined, revisedNote(r.id))) }] : [],
      empty: "В этих периодах нет перевозок, пересчитанных задним числом.",
    };
  }

  if (kind === "current" || kind === "previous") {
    const rows = kind === "current" ? cur : prev;
    const tt = kind === "current" ? ct : pt;
    return {
      kind,
      title: kind === "current" ? "Выбранный период" : "Предыдущий период",
      lead: `Перевозки, доставленные ${kind === "current" ? curPeriod : prevPeriod}. Из их маржи складывается цифра «${kind === "current" ? "Сейчас" : "Раньше"}». От слабых к сильным.`,
      summary: [
        { label: "Маржа", value: formatMoney(tt.margin) },
        { label: "Перевозок", value: String(tt.count) },
        { label: "Маржа с перевозки", value: formatMoney(Math.round(tt.count ? tt.margin / tt.count : 0)) },
        { label: "% от оборота", value: formatPercent(tt.marginPct) },
      ],
      action: null,
      groups: rows.length ? [list(rows, "Перевозки периода")] : [],
      empty: "В этом периоде нет доставленных перевозок.",
    };
  }

  if (kind === "volume") {
    const map = new Map<string, { id: number | null; name: string; cur: number; prev: number }>();
    const bump = (r: MetricRow, which: "cur" | "prev") => {
      const key = String(r.client_id);
      const e = map.get(key) ?? { id: r.client_id, name: r.client_name ?? "Клиент не указан", cur: 0, prev: 0 };
      e[which] += 1;
      map.set(key, e);
    };
    cur.forEach((r) => bump(r, "cur"));
    prev.forEach((r) => bump(r, "prev"));
    const effect = Math.round((ct.count - pt.count) * avgPrev);
    const items = [...map.values()]
      .filter((e) => e.cur !== e.prev)
      .map((e) => ({ e, v: Math.round((e.cur - e.prev) * avgPrev) }))
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
      .map<DetailItem>(({ e, v }) => ({
        shipmentId: null,
        href: e.id ? `/director/profit/client/${e.id}` : null,
        title: e.name,
        sub: `Было: ${e.prev} ${plural(e.prev, ["перевозка", "перевозки", "перевозок"])}\nСтало: ${e.cur}`,
        valueText: signedMoney(v),
        tone: v < 0 ? "neg" : "pos",
      }));
    return {
      kind,
      title: "Число перевозок",
      lead: `Первая из двух причин изменения маржи. Если перевозок стало больше, итоговая маржа растёт, даже когда с каждой перевозки зарабатывается столько же. Считается так: разница в числе перевозок (${ct.count} − ${pt.count}) умножается на среднюю маржу одной перевозки в прошлом периоде (${formatMoney(Math.round(avgPrev))}).`,
      summary: [
        { label: "Было перевозок", value: String(pt.count) },
        { label: "Стало", value: String(ct.count) },
        { label: "Средняя маржа раньше", value: formatMoney(Math.round(avgPrev)) },
        { label: "Вклад в изменение", value: signedMoney(effect) },
      ],
      action: null,
      groups: items.length ? [{ title: "У каких клиентов изменилось число перевозок", sub: "Вклад клиента = разница в числе перевозок × средняя маржа раньше", items }] : [],
      empty: "Число перевозок у клиентов не изменилось.",
    };
  }

  // rate
  const effect = Math.round(ct.count * (avgCur - avgPrev));
  const items = [...cur]
    .map((r) => ({ r, v: Math.round(r.margin - avgPrev) }))
    .sort((a, b) => a.v - b.v)
    .map<DetailItem>(({ r, v }) => ({
      shipmentId: r.id,
      href: shipmentHref(r.id),
      title: `${r.number} · ${r.client_name ?? "Клиент не указан"}`,
      sub: `Маржа: ${formatMoney(r.margin)}\nСредняя раньше: ${formatMoney(Math.round(avgPrev))}`,
      valueText: signedMoney(v),
      tone: v < 0 ? "neg" : "pos",
    }));
  return {
    kind: "rate",
    title: "Маржа с одной перевозки",
    lead: `Вторая причина изменения. Показывает, стали ли мы зарабатывать с каждой перевозки больше или меньше. Для каждой перевозки текущего периода считается: её маржа минус средняя маржа перевозки в прошлом периоде (${formatMoney(Math.round(avgPrev))}). Сумма этих разниц равна вкладу этой причины.`,
    summary: [
      { label: "Средняя маржа раньше", value: formatMoney(Math.round(avgPrev)) },
      { label: "Средняя маржа сейчас", value: formatMoney(Math.round(avgCur)) },
      { label: "Вклад в изменение", value: signedMoney(effect) },
    ],
    action: effect < 0 ? "Разобраться с перевозками, которые тянут маржу вниз: чаще всего это перерасход или расходы без согласования" : null,
    groups: items.length ? [{ title: "Влияние каждой перевозки (от самых тянущих вниз)", items }] : [],
    empty: "В выбранном периоде нет доставленных перевозок.",
  };
}
