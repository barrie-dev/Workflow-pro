-- 008_forms · gedeelde Forms-capability, canoniek datamodel (Forms & Information
-- Fields handover, F1 Foundation · FORM-01).
--
-- Eén platformbrede formulierengine, GEEN parallelle engine per module en GEEN
-- vrije-JSON-tweede-waarheid (finale CTO-directive). Een domeinformulier schrijft
-- via een gevalideerd command naar het canonieke domeinobject; een bewijs-/
-- checklistformulier blijft als immutable instance bestaan. Formulierversies zijn
-- na publicatie ONVERANDERLIJK; een wijziging maakt een nieuwe versie en bestaande
-- instances blijven aan hun oorspronkelijke versie gekoppeld.
--
-- Datamodel (spec h4):
--   form_definitions → form_versions → form_sections → form_fields → form_rules
--   form_assignments → form_instances → form_answers → form_answer_index
--   form_attachments → form_signatures → form_approval_steps/actions → form_events
--
-- Alles tenant-scoped met row level security (zelfde model als 001/002/005/006).

-- ── Definities · de logische formulieren van een tenant ─────────────────────
CREATE TABLE IF NOT EXISTS form_definitions (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id          text NULL,
  -- Technische sleutel is na eerste publicatie ONVERANDERLIJK (spec h_CFG); uniek
  -- binnen de tenant. Standaardformulieren dragen hun catalog-id (bv. 'CRM-001').
  key                 text NOT NULL,
  name                text NOT NULL,
  -- domain | workflow | evidence | survey (spec h2).
  form_type           text NOT NULL DEFAULT 'domain'
                        CHECK (form_type IN ('domain','workflow','evidence','survey')),
  category            text NULL,
  -- Activatiestatus (spec h2): system_required | available | enabled | conditional
  -- | scheduled | paused | deprecated | archived.
  status              text NOT NULL DEFAULT 'available'
                        CHECK (status IN ('system_required','available','enabled','conditional','scheduled','paused','deprecated','archived')),
  -- Canoniek domeinobject dat dit formulier voedt (customer, project, ...); NULL
  -- voor pure bewijs-/enquêteformulieren.
  domain_object       text NULL,
  data_classification text NOT NULL DEFAULT 'internal'
                        CHECK (data_classification IN ('public','internal','confidential','personal','special_category','financial','security_sensitive')),
  retention_policy_id text NULL,
  -- Verwijst naar de gepubliceerde versie die nieuwe instances gebruiken.
  current_version     integer NULL,
  scheduled_from      timestamptz NULL,
  scheduled_until     timestamptz NULL,
  attributes          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NULL,
  archived_at         timestamptz NULL,
  archived_by         text NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS form_definitions_tenant_idx ON form_definitions (tenant_id);
CREATE INDEX IF NOT EXISTS form_definitions_status_idx ON form_definitions (tenant_id, status);

-- ── Versies · een gepubliceerde versie is een IMMUTABLE snapshot ─────────────
CREATE TABLE IF NOT EXISTS form_versions (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  definition_id     text NOT NULL,
  version_number    integer NOT NULL CHECK (version_number > 0),
  -- draft → published. Een gepubliceerde versie mag NOOIT nog inhoudelijk wijzigen
  -- (afgedwongen door de applicatie + de touch/guard); een wijziging = nieuwe versie.
  published         boolean NOT NULL DEFAULT false,
  published_at      timestamptz NULL,
  published_by      text NULL,
  -- Bevroren snapshot van secties/velden/regels op publicatiemoment (bewijs +
  -- read-your-writes zonder joins). De losse tabellen hieronder dragen de
  -- bewerkbare DRAFT-structuur; bij publicatie wordt de snapshot hier bevroren.
  snapshot          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Mapping van oude naar nieuwe velden voor migratie van bestaande instances.
  migration_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, definition_id, version_number),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES form_definitions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_versions_def_idx ON form_versions (tenant_id, definition_id);

-- ── Secties · groepering binnen een versie ──────────────────────────────────
CREATE TABLE IF NOT EXISTS form_sections (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id    text NOT NULL,
  section_key   text NOT NULL,
  title         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {nl,fr,en}
  help_text     jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order    integer NOT NULL DEFAULT 0,
  repeatable    boolean NOT NULL DEFAULT false,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, version_id, section_key),
  FOREIGN KEY (tenant_id, version_id) REFERENCES form_versions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_sections_version_idx ON form_sections (tenant_id, version_id);

-- ── Velden · de datadictionary van een versie ───────────────────────────────
CREATE TABLE IF NOT EXISTS form_fields (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id          text NOT NULL,
  section_id          text NULL,
  field_key           text NOT NULL,
  label               jsonb NOT NULL DEFAULT '{}'::jsonb,   -- NL/FR/EN verplicht
  help_text           jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_type          text NOT NULL,                        -- text,number,date,enum,file,...
  data_classification text NOT NULL DEFAULT 'internal'
                        CHECK (data_classification IN ('public','internal','confidential','personal','special_category','financial','security_sensitive')),
  required            text NOT NULL DEFAULT 'optional'
                        CHECK (required IN ('optional','required','conditional','system')),
  -- Bindt dit veld aan een kolom van het canonieke domeinobject (domain command).
  domain_field        text NULL,
  -- Server-side rechten + reporting/AI-vlaggen (spec h3/h26).
  view_permission     text NULL,     -- bv. field.cost_price.view
  edit_permission     text NULL,
  reporting_allowed   boolean NOT NULL DEFAULT false,
  ai_allowed          boolean NOT NULL DEFAULT false,
  validation          jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order          integer NOT NULL DEFAULT 0,
  attributes          jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, version_id, field_key),
  FOREIGN KEY (tenant_id, version_id) REFERENCES form_versions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_fields_version_idx ON form_fields (tenant_id, version_id);

-- ── Regels · conditionele zichtbaarheid, berekeningen, validaties ───────────
CREATE TABLE IF NOT EXISTS form_rules (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id    text NOT NULL,
  rule_type     text NOT NULL CHECK (rule_type IN ('visibility','calculation','validation','requirement')),
  -- Veilige, gedeclareerde regel (GEEN vrije code, spec FORM-12).
  definition    jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order    integer NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id, version_id) REFERENCES form_versions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_rules_version_idx ON form_rules (tenant_id, version_id);

-- ── Toewijzingen · activatie op scope of externe token ──────────────────────
CREATE TABLE IF NOT EXISTS form_assignments (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  definition_id     text NOT NULL,
  -- tenant | company | team | role | user | project | customer | workorder | asset | supplier | external
  scope_type        text NOT NULL
                        CHECK (scope_type IN ('tenant','company','team','role','user','project','customer','workorder','asset','supplier','external')),
  scope_id          text NULL,
  active            boolean NOT NULL DEFAULT true,
  -- Externe token: vervalt, is intrekbaar, geeft enkel toegang tot de bedoelde
  -- instance/velden (spec FORM-09). Hash bewaard, nooit het ruwe token.
  external_token_hash text NULL,
  token_expires_at  timestamptz NULL,
  revoked_at        timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NULL,
  FOREIGN KEY (tenant_id, definition_id) REFERENCES form_definitions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_assignments_def_idx ON form_assignments (tenant_id, definition_id);
CREATE INDEX IF NOT EXISTS form_assignments_scope_idx ON form_assignments (tenant_id, scope_type, scope_id);

-- ── Instances · een ingevuld/lopend formulier, gebonden aan één versie ──────
CREATE TABLE IF NOT EXISTS form_instances (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id        text NULL,
  definition_id     text NOT NULL,
  version_id        text NOT NULL,        -- BLIJFT gekoppeld aan de originele versie
  assignment_id     text NULL,
  -- Het domeinobject waar de instance bij hoort (project, workorder, ...).
  subject_type      text NULL,
  subject_id        text NULL,
  -- Lifecycle (spec h4): not_started, draft, submitted, in_review, changes_requested,
  -- resubmitted, approved, rejected, signed, completed, withdrawn, void, archived.
  status            text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('not_started','draft','submitted','in_review','changes_requested','resubmitted','approved','rejected','signed','completed','withdrawn','void','archived')),
  assigned_to       text NULL,
  -- Idempotente submit (spec FORM-04): dezelfde sleutel maakt geen tweede submit.
  idempotency_key   text NULL,
  submitted_at      timestamptz NULL,
  completed_at      timestamptz NULL,
  archived_at       timestamptz NULL,
  source            text NOT NULL DEFAULT 'ui'
                        CHECK (source IN ('ui','import','api','integration','automation','migration')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version > 0),  -- optimistic/If-Match
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES form_definitions (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, version_id) REFERENCES form_versions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_instances_def_idx ON form_instances (tenant_id, definition_id);
CREATE INDEX IF NOT EXISTS form_instances_subject_idx ON form_instances (tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS form_instances_status_idx ON form_instances (tenant_id, status);

-- ── Antwoorden · de ingevulde waarden (nooit de tweede waarheid van een domein) ─
CREATE TABLE IF NOT EXISTS form_answers (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id   text NOT NULL,
  field_key     text NOT NULL,
  value_json    jsonb NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instance_id, field_key),
  FOREIGN KEY (tenant_id, instance_id) REFERENCES form_instances (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_answers_instance_idx ON form_answers (tenant_id, instance_id);

-- ── Typed answer index · voor reporting/search met veldrechten (spec h4/h26) ─
CREATE TABLE IF NOT EXISTS form_answer_index (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id       text NOT NULL,
  field_key         text NOT NULL,
  value_text        text NULL,
  value_num         numeric(20,4) NULL,
  value_date        date NULL,
  reporting_allowed boolean NOT NULL DEFAULT false,
  ai_allowed        boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, instance_id, field_key),
  FOREIGN KEY (tenant_id, instance_id) REFERENCES form_instances (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_answer_index_field_idx ON form_answer_index (tenant_id, field_key);

-- ── Bijlagen · in object storage, metadata hier (spec FORM-08) ───────────────
CREATE TABLE IF NOT EXISTS form_attachments (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id    text NOT NULL,
  field_key      text NULL,
  object_key     text NOT NULL,
  file_name      text NULL,
  mime_type      text NULL,
  size_bytes     bigint NOT NULL DEFAULT 0,
  malware_status text NOT NULL DEFAULT 'pending'
                   CHECK (malware_status IN ('pending','clean','infected','error')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NULL,
  FOREIGN KEY (tenant_id, instance_id) REFERENCES form_instances (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_attachments_instance_idx ON form_attachments (tenant_id, instance_id);

-- ── Handtekeningen · gebonden aan versie + inhoudshash (spec FORM-08) ────────
CREATE TABLE IF NOT EXISTS form_signatures (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id    text NOT NULL,
  signer_name    text NOT NULL,
  signer_ref     text NULL,
  bound_version  integer NULL,
  bound_hash     text NULL,
  invalidated    boolean NOT NULL DEFAULT false,
  signed_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, instance_id) REFERENCES form_instances (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_signatures_instance_idx ON form_signatures (tenant_id, instance_id);

-- ── Goedkeuringsstappen + acties · segregation of duties (spec FORM-07) ──────
CREATE TABLE IF NOT EXISTS form_approval_steps (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id    text NOT NULL,
  step_no        integer NOT NULL DEFAULT 1,
  mode           text NOT NULL DEFAULT 'serial'
                   CHECK (mode IN ('serial','parallel','any_of','all_of')),
  approver_scope text NULL,
  rule           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- amount/risk/context
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','skipped')),
  deadline_at    timestamptz NULL,
  UNIQUE (tenant_id, instance_id, step_no),
  FOREIGN KEY (tenant_id, instance_id) REFERENCES form_instances (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_approval_steps_instance_idx ON form_approval_steps (tenant_id, instance_id);

CREATE TABLE IF NOT EXISTS form_approval_actions (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id    text NOT NULL,
  step_no        integer NOT NULL DEFAULT 1,
  actor          text NOT NULL,
  decision       text NOT NULL CHECK (decision IN ('approved','rejected','changes_requested')),
  note           text NULL,
  acted_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, instance_id) REFERENCES form_instances (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS form_approval_actions_instance_idx ON form_approval_actions (tenant_id, instance_id);

-- ── Events · append-only lifecycle-log (spec h27) ───────────────────────────
CREATE TABLE IF NOT EXISTS form_events (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id    text NULL,
  definition_id  text NULL,
  event_type     text NOT NULL,   -- form.assigned, draft.saved, submitted, changes_requested, approved, rejected, signed, completed, expired, archived
  actor          text NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  data           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS form_events_tenant_idx ON form_events (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS form_events_instance_idx ON form_events (tenant_id, instance_id);

-- ── Rij-niveau isolatie (spec: alles tenant-scoped) · zelfde model als 001/006 ─
ALTER TABLE form_definitions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_versions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_sections         ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_fields           ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_rules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_instances        ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_answers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_answer_index     ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_attachments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_signatures       ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_approval_steps   ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_approval_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_events           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'form_definitions','form_versions','form_sections','form_fields','form_rules',
    'form_assignments','form_instances','form_answers','form_answer_index',
    'form_attachments','form_signatures','form_approval_steps','form_approval_actions','form_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true))',
      t || '_isolation', t);
  END LOOP;
END $$;

-- Touch-triggers op tabellen met updated_at (zelfde touch_updated_at als 001/006).
DROP TRIGGER IF EXISTS form_definitions_touch ON form_definitions;
CREATE TRIGGER form_definitions_touch BEFORE UPDATE ON form_definitions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS form_versions_touch ON form_versions;
CREATE TRIGGER form_versions_touch BEFORE UPDATE ON form_versions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS form_instances_touch ON form_instances;
CREATE TRIGGER form_instances_touch BEFORE UPDATE ON form_instances
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS form_answers_touch ON form_answers;
CREATE TRIGGER form_answers_touch BEFORE UPDATE ON form_answers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
