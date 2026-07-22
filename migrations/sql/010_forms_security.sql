-- 010_forms_security · CTO-review v2 (2026-07-22) · CTO2-07 retention completion.
--
-- Legal hold leeft op de INSTANCE zelf (niet enkel op het beleid): een lopende
-- juridische bewaring bevriest élke purge van precies dit dossier, met reden.
-- De retentie-runtime (applyRetention) leest deze kolom mee; retention-policy.js
-- respecteerde row.legal_hold al · de kolom bestond alleen nog niet.

ALTER TABLE form_instances
  ADD COLUMN IF NOT EXISTS legal_hold        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legal_hold_reason text NULL;

-- Snel purge-kandidaten uitsluiten die onder hold staan.
CREATE INDEX IF NOT EXISTS form_instances_legal_hold_idx
  ON form_instances (tenant_id) WHERE legal_hold;
