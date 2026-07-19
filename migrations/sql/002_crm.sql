-- 002_crm · eerste genormaliseerde domein (handover 5.4 stap 2)
--
-- Eén domein per keer (5.5 verbiedt een big-bang). CRM gaat eerst omdat er al
-- een compatibility repository voor bestaat (src/platform/crm.js), dus de
-- shadow-read uit 5.4 stap 6 kan hier het goedkoopst bewezen worden.
--
-- Legacy blijft ondertussen de bron: deze tabellen worden gevuld door een
-- idempotente backfill en pas na reconciliatie als leesbron gebruikt.

CREATE TABLE IF NOT EXISTS customers (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id      text NULL,
  -- Zakelijk nummer is uniek BINNEN een tenant (5.2), niet globaal.
  customer_number text NULL,
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  email           text NULL,
  phone           text NULL,
  vat_number      text NULL,
  language        text NOT NULL DEFAULT 'nl' CHECK (language IN ('nl','fr','en')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('prospect','active','on_hold','blocked','archived')),
  credit_limit    numeric(14,2) NULL CHECK (credit_limit IS NULL OR credit_limit >= 0),
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  price_group     text NULL,
  notes           text NULL,
  -- Vrije velden uit het configuratieplatform (E10) blijven als document naast
  -- de genormaliseerde kolommen staan: ze zijn per tenant verschillend en
  -- lenen zich niet voor vaste kolommen.
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NULL,
  updated_by      text NULL,
  version         integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at     timestamptz NULL,
  archived_by     text NULL,
  UNIQUE (tenant_id, customer_number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS customers_tenant_idx  ON customers (tenant_id);
CREATE INDEX IF NOT EXISTS customers_status_idx  ON customers (tenant_id, status);
-- Zoeken op naam gebeurt hoofdletterongevoelig; zonder deze index wordt dat
-- een sequentiële scan zodra een tenant duizenden klanten heeft.
CREATE INDEX IF NOT EXISTS customers_name_lower_idx ON customers (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS customer_contacts (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  text NOT NULL,
  first_name   text NULL,
  last_name    text NULL,
  email        text NULL,
  phone        text NULL,
  role         text NULL,
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NULL,
  updated_by   text NULL,
  version      integer NOT NULL DEFAULT 1,
  archived_at  timestamptz NULL,
  archived_by  text NULL,
  -- Tenant-aware FK (5.2): een contact kan nooit aan een klant van een andere
  -- tenant hangen, ook niet bij een gemanipuleerd id.
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS customer_contacts_customer_idx ON customer_contacts (tenant_id, customer_id);
-- Hoogstens één primair contact per klant · door de database afgedwongen.
CREATE UNIQUE INDEX IF NOT EXISTS customer_contacts_one_primary
  ON customer_contacts (tenant_id, customer_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  text NOT NULL,
  type         text NOT NULL DEFAULT 'main' CHECK (type IN ('main','invoice','delivery','site')),
  street       text NULL,
  number       text NULL,
  postal_code  text NULL,
  city         text NULL,
  country      text NOT NULL DEFAULT 'BE' CHECK (length(country) = 2),
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NULL,
  updated_by   text NULL,
  version      integer NOT NULL DEFAULT 1,
  archived_at  timestamptz NULL,
  archived_by  text NULL,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON customer_addresses (tenant_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_primary
  ON customer_addresses (tenant_id, customer_id) WHERE is_primary;

-- ── Rij-niveau isolatie (5.3) ──────────────────────────────────────────────
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_isolation ON customers;
CREATE POLICY customers_isolation ON customers
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS customer_contacts_isolation ON customer_contacts;
CREATE POLICY customer_contacts_isolation ON customer_contacts
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS customer_addresses_isolation ON customer_addresses;
CREATE POLICY customer_addresses_isolation ON customer_addresses
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP TRIGGER IF EXISTS customers_touch ON customers;
CREATE TRIGGER customers_touch BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS customer_contacts_touch ON customer_contacts;
CREATE TRIGGER customer_contacts_touch BEFORE UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS customer_addresses_touch ON customer_addresses;
CREATE TRIGGER customer_addresses_touch BEFORE UPDATE ON customer_addresses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
