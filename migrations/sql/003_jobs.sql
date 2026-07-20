-- 003_jobs · wachtrij voor uitvoerwerk (handover 4.6 · PostgresJobQueue)
--
-- Standaard PostgreSQL: reserveren gebeurt met FOR UPDATE SKIP LOCKED, het
-- canonieke queue-patroon dat op elke Postgres werkt (lokaal, Azure, RDS,
-- Cloud SQL). Geen extensies.
--
-- BEWUST GEEN row level security op deze tabel: workers verwerken jobs van
-- ALLE tenants (platformcontext), net als de outbox. tenant_id is verplicht
-- aanwezig voor herkomst en telemetrie, maar de wachtrij zelf is geen
-- tenant-datavlak; de payload bevat ids, geen persoonsgegevens.

CREATE TABLE IF NOT EXISTS jobs (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL,
  type             text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_version  integer NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  correlation_id   text NULL,
  idempotency_key  text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reserved','done','dead')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts     integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  run_at           timestamptz NOT NULL DEFAULT now(),
  reserved_by      text NULL,
  reserved_until   timestamptz NULL,
  last_error       text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  done_at          timestamptz NULL,
  -- Idempotente publish (handover 4.6): dezelfde logische taak bestaat maar
  -- één keer, ongeacht hoeveel replicas of retries hem publiceren.
  UNIQUE (tenant_id, type, idempotency_key)
);

-- Reserveren zoekt uitsluitend klaarstaand werk · partiële index houdt dat
-- goedkoop, ook met een grote done/dead-historie.
CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs (run_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS jobs_reserved_idx ON jobs (reserved_until) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS jobs_tenant_idx ON jobs (tenant_id, type);

DROP TRIGGER IF EXISTS jobs_touch ON jobs;
CREATE TRIGGER jobs_touch BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
