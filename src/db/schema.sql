-- Схема данных «Морского маршрута». Описание: docs/02_data_schema.md
-- Суммы хранятся целыми числами в рублях. Даты: YYYY-MM-DD, моменты времени: ISO 8601.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('manager', 'director')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  contact_name  TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS counterparties (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('carrier', 'terminal', 'broker', 'other'))
);

CREATE TABLE IF NOT EXISTS directions (
  id          INTEGER PRIMARY KEY,
  origin      TEXT NOT NULL,
  destination TEXT NOT NULL,
  UNIQUE (origin, destination)
);

CREATE TABLE IF NOT EXISTS shipments (
  id                  INTEGER PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE,
  client_id           INTEGER REFERENCES clients (id),
  direction_id        INTEGER REFERENCES directions (id),
  manager_id          INTEGER REFERENCES users (id),
  cargo_description   TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'booked', 'in_transit', 'arrived', 'closed', 'cancelled')),
  planned_departure   TEXT,
  actual_departure    TEXT,
  planned_arrival     TEXT,
  actual_arrival      TEXT,
  finance_closed_at   TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_by          INTEGER REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS idx_shipments_client ON shipments (client_id);
CREATE INDEX IF NOT EXISTS idx_shipments_direction ON shipments (direction_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments (status);

CREATE TABLE IF NOT EXISTS containers (
  id           INTEGER PRIMARY KEY,
  shipment_id  INTEGER NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
  number       TEXT,
  type         TEXT CHECK (type IN ('20', '40', '40HC')),
  weight_kg    INTEGER,
  comment      TEXT
);
CREATE INDEX IF NOT EXISTS idx_containers_shipment ON containers (shipment_id);

CREATE TABLE IF NOT EXISTS finance_lines (
  id              INTEGER PRIMARY KEY,
  shipment_id     INTEGER NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  counterparty_id INTEGER REFERENCES counterparties (id),
  client_id       INTEGER REFERENCES clients (id),
  description     TEXT NOT NULL,
  planned_amount  INTEGER NOT NULL DEFAULT 0,
  actual_amount   INTEGER,
  is_unplanned    INTEGER NOT NULL DEFAULT 0 CHECK (is_unplanned IN (0, 1)),
  currency        TEXT NOT NULL DEFAULT 'RUB',
  payment_status  TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  paid_amount     INTEGER NOT NULL DEFAULT 0,
  due_date        TEXT,
  paid_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_finance_shipment ON finance_lines (shipment_id);

CREATE TABLE IF NOT EXISTS change_log (
  id          INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
  changed_by  INTEGER REFERENCES users (id),
  changed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT
);
CREATE INDEX IF NOT EXISTS idx_change_log_shipment ON change_log (shipment_id, changed_at);

-- Готовые расчёты по перевозке. Пересчитываются по расписанию или по кнопке.
CREATE TABLE IF NOT EXISTS shipment_metrics (
  shipment_id         INTEGER PRIMARY KEY REFERENCES shipments (id) ON DELETE CASCADE,
  revenue             INTEGER NOT NULL DEFAULT 0,
  cost                INTEGER NOT NULL DEFAULT 0,
  margin              INTEGER NOT NULL DEFAULT 0,
  is_preliminary      INTEGER NOT NULL DEFAULT 1 CHECK (is_preliminary IN (0, 1)),
  result_date         TEXT,
  delay_days          INTEGER NOT NULL DEFAULT 0,
  overrun_pct         REAL NOT NULL DEFAULT 0,
  has_overdue_payment INTEGER NOT NULL DEFAULT 0 CHECK (has_overdue_payment IN (0, 1)),
  stale_days          INTEGER NOT NULL DEFAULT 0,
  missing_fields      TEXT NOT NULL DEFAULT '[]',
  attention_reasons   TEXT NOT NULL DEFAULT '[]',
  calculated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_refresh (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  refreshed_at TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('delay_days_threshold', '2'),
  ('overrun_pct_threshold', '10'),
  ('stale_days_threshold', '5'),
  ('analytics_refresh_minutes', '5');

INSERT OR IGNORE INTO analytics_refresh (id, refreshed_at) VALUES (1, NULL);
