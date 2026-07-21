-- 005_identity · tenant + identity genormaliseerd (CTO P0-01, handover 5.4)
--
-- Tweede domein langs de strangler-route (na CRM). Legacy blijft de bron:
-- deze tabellen worden gevuld door een idempotente sync en pas na
-- reconciliatie als leesbron gebruikt (IDENTITY_READ_SOURCE, zoals
-- CRM_READ_SOURCE bij klanten).
--
-- Ontwerpkeuzes:
--  - text-sleutels, identiek aan de legacybron (zie de toelichting in 001).
--  - Kernvelden als kolommen (querybaar), authenticatie-internals als
--    'security'-document en alle overige legacyvelden verbatim in
--    'attributes' · zo is de pg-rij VOLLEDIG terug te vertalen naar het
--    legacy-object en is reconciliatie een exacte vergelijking.
--  - 'fingerprint' maakt de sync goedkoop idempotent: een ongewijzigde
--    gebruiker levert geen UPDATE (en dus geen updated_at-ruis) op.

-- ── Tenants: legacyvelden die 001 nog niet kende ────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_email text NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS fingerprint text NULL;

-- ── Gebruikers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY CHECK (length(id) BETWEEN 2 AND 64),
  -- NULL = platform-account (super_admin): hoort bij geen enkele tenant en is
  -- daardoor in geen enkele tenantcontext zichtbaar (zie de RLS-policy).
  tenant_id     text NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         text NOT NULL CHECK (position('@' in email) > 1),
  name          text NOT NULL DEFAULT '',
  role          text NOT NULL CHECK (length(btrim(role)) > 0),
  active        boolean NOT NULL DEFAULT true,
  password_hash text NULL,
  last_login_at timestamptz NULL,
  mfa_enabled   boolean NOT NULL DEFAULT false,
  -- Authenticatie-internals (mfa-geheimen zoals de app ze aanlevert - al
  -- versleuteld op applicatieniveau - herstelcodes, lockout-tellers).
  security      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Alle overige legacyvelden verbatim, voor een verliesvrije terugvertaling.
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id)
);
-- Login gebeurt op e-mailadres zonder tenantcontext · globaal uniek, net als
-- in de legacybron (de eerste match wint daar; hier dwingt de database het af).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users (tenant_id);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- ── Rij-niveau isolatie (5.3) · zelfde model als 001/002 ───────────────────
-- Platform-accounts (tenant_id IS NULL) vallen buiten elke tenantcontext:
-- de policy laat ze nooit door. Platform-operaties (login-lookup, beheer)
-- lopen via de applicatierol; het tenant_id-predicate in de repositorylaag
-- blijft de eerste verdedigingslinie.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_isolation ON users;
CREATE POLICY users_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP TRIGGER IF EXISTS users_touch ON users;
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
