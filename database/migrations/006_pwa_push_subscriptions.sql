-- Migration 006: PWA Web Push subscriptions
-- Slaat push-endpoint en sleutels op per gebruiker per device.
-- Voer uit in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,   -- ECDH public key (base64url)
  auth          TEXT NOT NULL,   -- Auth secret (base64url)
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subs_tenant_idx   ON push_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS push_subs_user_idx     ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Service role mag alles lezen/schrijven; users mogen alleen eigen subscriptions zien
CREATE POLICY push_subs_tenant_isolation ON push_subscriptions
  USING (tenant_id = current_setting('app.tenant_id', true));

INSERT INTO app_schema_migrations (version, name)
VALUES (6, 'pwa-push-subscriptions')
ON CONFLICT (version) DO NOTHING;
