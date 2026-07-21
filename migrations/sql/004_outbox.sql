-- 004 · Transactionele outbox (CTO P0-05, master-spec h46/5.3).
--
-- Domeinevents leefden alleen in de platform_state met een cap van 2.000:
-- oude events konden stil afgesneden worden en er was geen duurzame log om
-- uit te herbezorgen. Deze tabel is de DUURZAME kopie: de pg-adapter schrijft
-- nieuwe events in DEZELFDE transactie als de staat (atomair · een commit
-- bevat de domeinwijziging én zijn events, of geen van beide).
--
-- Bewust GEEN RLS: net als jobs is dit platform-infrastructuur die de
-- achtergrondlus zonder tenantcontext leest; elke rij draagt tenant_id en de
-- API-laag scopet zelf.

CREATE TABLE IF NOT EXISTS outbox_events (
  id               text PRIMARY KEY,           -- evt_<ULID> · idempotent op herhaalde flush
  tenant_id        text NOT NULL,
  company_id       text NULL,
  event_type       text NOT NULL,
  aggregate_type   text NOT NULL,
  aggregate_id     text NOT NULL,
  occurred_at      timestamptz NOT NULL,
  correlation_id   text NULL,
  version          integer NOT NULL DEFAULT 1,
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_status  text NOT NULL DEFAULT 'pending'
                   CHECK (delivery_status IN ('pending','delivered','dead_letter')),
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text NULL,
  delivered_at     timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_events_status_idx  ON outbox_events (delivery_status, occurred_at);
CREATE INDEX IF NOT EXISTS outbox_events_tenant_idx  ON outbox_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS outbox_events_type_idx    ON outbox_events (event_type, occurred_at DESC);
