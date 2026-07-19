-- 001_core · fundament voor het genormaliseerde schema (handover 5.2/5.3)
--
-- AFWIJKING VAN DE SPEC, BEWUST EN GEDOCUMENTEERD:
-- Handover 5.2 schrijft "id UUID PRIMARY KEY" en "tenant_id UUID" voor. De
-- bestaande dataset gebruikt ULID's met een leesbare prefix (cust_01H..., t_demo).
-- Een idempotente backfill (5.4 stap 3) vereist dat id's IDENTIEK blijven aan de
-- legacybron, anders zijn oude en nieuwe records niet aan elkaar te koppelen en
-- valt de reconciliatie (5.4 stap 4) niet te doen. Daarom text-sleutels met een
-- formaatcontrole in plaats van uuid. Alle andere verplichte kolommen,
-- constraints en RLS uit 5.2/5.3 gelden onverkort.

-- ── Tenants · anker voor tenant-aware foreign keys ──────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          text PRIMARY KEY CHECK (length(id) BETWEEN 2 AND 64),
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'starter',
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NULL,
  updated_by  text NULL,
  version     integer NOT NULL DEFAULT 1,
  archived_at timestamptz NULL,
  archived_by text NULL
);

-- ── Ondernemingen binnen een tenant (E01) ──────────────────────────────────
-- company_id hangt op juridische en financiële documenten; de FK is
-- TENANT-AWARE (5.2): een company kan nooit bij een andere tenant horen.
CREATE TABLE IF NOT EXISTS companies (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name     text NOT NULL,
  vat            text NULL,
  company_number text NULL,
  iban           text NULL,
  peppol_id      text NULL,
  is_default     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NULL,
  updated_by     text NULL,
  version        integer NOT NULL DEFAULT 1,
  archived_at    timestamptz NULL,
  archived_by    text NULL,
  -- Samengestelde sleutel zodat andere tabellen tenant-aware naar een company
  -- kunnen verwijzen (zie 5.2 "FOREIGN KEY (..., tenant_id) REFERENCES ...").
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS companies_tenant_idx ON companies (tenant_id);
-- Eén default-onderneming per tenant · afgedwongen door de database, niet enkel
-- door de applicatie.
CREATE UNIQUE INDEX IF NOT EXISTS companies_one_default_per_tenant
  ON companies (tenant_id) WHERE is_default;

-- ── Nummerreeksen (E01/PLT-BR-005) ─────────────────────────────────────────
-- Uitgifte is definitief en monotoon per onderneming, documenttype en jaar.
CREATE TABLE IF NOT EXISTS number_sequences (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id  text NULL,
  doc_type    text NOT NULL,
  year        integer NOT NULL,
  next_seq    integer NOT NULL DEFAULT 1 CHECK (next_seq > 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, doc_type, year),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id) ON DELETE CASCADE
);

-- ── Rij-niveau isolatie (5.3) ──────────────────────────────────────────────
-- Defense in depth: naast het tenant_id-predicate in elke repositoryquery
-- weigert de database zelf rijen van een andere tenant. De applicatie zet per
-- transactie: SET LOCAL app.tenant_id = '<tenant>'.
-- current_setting(..., true) geeft NULL als de variabele niet gezet is; de
-- policy laat dan NIETS door (fail closed).
ALTER TABLE tenants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE number_sequences  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_isolation ON tenants;
CREATE POLICY tenants_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS companies_isolation ON companies;
CREATE POLICY companies_isolation ON companies
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS number_sequences_isolation ON number_sequences;
CREATE POLICY number_sequences_isolation ON number_sequences
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ── updated_at automatisch bijwerken ───────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_touch ON tenants;
CREATE TRIGGER tenants_touch BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS companies_touch ON companies;
CREATE TRIGGER companies_touch BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
