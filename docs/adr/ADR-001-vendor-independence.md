# ADR-001 · Vendor independence

Status: geaccepteerd · 2026-07-17
Eigenaar: technisch eigenaar + product owner
Bron: docs/spec/vendor-independence-azure.md (handover v1.0)

## Context
Monargo One draait tijdens development op Render + Supabase en gaat voor de
eerste professionele productie-implementatie richting Azure. Azure mag echter
nooit een afhankelijkheid van de domein- of applicatielaag worden (regel P-01),
en migratie naar of weg van elke provider moet mogelijk blijven zonder
domeinwijziging.

## Besluit
1. Domein- en applicatielogica is cloudblind: geen vendor-SDK's (@azure/*,
   aws-sdk, @google-cloud/*, @supabase/*) en geen process.env buiten
   bootstrap/configuratie (nu: src/lib/config.js).
2. Alle externe capabilities lopen via ports & adapters (database, object
   storage, secrets, identity/federation, e-mail, AI, jobs, telemetry).
3. Open standaarden eerst: OCI-containers, standaard PostgreSQL, S3-compatibele
   semantiek, OIDC/SAML, OpenTelemetry, JSON, HTTPS.
4. Supabase-verwijzingen zijn uitsluitend toegestaan in de legacy-adapters
   (src/lib/data-adapters.js, src/lib/supabase-rest-bridge.js) en migraties;
   dit pad wordt uitgefaseerd zodra de PostgreSQL-repositorylaag actief is.
5. Renderspecifieke koppelingen (RENDER_GIT_COMMIT, render.yaml) blijven
   tijdelijk als deploymenttarget; generieke equivalenten (APP_COMMIT_SHA,
   IaC/containerdeployment) hebben voorrang.

## Handhaving
- test/architecture.test.js faalt in CI bij verboden imports of
  process.env-gebruik in de nieuwe lagen (src/platform, src/domain,
  src/application, src/ports).
- Uitzonderingen vereisen een nieuwe of bijgewerkte ADR, goedgekeurd door de
  technisch eigenaar.

## Gevolgen
Nieuwe domeincode blijft testbaar zonder cloudcredentials; Azure wordt een
adapterset (Container Apps, PostgreSQL Flexible Server, Blob, Key Vault,
Monitor) naast lokale/test-implementaties; terugrollen of overstappen blijft
een infrastructuurbeslissing, geen productherbouw.
