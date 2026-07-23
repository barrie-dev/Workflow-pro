# Monargo One design system

Status: stap 2, gedeelde visuele fundering

Referentiepunt: `main` op commit `8284e5f`

Datum: 23 juli 2026

## Doel

Admin, Manager, Medewerker, Reseller en Superadmin gebruiken één Monargo-visuele basis. De fundering staat los van de inhoud van een module. Nieuwe backendfuncties kunnen daardoor worden toegevoegd zonder een nieuwe kleur, tekstschaal of componentvariant te introduceren.

De eerste module die dit systeem volledig valideert is `Operaties > Planning`. Die module hoort bij de volgende roadmapstap en wordt afzonderlijk voor Admin, Manager en Medewerker uitgewerkt.

## Vaste ontwerpprincipes

1. Monargo Blue `#0071E3` is de enige primaire actiekleur.
2. Donkere navigatie en lichte werkvlakken vormen de vaste desktopshell.
3. Witruimte wordt gebruikt om hiërarchie te maken. Teksten worden niet verkleind om meer inhoud in een scherm te duwen.
4. Een normaal desktopscherm gebruikt 32 px paginaruimte, 24 px op kleinere laptops en 16 px op mobiel.
5. Kaarten gebruiken standaard 24 px interne ruimte en tabellen hebben leesbare rijen.
6. Complexe aanmaak- en wijzigingsflows openen als volwaardige werkpagina.
7. Semantische kleuren worden alleen gebruikt voor succes, waarschuwing, fout en informatieve status.
8. Admin, Manager en Medewerker delen tenantdata en componenten, maar behouden een rolgerichte inhoud.
9. Reseller en Superadmin blijven aparte productomgevingen met dezelfde visuele taal.
10. Nieuwe UI bevat geen inline kleur, radius, schaduw of willekeurige tekstgrootte.

## Bron van waarheid

De canonieke tokens en componentcontracten staan in:

`public/css/monargo-design-system.css`

Dit bestand wordt als laatste externe stylesheet in `public/index.html` geladen. Bestaande stijlen blijven tijdelijk beschikbaar. Compatibiliteitsaliassen koppelen oudere `--wf-*` variabelen aan de nieuwe `--mn-*` tokens.

## Tokenfamilies

| Familie | Voorbeelden | Gebruik |
|---|---|---|
| Merk | `--mn-brand`, `--mn-brand-hover`, `--mn-brand-soft` | Primaire acties, actieve navigatie, focus |
| Oppervlak | `--mn-canvas`, `--mn-surface`, `--mn-surface-subtle` | Pagina, kaarten, rustige secties |
| Tekst | `--mn-ink`, `--mn-text`, `--mn-text-secondary` | Titels, inhoud, context |
| Rand | `--mn-border`, `--mn-border-strong` | Kaarten, tabellen, velden |
| Status | `--mn-success`, `--mn-warning`, `--mn-danger` | Status en feedback |
| Witruimte | `--mn-space-1` tot `--mn-space-16` | Marges, padding, gaps |
| Vorm | `--mn-radius-control`, `--mn-radius-card`, `--mn-radius-modal` | Bediening en oppervlakken |
| Shell | `--mn-sidebar-width`, `--mn-topbar-height`, `--mn-page-padding` | Platformlayout |

## Nieuwe componentcontracten

Nieuwe schermen gebruiken de `mn-*` klassen. De eerste ondersteunde set:

| Component | Klassen |
|---|---|
| Pagina | `mn-page`, `mn-page-header`, `mn-page-title`, `mn-page-description` |
| Acties | `mn-page-actions`, `mn-toolbar`, `mn-inline-actions` |
| Kaart | `mn-card`, `mn-card-header`, `mn-card-title`, `mn-card-body` |
| Raster | `mn-grid`, `mn-grid-2`, `mn-grid-3` |
| Knop | `mn-btn`, `mn-btn-primary`, `mn-btn-secondary`, `mn-btn-ghost`, `mn-btn-danger` |
| Formulier | `mn-field`, `mn-label`, `mn-input`, `mn-select`, `mn-textarea`, `mn-help`, `mn-error` |
| Tabel | `mn-table-wrap`, `mn-table` |
| Status | `mn-status` met `success`, `warning`, `danger` of `info` |
| Lege status | `mn-empty`, `mn-empty-inner`, `mn-empty-icon` |
| Laden | `mn-skeleton` |
| Werkpagina | `mn-workspace-overlay`, `mn-workspace-shell`, `mn-workspace-header`, `mn-workspace-body`, `mn-workspace-footer` |

## Platformverdeling

| Omgeving | Shell | Inhoudsrichting |
|---|---|---|
| Admin | Donkere modulenavigatie, brede desktopwerkruimte | Volledige tenantbediening |
| Manager | Dezelfde shell en tokens | Teamplanning, verdeling en goedkeuring |
| Medewerker | Mobiel touch-first, desktop met dezelfde shell | Eigen planning, werkbonnen, tijd, verlof en onkosten |
| Reseller | Eigen portalheader, gedeelde kaarten en bediening | Klanten, tenants, licenties, commissies en support |
| Superadmin | Donkere platformnavigatie, duidelijke platformcontext | Tenants, resellers, billing, security en operations |

## Werken naast doorlopende ontwikkeling

Elke nieuwe frontendwijziging volgt deze regels:

1. Gebruik bestaande API-responses en simuleer geen backendlogica in de frontend.
2. Gebruik `mn-*` componenten voor nieuw werk.
3. Voeg alleen een nieuwe token toe wanneer een bestaande token het doel niet dekt.
4. Voeg geen nieuwe primaire kleur toe.
5. Plaats een complexe flow in een `mn-workspace-*` werkpagina.
6. Registreer backendtekorten apart. Verberg ze niet met tijdelijke nepdata.
7. Behoud rechten en entitlements. Visuele beschikbaarheid mag nooit een autorisatiebeslissing vervangen.
8. Controleer Admin, Manager, Medewerker, Reseller en Superadmin na een wijziging aan gedeelde tokens.
9. Controleer NL, FR en EN op tekstlengte en afbreking.
10. Werk de nulmeting bij via het wijzigingslog wanneer een nieuw scherm of een nieuwe route wordt toegevoegd.

## Acceptatie voor stap 2

Stap 2 is technisch afgerond wanneer:

- de vijf omgevingen dezelfde merk-, ruimte- en componenttokens gebruiken;
- het officiële Monargo-symbool in alle platformshells staat;
- de oude paarse primaire kleur niet meer de effectieve platformkleur is;
- nieuwe componentcontracten gedocumenteerd en getest zijn;
- bestaande productfunctionaliteit en rechten ongewijzigd blijven;
- de volledige geautomatiseerde testset slaagt.

Visuele verfijning gebeurt vervolgens module per module. `Operaties > Planning` is de eerste pilot.
