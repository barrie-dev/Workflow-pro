-- 006_finance · kerntransacties genormaliseerd (CTO P0-01, handover 5.4)
--
-- Derde en zwaarste domein langs de strangler-route (na CRM en identity):
-- facturen + betalingen. Zwaarder omdat er harde financiële invarianten op
-- rusten die de database mede bewaakt:
--   - factuurnummer is DEFINITIEF en uniek binnen onderneming+jaar (h8/E08);
--   - een factuurregel of allocatie hangt tenant-aware aan zijn ouder;
--   - het openstaande saldo is een SOM over echte rijen, niet over een
--     document · zo valt een rekenfout in de applicatie op als een
--     database-afwijking.
--
-- Bedragen als numeric(14,2), consistent met 002 (customers.credit_limit).
-- Legacy blijft de bron: gevuld door een idempotente sync, pas na reconciliatie
-- als leesbron gebruikt (FINANCE_READ_SOURCE, net als CRM/identity).

-- ── Facturen (kop) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id     text NULL,
  -- Definitief en uniek BINNEN de tenant (5.2). Een factuur zonder nummer
  -- (concept) mag; twee facturen met hetzelfde nummer nooit.
  number         text NULL,
  customer_id    text NULL,
  status         text NOT NULL DEFAULT 'concept',
  invoice_date   date NULL,
  due_date       date NULL,
  subtotal       numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount     numeric(14,2) NOT NULL DEFAULT 0,
  total          numeric(14,2) NOT NULL DEFAULT 0,
  currency       text NOT NULL DEFAULT 'EUR',
  -- Denormale klantgegevens (naam/adres/btw) zoals ze op de factuur GEDRUKT
  -- staan horen bij het document en mogen niet meebewegen met de klantfiche;
  -- ze reizen daarom verbatim mee, net als alle overige legacyvelden.
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number)
  -- STRANGLER-KEUZE (5.5, bewust): GEEN database-FK naar companies/customers.
  -- Finance migreert onafhankelijk van die domeinen; een harde FK zou eisen
  -- dat companies én customers al gemigreerd zijn (big-bang), wat 5.5 juist
  -- verbiedt. De referentie-integriteit wordt bewaakt door de applicatie
  -- (factuurcreatie valideert de klant) en wordt een database-FK zodra
  -- companies co-migreert. tenant_id-FK + RLS blijven onverkort gelden.
);
CREATE INDEX IF NOT EXISTS invoices_tenant_idx   ON invoices (tenant_id);
CREATE INDEX IF NOT EXISTS invoices_customer_idx ON invoices (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx   ON invoices (tenant_id, status);

-- ── Factuurregels · eigen rijen, zodat het totaal een SOM is ───────────────
-- Legacyregels hebben geen eigen id; de VOLGORDE is hun identiteit (line_no).
CREATE TABLE IF NOT EXISTS invoice_lines (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id    text NOT NULL,
  line_no       integer NOT NULL CHECK (line_no >= 0),
  description   text NULL,
  qty           numeric(14,3) NOT NULL DEFAULT 0,
  unit_price    numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate      numeric(6,2) NOT NULL DEFAULT 0,
  line_subtotal numeric(14,2) NOT NULL DEFAULT 0,
  line_vat      numeric(14,2) NOT NULL DEFAULT 0,
  line_total    numeric(14,2) NOT NULL DEFAULT 0,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, invoice_id, line_no),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_idx ON invoice_lines (tenant_id, invoice_id);

-- ── Betalingen ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id    text NULL,
  customer_id   text NULL,
  paid_on       date NULL,
  amount        numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  method        text NULL,
  reference     text NULL,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id)
  -- Zelfde strangler-keuze als bij invoices: geen FK naar companies/customers.
);
CREATE INDEX IF NOT EXISTS payments_tenant_idx   ON payments (tenant_id);
CREATE INDEX IF NOT EXISTS payments_customer_idx ON payments (tenant_id, customer_id);

-- ── Betalingstoewijzingen · eigen rijen (het openstaande saldo is hun som) ──
-- Een toewijzing wordt nooit verwijderd maar TERUGGEDRAAID (reversed_at): de
-- historiek blijft, en alleen niet-teruggedraaide rijen tellen mee in het saldo.
CREATE TABLE IF NOT EXISTS payment_allocations (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id     text NOT NULL,
  invoice_id     text NOT NULL,
  invoice_number text NULL,
  amount         numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  allocated_at   timestamptz NULL,
  allocated_by   text NULL,
  reversed_at    timestamptz NULL,
  reason         text NULL,
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS payment_allocations_payment_idx ON payment_allocations (tenant_id, payment_id);
-- Saldo per factuur = som van de actieve (niet-teruggedraaide) toewijzingen.
CREATE INDEX IF NOT EXISTS payment_allocations_invoice_idx
  ON payment_allocations (tenant_id, invoice_id) WHERE reversed_at IS NULL;

-- ── Rij-niveau isolatie (5.3) · zelfde model als 001/002/005 ───────────────
ALTER TABLE invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_isolation ON invoices;
CREATE POLICY invoices_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS invoice_lines_isolation ON invoice_lines;
CREATE POLICY invoice_lines_isolation ON invoice_lines
  USING (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS payments_isolation ON payments;
CREATE POLICY payments_isolation ON payments
  USING (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS payment_allocations_isolation ON payment_allocations;
CREATE POLICY payment_allocations_isolation ON payment_allocations
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP TRIGGER IF EXISTS invoices_touch ON invoices;
CREATE TRIGGER invoices_touch BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS payments_touch ON payments;
CREATE TRIGGER payments_touch BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
