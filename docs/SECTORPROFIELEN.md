# WorkFlow Pro — Sectorprofielen (multi-markt)

**Doel:** één horizontaal platform voor elke KMO met mensen op locatie. De kern is
voor iedereen identiek; per sector verschillen alleen de **woorden** (terminologie)
en welke **modules standaard aanstaan**. Geen aparte app per sector.

> Status: PLAN (nog niet gebouwd). Bouwt op het bestaande `catalog` + `bundels` +
> entitlements-systeem en de onboarding (golden-path / demo-seed).

## Gedeelde kern (altijd aan, sector-neutraal)
Planning · Werkbonnen · Prikklok (uren) · Klanten · Medewerkers · Berichten ·
Dashboard · Instellingen · (facturatie meestal aan, met Belgische btw + Peppol).

Deze blijven **ongewijzigd** ongeacht de sector — daar mag nooit iets
sector-specifieks in.

## Wat een sectorprofiel bepaalt
1. **Terminologie** — het woord voor een werklocatie en voor een opdracht.
2. **Standaard-modules** — welke modules aan/uit staan bij het opstarten.
3. **Voorbeelddata** — passende demo-content bij onboarding.

## De profielen

| Sector | Locatie heet… | Opdracht heet… | Extra modules standaard aan (bovenop kern) |
|---|---|---|---|
| **Bouw & installatie** | Werf | Werkbon | Offertes, Facturen, Stock, Voertuigen, Onkosten, Verlof |
| **Schoonmaak** | Klantlocatie | Poetsbeurt | Facturen, Verlof, Onkosten |
| **Groen / tuinonderhoud** | Tuin/terrein | Onderhoudsbeurt | Offertes, Facturen, Voertuigen, Stock, Verlof |
| **HVAC / technische dienst** | Installatie/site | Interventie | Offertes, Facturen, Stock, Voertuigen, Onkosten |
| **Beveiliging / bewaking** | Site/post | Shift/ronde | Verlof, Onkosten |
| **Facility / multiservice** | Gebouw/site | Taak/ticket | Offertes, Facturen, Stock, Verlof, Onkosten |
| **Events / verhuur & opbouw** | Eventlocatie | Opbouw/afbraak | Offertes, Facturen, Stock, Voertuigen |
| **Mobiele zorg / thuisdiensten** | Cliëntadres | Bezoek | Verlof, Onkosten |
| **Transport / levering** | Stop/adres | Rit/levering | Voertuigen, Onkosten, Verlof |
| **Herstellingen & service (algemeen)** | Klantlocatie | Interventie | Offertes, Facturen, Stock, Voertuigen |

> De namen zijn labels in de UI — onderliggend blijft het dezelfde "werkbon",
> "venue/locatie" en "opdracht". Eén codebasis.

## Hoe dit past in wat er al is
- **Catalog/bundels:** elk profiel = een vooraf gekozen modulenset (zoals de
  bestaande Starter/Business/Enterprise-bundels, maar per sector ingekleurd).
- **Onboarding:** bij het aanmaken van een tenant kiest de klant zijn sector →
  juiste modules + terminologie + voorbeelddata worden meteen gezet.
- **Custom velden (toekomstig):** waar een sector eigen velden wil (bv. "type
  installatie", "toegangscode site"), lost een per-tenant custom-veld-systeem dat
  op — opnieuw zonder sector-specifieke code in de kern.
- **Verticale diepte = optioneel:** bouwklanten die zware administratie willen →
  Robaws/Exact-koppeling of optionele bouwmodules; andere sectoren laden die niet.

## Differentiatie (geldt voor álle sectoren)
Mobiel-first, strakke UX, snelle onboarding ("in 1 dag live"), transparante
modulaire prijs, AI-assistent (Mona), realtime kantoor↔veld. Dat is de wig tegen
zowel sector-specifieke (Robaws = bouw) als logge generieke concurrenten.

## Guardrail (één regel)
**Nooit iets in de gedeelde kern bouwen dat maar voor één sector geldt.**
Sector-specifiek = via profiel (woorden + modules) of via een custom veld.

## Open keuzes om later te beslissen
- Welke sectoren eerst actief promoten (focus i.p.v. alle 10 tegelijk).
- Of terminologie per tenant aanpasbaar is, of vast per profiel.
- Of er sectorgerichte prijsbundels komen of één modulaire prijs voor iedereen.
