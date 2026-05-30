-- Migration 005: Verlofbeheer + uitgebreid wagenparkbeheer
-- Voer uit in Supabase SQL Editor (eenmalig)

-- ── Verlof (leaves) ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leaves (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('vakantie','ziekte','overmacht','educatie','onbetaald','feestdag')),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  days          INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'aangevraagd'
                  CHECK (status IN ('aangevraagd','goedgekeurd','geweigerd','geannuleerd')),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leaves_tenant_id_idx        ON leaves(tenant_id);
CREATE INDEX IF NOT EXISTS leaves_user_id_idx          ON leaves(user_id);
CREATE INDEX IF NOT EXISTS leaves_status_idx           ON leaves(status);
CREATE INDEX IF NOT EXISTS leaves_date_range_idx       ON leaves(start_date, end_date);

-- Row Level Security
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;

CREATE POLICY leaves_tenant_isolation ON leaves
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ── Voertuigen uitbreidingen (vehicles) ───────────────────────────────────────

ALTER TABLE IF EXISTS vehicles
  ADD COLUMN IF NOT EXISTS brand             TEXT,
  ADD COLUMN IF NOT EXISTS year              INTEGER,
  ADD COLUMN IF NOT EXISTS fuel              TEXT DEFAULT 'diesel',
  ADD COLUMN IF NOT EXISTS vin               TEXT,
  ADD COLUMN IF NOT EXISTS inspection_date   DATE,
  ADD COLUMN IF NOT EXISTS insurance_expiry  DATE,
  ADD COLUMN IF NOT EXISTS insurance_company TEXT,
  ADD COLUMN IF NOT EXISTS status            TEXT DEFAULT 'actief',
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

-- Kilometerstand logs
CREATE TABLE IF NOT EXISTS mileage_logs (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id        TEXT NOT NULL,
  mileage           INTEGER NOT NULL,
  previous_mileage  INTEGER NOT NULL DEFAULT 0,
  delta             INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  actor             TEXT NOT NULL,
  logged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mileage_logs_tenant_idx   ON mileage_logs(tenant_id);
CREATE INDEX IF NOT EXISTS mileage_logs_vehicle_idx  ON mileage_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS mileage_logs_date_idx     ON mileage_logs(logged_at DESC);

ALTER TABLE mileage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY mileage_logs_tenant_isolation ON mileage_logs
  USING (tenant_id = current_setting('app.tenant_id', true));
