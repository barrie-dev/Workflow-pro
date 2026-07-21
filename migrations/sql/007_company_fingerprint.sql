-- 007_company_fingerprint · idempotentie-poort voor de company-normalisatie
-- (CTO P0-01 fase 4, handover 5.4).
--
-- companies en number_sequences bestaan al sinds 001 (E01-laag), maar zonder
-- de fingerprint-kolom die de andere genormaliseerde domeinen (tenants/users
-- in 005, facturen/betalingen in 006) gebruiken om ongewijzigde rijen bij een
-- sync NIET te herschrijven. Zonder die poort zou elke spiegel-lus elke rij
-- updaten (version-bump + updated_at-ruis). Zelfde patroon, nu ook hier.

-- attributes: verbatim-bak voor tijdstempels en overige legacyvelden, zodat de
-- projectie verliesvrij is (companies/number_sequences uit 001 hadden die nog
-- niet · de andere genormaliseerde domeinen wel).
ALTER TABLE companies         ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE number_sequences  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE companies         ADD COLUMN IF NOT EXISTS fingerprint text NULL;
ALTER TABLE number_sequences  ADD COLUMN IF NOT EXISTS fingerprint text NULL;
