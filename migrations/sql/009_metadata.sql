-- 010_metadata · universele objectmetadata + retentiebeleid (Forms & Information
-- Fields handover, h5 "Universele metadata voor alle objecten" · FORM-05).
--
-- Elk object in het platform draagt dezelfde beheer-metadata: classificatie,
-- herkomst (source), externe referentie, bewaarbeleid, tags en interne notities.
-- Dit hoofdstuk verankert het REGISTER van bewaarbeleiden (retention_policies) en
-- vult de ontbrekende universele kolommen aan op de canonieke formuliertabellen.
-- Gevoelige data (personal/special_category/financial/security_sensitive) krijgt
-- via het gekoppelde beleid strengere retentie, legal hold en purge (spec h1/h5).
--
-- Tenant-scoped met row level security (zelfde model als 001/002/006/008).

-- ── Retentiebeleid-register · per tenant herbruikbaar bewaarbeleid ───────────
-- Eén beleid bindt een bewaartermijn, een minimaal te bewaren aantal, een legal
-- hold en een purge-strategie. Objecten verwijzen ernaar via retention_policy_id.
CREATE TABLE IF NOT EXISTS retention_policies (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Stabiele sleutel binnen de tenant (bv. 'gdpr-personal', 'finance-7y').
  key               text NOT NULL,
  name              text NOT NULL,
  description       text NULL,
  -- Op welke classificatie dit beleid standaard van toepassing is (optioneel;
  -- een object kan altijd expliciet een ander beleid kiezen).
  applies_to_classification text NULL
                      CHECK (applies_to_classification IS NULL OR applies_to_classification IN
                        ('public','internal','confidential','personal','special_category','financial','security_sensitive')),
  -- Bewaartermijn in dagen na created_at/archived_at; NULL = onbepaald bewaren.
  retention_days    integer NULL CHECK (retention_days IS NULL OR retention_days >= 0),
  -- Minimaal te bewaren aantal recente objecten, ongeacht de termijn (bv. backups).
  keep_minimum      integer NOT NULL DEFAULT 0 CHECK (keep_minimum >= 0),
  -- Legal hold bevriest ALLE purge tot het weer af staat (heeft voorrang).
  legal_hold        boolean NOT NULL DEFAULT false,
  -- Wat gebeurt er bij het verstrijken: soft_archive | anonymize | hard_delete.
  purge_strategy    text NOT NULL DEFAULT 'soft_archive'
                      CHECK (purge_strategy IN ('soft_archive','anonymize','hard_delete')),
  -- Juridische grondslag voor de bewaring (vrije tekst, bv. 'W.Venn. art. 2:52').
  legal_basis       text NULL,
  active            boolean NOT NULL DEFAULT true,
  attributes        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NULL,
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS retention_policies_tenant_idx ON retention_policies (tenant_id);
CREATE INDEX IF NOT EXISTS retention_policies_class_idx ON retention_policies (tenant_id, applies_to_classification) WHERE active;

ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policies FORCE ROW LEVEL SECURITY;

-- ── Universele-metadata kolommen aanvullen op de canonieke formuliertabellen ──
-- form_definitions had al data_classification + retention_policy_id; vul source,
-- external_reference, tags en notes_internal aan (h5).
ALTER TABLE form_definitions
  ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'ui'
    CHECK (source IN ('ui','import','api','integration','automation','migration')),
  ADD COLUMN IF NOT EXISTS external_reference text NULL,
  ADD COLUMN IF NOT EXISTS tags               jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes_internal     text NULL;

-- form_instances had al source; vul classificatie, externe referentie, retentie,
-- tags en notities aan zodat een ingediende instance zijn eigen beheer-metadata draagt.
ALTER TABLE form_instances
  ADD COLUMN IF NOT EXISTS data_classification text NOT NULL DEFAULT 'internal'
    CHECK (data_classification IN ('public','internal','confidential','personal','special_category','financial','security_sensitive')),
  ADD COLUMN IF NOT EXISTS external_reference  text NULL,
  ADD COLUMN IF NOT EXISTS retention_policy_id text NULL,
  ADD COLUMN IF NOT EXISTS tags                jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes_internal      text NULL;

-- Zoek-index op externe referentie (connector/source-koppeling, h5).
CREATE INDEX IF NOT EXISTS form_definitions_extref_idx ON form_definitions (tenant_id, external_reference) WHERE external_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS form_instances_extref_idx  ON form_instances (tenant_id, external_reference) WHERE external_reference IS NOT NULL;
-- Retentie-scan-index: vind purge-kandidaten per beleid snel.
CREATE INDEX IF NOT EXISTS form_instances_retention_idx ON form_instances (tenant_id, retention_policy_id) WHERE retention_policy_id IS NOT NULL;

-- ── RLS-policy op het nieuwe register (zelfde patroon als 008) ───────────────
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS retention_policies_isolation ON retention_policies';
  EXECUTE 'CREATE POLICY retention_policies_isolation ON retention_policies USING (tenant_id = current_setting(''app.tenant_id'', true))';
END $$;

-- Touch-trigger op updated_at (zelfde touch_updated_at als 001/006/008).
DROP TRIGGER IF EXISTS retention_policies_touch ON retention_policies;
CREATE TRIGGER retention_policies_touch BEFORE UPDATE ON retention_policies
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
