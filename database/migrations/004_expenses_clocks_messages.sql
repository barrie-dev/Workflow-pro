-- Migration 004: Dedicated tabellen voor expenses, clocks en messages
-- Voer uit in Supabase SQL Editor (eenmalig, vóór migration 005)

-- ── Onkosten (expenses) ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  user_name     TEXT,
  date          DATE NOT NULL,
  amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'EUR',
  category      TEXT NOT NULL DEFAULT 'overig',
  description   TEXT,
  receipt_url   TEXT,
  status        TEXT NOT NULL DEFAULT 'ingediend'
                  CHECK (status IN ('ingediend','approved','rejected','uitbetaald')),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expenses_tenant_id_idx   ON expenses(tenant_id);
CREATE INDEX IF NOT EXISTS expenses_user_id_idx     ON expenses(user_id);
CREATE INDEX IF NOT EXISTS expenses_status_idx      ON expenses(status);
CREATE INDEX IF NOT EXISTS expenses_date_idx        ON expenses(date DESC);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY expenses_tenant_isolation ON expenses
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ── Prikklok / clockings ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clocks (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  user_name     TEXT,
  date          DATE NOT NULL,
  clock_in      TEXT,      -- HH:MM formaat
  clock_out     TEXT,
  total_minutes INTEGER NOT NULL DEFAULT 0,
  location      TEXT,
  project       TEXT,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','closed','approved')),
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clocks_tenant_id_idx     ON clocks(tenant_id);
CREATE INDEX IF NOT EXISTS clocks_user_id_idx       ON clocks(user_id);
CREATE INDEX IF NOT EXISTS clocks_date_idx          ON clocks(date DESC);
CREATE INDEX IF NOT EXISTS clocks_status_idx        ON clocks(status);

ALTER TABLE clocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY clocks_tenant_isolation ON clocks
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ── Berichten / messages ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_user_id  TEXT NOT NULL,
  from_name     TEXT,
  to_user_id    TEXT,       -- NULL = broadcast aan hele tenant
  subject       TEXT,
  body          TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'internal'
                  CHECK (channel IN ('internal','email','sms','push')),
  read_at       TIMESTAMPTZ,
  read_by       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_tenant_id_idx   ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS messages_to_user_idx     ON messages(to_user_id);
CREATE INDEX IF NOT EXISTS messages_created_idx     ON messages(created_at DESC);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_tenant_isolation ON messages
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ── Notificaties ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type          TEXT NOT NULL DEFAULT 'info',
  channel       TEXT NOT NULL DEFAULT 'in_app',
  audience      TEXT NOT NULL DEFAULT 'admins',
  title         TEXT NOT NULL,
  body          TEXT,
  status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','read','failed')),
  priority      TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high')),
  source_ref    TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at       TIMESTAMPTZ,
  read_by       TEXT
);

CREATE INDEX IF NOT EXISTS notifications_tenant_id_idx  ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS notifications_status_idx     ON notifications(status);
CREATE INDEX IF NOT EXISTS notifications_priority_idx   ON notifications(priority);
CREATE INDEX IF NOT EXISTS notifications_created_idx    ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_tenant_isolation ON notifications
  USING (tenant_id = current_setting('app.tenant_id', true));

INSERT INTO app_schema_migrations (version, name)
VALUES (4, 'expenses-clocks-messages')
ON CONFLICT (version) DO NOTHING;
