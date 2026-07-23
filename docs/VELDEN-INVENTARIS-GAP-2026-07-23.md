# Informatievelden · inventaris, benchmark en gap-analyse

Datum: 2026-07-23 · Aanleiding: eigenaarsfeedback "de informatievelden zijn te beperkt voor een SaaS en moeten configureerbaar zijn", platformbreed.

## Cijfers in een oogopslag

| Meting | Aantal |
|---|---|
| Velden die het platform vandaag uitvraagt (as-is, 6 domeinen) | 1256 |
| Daarvan met type-mismatch (semantiek opgeslagen als platte tekst) | 392 |
| Velden die de normatieve CTO-spec eist | 478 |
| Velden uit de marktbenchmark (moderne BE B2B-SaaS) | 116 |
| Concrete gaps benoemd in dit rapport | 59 (19 ontbreekt, 29 verkeerd getypeerd, 11 ongestructureerd) |
| Voorgestelde semantische veldtypes in het typeregister | 40 |

## De tien belangrijkste bevindingen

1. Het platform kent vandaag maar zes veldtypes: tekst, getal, datum, ja/nee, keuzelijst en meerkeuze. Alles daarbuiten, zoals e-mail, telefoon, IBAN, BTW-nummer en adres, wordt als platte tekst opgeslagen. Tenants die een eigen veld aanmaken kunnen dus nooit een gevalideerd e-mail- of IBAN-veld maken.
2. De formulierenmotor is het grootste lek: de spec definieert rijke types (Email, Phone, IBAN, Money, Address, Geo) maar één vertaalfunctie drukt ze allemaal plat naar tekst. Honderden formulier-velden verliezen zo hun betekenis op het moment van opslaan.
3. Bedragen in formulieren (zoals kredietlimiet) belanden letterlijk als tekst in de rapportage-index omdat de vertaalfunctie het woord 'money' niet herkent. Je kunt er dus niet op optellen of filteren.
4. Geen enkel e-mail-, telefoon-, BTW- of IBAN-veld in het hele platform wordt inhoudelijk gecontroleerd. De strengste controle die bestaat is kijken of er een apenstaartje in het e-mailadres staat. Vooral de ongecontroleerde leveranciers-IBAN is een reëel factuurfraude-risico.
5. Adressen zijn op de meeste plekken één tekstregel. Daardoor kunnen routeplanning, de geo-prikklok en Peppol-facturatie niet betrouwbaar werken: Peppol eist straat, postcode, gemeente en land als aparte velden. Ook het Belgische busnummer ontbreekt overal.
6. Namen van contactpersonen staan vaak in één veld, en de migratie naar de nieuwe database splitst ze met een gok (laatste woord wordt achternaam). Namen als 'Van den Berg' worden daarbij blijvend verminkt.
7. Voor de Belgische facturatiepraktijk ontbreken kritieke velden volledig: medecontractant/BTW-verlegd, de gestructureerde mededeling voor betaalmatching, het Peppol-kanaal per klant, het KBO-nummer van de klant en de 6%-renovatieverklaring. Sinds 1 januari 2026 is Peppol verplicht, dus dit is geen luxe maar een wettelijke noodzaak.
8. Voor werf-compliance ontbreekt de hele keten: rijksregisternummer, Dimona, Checkinatwork, 30bis-aangifte en certificaten met vervaldatum (VCA, medische schifting). Concurrent DECA TIME heeft dit wel; dit bevestigt de eerdere gap-analyse.
9. Het goede nieuws: de reparatie hoeft de bestaande rapportage niet te breken. De antwoord-index heeft al drie kolommen (tekst, getal, datum) en elk voorgesteld semantisch type mapt netjes op één van die drie. Validatie komt er bovenop, de opslag blijft compatibel.
10. Eerlijke omvang: dit rapport benoemt 59 concrete gaten (29 verkeerd getypeerd, 11 ongestructureerd, 19 ontbrekend), maar het patroon herhaalt zich door alle 1256 velden. De juiste fix is niet 1256 losse reparaties maar één centraal typeregister van circa 40 types dat de custom fields, de formulierenmotor en de veldenwoordenboek-vertaling alle drie voedt, plus validatie op de schrijfpaden.

## Voorgesteld canoniek typeregister (40 types)

Elk type mapt op een bestaande kolom van de answer-index (value_text / value_num / value_date), zodat de rapportage compatibel blijft. Validatie komt bovenop de opslag, niet in de plaats ervan.

| Type | Samengesteld uit | Validatie | Index |
|---|---|---|---|
| text |  | Vrije tekst, getrimd, maximale lengte per veld | value_text |
| longtext |  | Vrije tekst zonder lengtelimiet behalve platformmaximum (4000 in index) | value_text |
| number |  | Decimaal getal, optioneel min/max en aantal decimalen | value_num |
| integer |  | Geheel getal, optioneel min/max (bv. betalingstermijn 0-365) | value_num |
| percentage |  | Getal 0-100 | value_num |
| money | amount, currency | amount decimaal(14,2); currency ISO 4217 verplicht, default EUR; nooit bedrag zonder valuta | value_num |
| duration |  | Minuten, >= 0; apart van kloktijden | value_num |
| boolean |  | Strikt true/false, geen vrije tekst | value_text |
| date |  | YYYY-MM-DD, kalendervalidatie; optioneel niet-in-toekomst/verleden per veld | value_date |
| datetime |  | ISO 8601 met tijdzone; datumdeel naar de index | value_date |
| time |  | HH:MM 24-uurs (regex bestaat al in work-orders.js) | value_text |
| timezone |  | IANA-tijdzonenaam, default Europe/Brussels | value_text |
| enum |  | Gesloten lijst per veld; onbekende waarde weigeren in plaats van stil aanvaarden | value_text |
| multiselect |  | Subset van gesloten lijst, opgeslagen als array, geïndexeerd als gejoinde tekst | value_text |
| email |  | RFC 5322-syntax, lowercased; MX-check optioneel | value_text |
| phone |  | E.164-normalisatie (+32...), landcode verplicht bij opslag | value_text |
| url |  | Geldige http(s)-URL | value_text |
| language |  | ISO 639-1 uit {nl,fr,en,de} | value_text |
| country |  | ISO 3166-1 alpha-2, default BE | value_text |
| postcode |  | Patroon per land; BE = ^[1-9][0-9]{3}$ | value_text |
| address | street, house_number, box_number, postcode, municipality, country, geo | Straat en gemeente niet leeg; busnummer apart (BE-vereiste); land ISO alpha-2; geocodeerbaar | value_text |
| geo | lat, lng, source | WGS84; lat -90..90, lng -180..180; coördinaat 0 is geldig (huidige Number()··null-valkuil vermijden); bron vastleggen | value_text |
| person_name | first_name, last_name, salutation | Voor- en achternaam apart, nooit één gecombineerd veld; salutation gesloten lijst | value_text |
| company_name |  | Niet leeg; idealiter toetsbaar tegen KBO Public Search | value_text |
| vat_number |  | Landprefix + checksum; BE = 'BE' + 10 cijfers met mod-97 (identiek aan ondernemingsnummer); VIES-check optioneel | value_text |
| enterprise_number |  | KBO: 10 cijfers beginnend met 0 of 1; mod-97: laatste 2 cijfers = 97 - (eerste 8 mod 97) | value_text |
| national_id |  | INSZ/rijksregister of BIS-nummer: 11 cijfers mod-97; versleuteld opslaan, apart leesrecht, volledige audit (special-category) | value_text |
| iban |  | ISO 13616 mod-97-controle (rest 1); BE-IBAN 16 tekens | value_text |
| bic |  | ISO 9362, 8 of 11 tekens, landcode consistent met IBAN | value_text |
| structured_communication |  | Belgische OGM: 12 cijfers; laatste 2 = eerste 10 mod 97, rest 0 wordt 97 | value_text |
| peppol_endpoint |  | Formaat scheme:waarde, BE gangbaar 0208:ondernemingsnummer; bereikbaarheid via SMP-lookup | value_text |
| identifier |  | Generieke externe id (badge, SEPA-mandaat, Dimona-periode, polisnummer, serienummer, GTIN); patroon per subtype, uniek per tenant | value_text |
| reference |  | Moet verwijzen naar bestaande entiteit binnen dezelfde tenant; geen vrije tekst | value_text |
| sequence |  | Systeemreeks, company-scoped, concurrency-safe, onveranderlijk na uitgifte | value_text |
| currency |  | ISO 4217, default EUR | value_text |
| file | name, mime_type, size_bytes, storage_ref, expiry_date | Type/grootte-limieten (bestaat al in forms-engine ATTACHMENT_LIMITS); altijd object storage, nooit base64 inline; vervaldatum voor certificaten | value_text |
| image | file, exif_gps, taken_at | Als file, plus EXIF-GPS en tijdstip voor bewijswaarde; onwijzigbaar na upload | value_text |
| signature | signer_name, signed_at, bound_version, bound_hash, geo | Naam + tijdstip verplicht, gebonden aan documentversie (bestaat al in work-orders v2); onwijzigbaar na opslag | value_text |
| json |  | Gestructureerd object met schema per veld (tax_profile, opening_hours, contact_preferences) | value_text |
| rrule |  | iCalendar RRULE voor herhaling in planning | value_text |

## Gaps · prioriteit hoog (27)

| Soort | Entiteit / veld | Huidig | Voorgesteld type | Waarom het uitmaakt |
|---|---|---|---|---|
| VERKEERD_TYPE | customer (pg) . email | text zonder validatie (migrations/sql/002_crm.sql:17; src/platform/crm.js:70-71 controleert alleen includes('@')) | email | Foutieve adressen breken factuur- en reminderverzending zonder dat iemand het merkt. |
| VERKEERD_TYPE | customer (pg) . vat_number | text zonder checksum of landcode (migrations/sql/002_crm.sql:19) | vat_number | Een fout BTW-nummer betekent een geweigerde of onwettige factuur; de checksum vangt vrijwel elke typfout. |
| VERKEERD_TYPE | customer_contact (pg) . email | text zonder validatie; forms-command schrijft ongevalideerd door (migrations/sql/002_crm.sql:53; src/server.js:478-481) | email | Contact-e-mail is het kanaal voor offertes en portaaluitnodigingen; één typfout breekt de flow. |
| VERKEERD_TYPE | supplier . vatNumber | text zonder validatie; looksLikeBeVat bestaat enkel als import-warning (src/platform/procurement.js:53; src/platform/robaws-import.js:61) | vat_number | Leveranciersfacturen met fout BTW-nummer zijn fiscaal niet aftrekbaar. |
| VERKEERD_TYPE | supplier . iban | text zonder checksum, wel gemarkeerd als gevoelig veld (src/platform/procurement.js:56) | iban | Eén typfout in een leveranciers-IBAN betaalt naar de verkeerde rekening; de mod-97-controle vangt vrijwel alles en is de eerste verdediging tegen factuurfraude. |
| VERKEERD_TYPE | company (eigen onderneming) . vat | text zonder validatie (migrations/sql/001_core.sql:34) | vat_number | Dit nummer staat op elke uitgaande factuur van de tenant; een fout hier maakt alle facturen ongeldig. |
| VERKEERD_TYPE | company (eigen onderneming) . company_number | text zonder KBO-validatie (migrations/sql/001_core.sql:35) | enterprise_number | Het KBO-nummer is tegelijk het eigen Peppol-adres (schema 0208); zonder validatie kan e-facturatie niet betrouwbaar geactiveerd worden. |
| VERKEERD_TYPE | company (eigen onderneming) . iban | text zonder checksum (migrations/sql/001_core.sql:36) | iban | Een fout eigen IBAN op de factuur betekent dat klantbetalingen niet aankomen. |
| VERKEERD_TYPE | company (eigen onderneming) . peppol_id | text zonder scheme-validatie (migrations/sql/001_core.sql:37) | peppol_endpoint | Sinds 1/1/2026 is Peppol verplicht tussen Belgische BTW-plichtigen; een ongeldig endpoint blokkeert de hele e-facturatieflow. |
| VERKEERD_TYPE | workorder.worker . hourCode | vrije tekst, default 'normaal' (src/platform/work-orders.js:104) | enum/reference | Uurcodes sturen loonberekening en facturatietarief; vrije tekst maakt beide onbetrouwbaar. |
| VERKEERD_TYPE | forms-engine (alle formulieren h6-h24) . alle semantische spec-types | engineFieldType() degradeert Email/Phone/URL/Identifier/Address/Geo/Structured/Files naar 'text' (src/platform/field-dictionary.js:20-25) | volledig typeRegistry in de engine | De spec belooft per veld validatie (checksum, landcode, URL) maar de engine voert er geen enkele uit; dit ene punt raakt honderden formulier-velden tegelijk. |
| VERKEERD_TYPE | forms:customer . credit_limit (en alle Money-velden) | regex in engineFieldType herkent 'money' niet, bedrag belandt in value_text (src/platform/field-dictionary.js:22; src/platform/forms-engine.js:216-219) | money | Bedragen als tekst in de answer-index kun je niet optellen of filteren; financiële rapportage over formulieren is nu onmogelijk. |
| VERKEERD_TYPE | forms:supplier . bank_account | spec IBAN/BIC wordt engine text zonder validatie (src/platform/field-dictionary.json:2430) | iban + bic | De spec eist expliciet fraudecontrole bij wijziging van een bankrekening; die bestaat vandaag helemaal niet. |
| VERKEERD_TYPE | custom_field-definitie (alle 8 entiteiten) . type | slechts 6 types; onbekend type valt stil terug op text (src/platform/config-platform.js:20,33) | uitbreiden met het semantische typeRegistry | Tenants kunnen vandaag geen eigen e-mail-, IBAN- of adresveld aanmaken; alles wat ze toevoegen wordt platte tekst zonder controle. |
| VERKEERD_TYPE | workorder . photos | array van base64-strings inline in het state-document, max 5 x ~3MB (src/server.js:4395-4398) | image (object storage met metadata) | Megabytes binaire data in het state-document vergroten precies het deploy-overlap-risico dat eerder al tot dataverlies leidde. |
| ONGESTRUCTUREERD | customer (legacy) . contactName | volledige naam in 1 veld; backfill splitst heuristisch, laatste woord = achternaam (src/platform/crm.js:109; src/infrastructure/postgres/crm-backfill.js:28-33) | person_name (first_name + last_name) | De gok-splitsing verminkt Vlaamse namen als 'Van den Berg' blijvend tijdens de migratie naar Postgres. |
| ONGESTRUCTUREERD | customer (legacy) . address + zip + city | volledig adres in 1 regel plus losse zip/city (src/platform/crm.js:110-112) | address (composite) | Zonder gestructureerd adres kunnen routeplanning, de geo-prikklok en Peppol-facturatie niet werken. |
| ONGESTRUCTUREERD | customer_address (legacy) . line | volledig adres in 1 regel (src/platform/crm.js:48-53); pg-variant heeft wel street/number maar geen bus | address (composite) | De legacy-regel kan niet betrouwbaar naar de gestructureerde pg-kolommen gemigreerd worden. |
| ONGESTRUCTUREERD | worksite . address | één plat vrij veld zonder straat/nr-splitsing (src/platform/worksites.js:68-70) | address (composite) + geo | Werfadres stuurt navigatie, de geofence van de geo-prikklok en de Checkinatwork-melding; dat kan niet met één tekstregel. |
| ONGESTRUCTUREERD | invoice (klant-snapshot) . customerAddress | adres in 1 regel op de factuur (src/modules/customer-invoicing.js:63) | address (composite) | Peppol UBL vereist straat, postcode, gemeente en land als aparte velden (BT-35..BT-40); één regel blokkeert conforme e-facturen. |
| ONTBREEKT | customer (pg) . enterprise_number | kolom bestaat niet in migrations/sql/002_crm.sql; alleen het BTW-nummer is er | enterprise_number | Het KBO-nummer is het Peppol-adres van de klant (0208); zonder dit veld kan je niet-BTW-plichtige klanten niet via Peppol bereiken. |
| ONTBREEKT | customer . vat_regime / co_contractor_regime | nergens aanwezig; facturen kennen alleen een kaal BTW-nummer | enum (normaal, medecontractant, intracommunautair, export, vrijgesteld) | Medecontractant/BTW-verlegd is de standaard in B2B-bouw en verandert tarief én verplichte factuurvermelding; zonder dit veld is elke bouwfactuur handwerk. |
| ONTBREEKT | customer . peppol_endpoint + einvoicing_status | alleen de eigen onderneming heeft een peppol_id (001_core.sql:37); per klant is er niets | peppol_endpoint + enum (peppol, email_pdf, papier) | Sinds 1/1/2026 is Peppol verplicht tussen Belgische BTW-plichtigen; per klant moet vastliggen via welk kanaal de factuur vertrekt. |
| ONTBREEKT | invoice . structured_communication (OGM) | niet aanwezig op facturen (src/modules/customer-invoicing.js kent het veld niet) | structured_communication | De gestructureerde mededeling maakt automatische betaalmatching mogelijk; zonder blijft reconciliatie handwerk. |
| ONTBREEKT | invoice / factuurlijn . default_vat_rate + vat_6_declaration | geen tarievenlijst {0,6,12,21} en geen 6%-renovatieverklaring in het datamodel | percentage (gesloten lijst) + boolean | Het 6%-renovatietarief met verplichte factuurverklaring is dagelijkse kost in de bouw; het platform kan die vermelding nu niet afdrukken. |
| ONTBREEKT | medewerker (HR) . national_register_number (INSZ) | geen INSZ/rijksregisterveld in het medewerkersprofiel | national_id (versleuteld, apart leesrecht) | Het INSZ is de sleutel voor Dimona en Checkinatwork; zonder kan geen enkele wettelijke werfmelding gebeuren. |
| ONTBREEKT | worksite . work_declaration_30bis + ciaw_registered | geen 30bis-aangiftenummer of Checkinatwork-registratie op de werf | identifier + boolean | Aangifte van werken is verplicht boven de drempelbedragen en aanwezigheidsregistratie vanaf 500.000 EUR; concurrent DECA TIME heeft dit wel. |

## Gaps · prioriteit midden (25)

| Soort | Entiteit / veld | Huidig | Voorgesteld type | Waarom het uitmaakt |
|---|---|---|---|---|
| VERKEERD_TYPE | customer (pg) . phone | text zonder enige validatie (migrations/sql/002_crm.sql:18) | phone | Zonder E.164-normalisatie werken SMS-notificaties en klik-om-te-bellen niet betrouwbaar. |
| VERKEERD_TYPE | customer_contact (pg) . phone | text zonder validatie (migrations/sql/002_crm.sql:54) | phone | Werfcommunicatie loopt via mobiele nummers die nu elk formaat mogen hebben. |
| VERKEERD_TYPE | customer_address (pg) . postal_code | text zonder formaatvalidatie (migrations/sql/002_crm.sql:80) | postcode | Postcode is de sleutel voor regiotoewijzing en routeclustering; een ongeldig formaat breekt die stilletjes. |
| VERKEERD_TYPE | customer_address (legacy) . country | vrije tekst zonder 2-letter-check (src/platform/crm.js:56); pg-variant heeft de check wel | country | Peppol/UBL vereist een ISO-landcode; 'Belgie' als tekst faalt bij e-facturatie. |
| VERKEERD_TYPE | supplier . email | alleen includes('@')-check (src/platform/procurement.js:48-54) | email | Bestelbonnen naar een fout adres komen nooit aan. |
| VERKEERD_TYPE | invoice (klant-snapshot) . customerVatNumber | text zonder validatie (src/modules/customer-invoicing.js:64) | vat_number | Het snapshot op de factuur erft elke fout uit het klantrecord en is daarna onwijzigbaar. |
| VERKEERD_TYPE | customer (pg) . price_group | vrije tekst, geen FK naar prijslijst (migrations/sql/002_crm.sql:24) | reference | Een typfout in de prijsgroep laat een klant stil uit zijn prijsafspraken vallen. |
| VERKEERD_TYPE | workorder . priority | vrije tekst, nergens gevalideerd (src/server.js:5433) | enum | 'hoog', 'Hoog' en 'urgent' zijn nu drie verschillende prioriteiten in filters en rapportage. |
| VERKEERD_TYPE | workorder . billableStatus | enum-achtig zonder validatie (src/modules/workorder-rules.js:76; src/server.js:7772) | enum | Een verkeerd gespelde status betekent een werkbon die nooit in de facturatiewachtrij verschijnt: gemiste omzet. |
| VERKEERD_TYPE | worksite.party . contactEmail | alleen lowercased, geen validatie (src/platform/worksites.js:45) | email | Werfcontacten krijgen planningsmails die bij een typfout stil verdwijnen. |
| VERKEERD_TYPE | forms (alle enum-velden) . status, language, credit_status, risk_status e.a. | spec Enum wordt engine text zonder optielijst (src/platform/field-dictionary.json:573,633,643,713,2440) | enum met meegegeven optielijst | Elke willekeurige waarde wordt aanvaard in velden die de workflow moeten sturen. |
| ONGESTRUCTUREERD | customer_contact (legacy) . name | voor- en achternaam samen in 1 veld (src/platform/crm.js:32-44) | person_name | Sorteren, ontdubbelen en formele aanschrijving vereisen aparte naamvelden. |
| ONGESTRUCTUREERD | venue/locatie . address | 1 regel, placeholder 'Straat 1, 1000 Brussel' (public/js/platforms/admin.js:5557) | address (composite) | Locaties zijn het anker voor planning en navigatie; een tekstregel is niet geocodeerbaar. |
| ONGESTRUCTUREERD | project.party . contact | vrij veld met telefoon en e-mail door elkaar (src/platform/projects.js:72) | composite contact (person_name + email + phone) | Je kunt een projectpartij nu niet automatisch mailen of bellen omdat het kanaal niet identificeerbaar is. |
| ONGESTRUCTUREERD | customer / project / workorder . credit_limit, budgetAmount, billableAmount, hourlyRate | kale numerics zonder valutaveld (migrations/sql/002_crm.sql:22; src/platform/projects.js:114; src/modules/workorder-rules.js:85-92) | money (amount + currency) | UBL vereist een DocumentCurrencyCode en één buitenlandse klant maakt valutaloze bedragen dubbelzinnig. |
| ONGESTRUCTUREERD | venue/locatie . POST-endpoint (alle velden) | POST accepteert willekeurige body-velden via spread, geen whitelist (src/server.js:6528-6531) | gestructureerd schema met veldwhitelist | Elke client kan ongecontroleerde of gevoelige data in locatierecords opslaan die daarna overal meereist. |
| ONTBREEKT | customer_address (pg) . box_number (bus) | street + number bestaan, bus niet (migrations/sql/002_crm.sql:78-79) | text (subveld van address) | Belgische adressen vereisen een busnummer voor appartementen; zonder bus falen post en facturatie. |
| ONTBREEKT | customer_address (pg) . geo_coordinates | alleen worksite heeft geo (src/platform/worksites.js:73); klantadressen niet | geo | Routeplanning van klantbezoeken en nabijheidsdetectie hebben coördinaten nodig, geen tekstadres. |
| ONTBREEKT | company / tenant . currency + timezone | nergens een valuta- of tijdzoneveld (001_core.sql heeft ze niet) | currency + timezone | De spec verplicht beide en UBL vereist een DocumentCurrencyCode; nu is EUR en Europe/Brussels overal impliciet hardcoded. |
| ONTBREEKT | medewerker (HR) . joint_committee + wage_category | geen paritair comité of looncategorie in het profiel | enum (PC-lijst FOD WASO) + enum per PC | PC 124-barema's bepalen kostprijs en facturatietarief van elke gepresteerde werkuur. |
| ONTBREEKT | medewerker (HR) . certificates (VCA, medische schifting, rijbewijs) | geen certificatenstructuur met vervaldatum | file (composite met expiry_date) + multiselect | Een vervallen VCA of medische schifting hoort planning op de werf automatisch te blokkeren. |
| ONTBREEKT | medewerker (HR) . emergency_contact | geen noodcontactvelden | person_name + phone | Bij een werfongeval moet er onmiddellijk een noodcontact bereikbaar zijn; hoort ook in het werkongevallenregister. |
| ONTBREEKT | worksite . geofence_radius | geo bestaat (worksites.js:73) maar zonder straal | number (meters, 25-500) | De geplande geo-prikklok kan zonder geofence-straal niet bepalen of een inklok op de werf geldig is. |
| ONTBREEKT | customer_contact . marketing_optin + consent_timestamp | geen toestemmingsvelden op contacten | boolean + datetime (onwijzigbaar audit-log) | GDPR vereist aantoonbare toestemming voor marketingcommunicatie; zonder deze velden mag je contacten strikt genomen niet mailen voor commerciële doeleinden. |
| ONTBREEKT | lead/prospect . volledige entiteit (stage, estimated_value, next_action, loss_reason) | spec h9 eist een leadobject; het CRM-deel van de inventaris kent alleen klantstatus 'prospect' als vlag | entiteit met enum + money + date-velden uit het register | Zonder salespijplijn is er geen forecast en geen verliesanalyse; de klantstatus 'prospect' vervangt geen lead-flow. |

## Gaps · prioriteit laag (7)

| Soort | Entiteit / veld | Huidig | Voorgesteld type | Waarom het uitmaakt |
|---|---|---|---|---|
| VERKEERD_TYPE | supplier . phone | text zonder validatie (src/platform/procurement.js:55) | phone | Zelfde normalisatie als elk ander telefoonveld nodig voor consistentie. |
| VERKEERD_TYPE | project.party . role | vrije tekst, default partner (src/platform/projects.js:68) | enum | Worksite.party heeft wel een gevalideerde enum; dezelfde rol op project is vrije tekst, dus rapportage over partijen klopt niet. |
| VERKEERD_TYPE | worksite.party . contactPhone | geen validatie of normalisatie (src/platform/worksites.js:46) | phone | Techniekers moeten het werfcontact vanaf hun telefoon kunnen bellen. |
| ONGESTRUCTUREERD | venue/locatie . contactName | volledige naam in 1 veld (public/js/platforms/admin.js:5559) | person_name | Zelfde naamprobleem als bij klantcontacten. |
| ONTBREEKT | medewerker (HR) . employee_iban | geen rekeningnummer voor onkostenvergoedingen | iban | Terugbetalingen vereisen een gevalideerd rekeningnummer. |
| ONTBREEKT | customer_contact . salutation | geen aanspreektitel | enum | De aanhef in drietalige offertes en facturen kan nu niet correct gegenereerd worden. |
| ONTBREEKT | customer (financieel) . sepa_mandate (ref + date + type) | geen domiciliëringsvelden | identifier + date + enum {CORE,B2B} | SEPA-incasso voor terugkerende contracten vereist een mandaatreferentie op elke instructie. |

## As-is beeld per domein

### CRM: klanten, contactpersonen, leveranciers, adressen/locaties (99 velden)

AS-IS CRM-inventaris (klanten, contactpersonen, leveranciers, adressen/locaties). Het domein leeft in VIER uit elkaar gegroeide veldwerelden. (1) Genormaliseerde pg-tabellen customers/customer_contacts/customer_addresses (migrations/sql/002_crm.sql) zijn de harde waarheid: vrijwel alles is kale text; de enige DB-validaties zijn enum-CHECKs (language, status, adres-type), country length=2, credit_limit numeric(14,2) en payment_terms_days 0-365. E-mail, telefoon, BTW-nummer en postcode zijn overal ongevalideerde tekst; de enige JS-validatie op e-mail is includes("@") (src/platform/crm.js:71, src/platform/procurement.js:49). Een BE-BTW-regexcheck bestaat wel (looksLikeBeVat) maar alleen als warning in de Robaws-import (src/platform/robaws-import.js:61), niet in de CRUD-paden. (2) Het legacy platte store-record (src/platform/crm.js) draagt extra velden die pg NIET kent: type (company/individual), creditStatus (ok/watch/blocked), en de platte spiegel contactName/address/zip/city; omgekeerd kent legacy geen status/price_group/company_id. Adres is daar 1 tekstregel; de backfill splitst contactName heuristisch (laatste woord = achternaam, crm-backfill.js:28-33) en hermapt adrestypes billing/site/postal naar invoice/site/main (crm-backfill.js:24-25). (3) Leveranciers en locaties (venues) bestaan UITSLUITEND in de legacy store, zonder SQL-tabel of migratie: supplier heeft name/type/vatNumber/email/phone/iban/paymentTermsDays/notes (procurement.js:44-59) maar mist structureel adres, contactpersonen, BIC en valuta; de venue-POST accepteert bovendien willekeurige body-velden zonder whitelist (src/server.js:6529-6531). (4) De forms-spec dictionary (h8 klant, h16 leverancier) kent WEL rijke semantische types (Email, Phone, Identifier met checksum-intentie, Money, Address, Geo, IBAN/BIC, URL, Structured, Files, Sequence) maar engineFieldType() degradeert alles behalve number/date naar text (field-dictionary.js:20-25) en de answer-index bewaart het als value_text (forms-engine.js:216-219); opvallend: zelfs Money (credit_limit) matcht de regex niet en belandt als tekst in value_text. De forms-domeincommands (server.js:461-483) schrijven e-mail/telefoon/BTW-nummer eveneens ongevalideerd door naar de pg-kolommen. Custom fields bieden slechts 6 typen (config-platform.js:20) zonder enige semantische variant. Aanpalend: de eigen onderneming (companies, 001_core.sql:30-49) bewaart vat/company_number/iban/peppol_id als kale text, en facturen snapshotten klantadres en klant-BTW-nummer als platte tekst (customer-invoicing.js:63-64). Netto-gap: er bestaat vandaag nergens in dit domein een afgedwongen semantisch type voor email, phone, url, address, postcode, vat_number, enterprise_number, iban/bic, geo of money-met-valuta; 45+ van de geinventariseerde velden dragen zo'n semantiek maar zijn als ongevalideerde tekst opgeslagen (alle MISMATCH-flags).

### Projecten, werven (worksites), werkbonnen (workorders), planning (shifts/afspraken) en taken (128 velden)

AS-IS inventaris domein projecten/werven/werkbonnen/planning/taken (Monargo One). HARDE WAARHEID OPSLAG: dit hele domein heeft GEEN eigen SQL-tabellen · migrations/sql (001-010) bevat alleen tenants/companies/customers/users/jobs-queue/outbox/finance/forms/retention; projecten, worksites, workorders, shifts, appointments en tasks leven uitsluitend als JSON-documenten in de platform_state-store (collecties in src/lib/store.js:62-132). Elk veldtype is dus een JS-string/number/boolean/array zonder database-afdwinging. VALIDATIEBEELD: de canonieke repositories (src/platform/projects.js, worksites.js, work-orders.js, work-os.js) valideren enums, statemachines en ISO-datums netjes, maar drie schrijfpaden zijn schemaloos en omzeilen alles: POST /workorders (server.js:7745 `...body`), PATCH /workorders/:id (server.js:7789 `...body`) en PATCH /planning/:id (server.js:4735 `...body`) · elk willekeurig veld met elk type komt zo in de store. GROOTSTE SEMANTISCHE GATEN: (1) contactvelden op werfpartijen: contactEmail zonder e-mailvalidatie, contactPhone zonder telefoonvalidatie (worksites.js:45-46); afspraak-e-mail alleen "bevat @" (appointments.js:39-40); project-partij heeft één ongestructureerd "contact"-vrijveld. (2) Adres op de werf is één plat tekstveld + ongevalideerde zip (worksites.js:68-69) terwijl CRM-adressen in SQL wél gestructureerd zijn (002_crm.sql:73-92) · twee adresmodellen naast elkaar. (3) Alle geldvelden (budgetAmount, costRate/salesRate, unitPrice/costPrice, hourlyRate, billableAmount) zijn kale numbers zonder valuta of decimal-garantie. (4) Shift-datum/tijden worden alleen op aanwezigheid gecheckt; tijden vergelijken als strings (server.js:4666-4669). (5) Enum-als-vrije-tekst: workorder.priority, worker.hourCode, material.unit, task.type, project-partij.role, billableStatus. (6) Foto's uit het medewerker-portaal gaan als base64-strings ín het state-document (server.js:4395-4398). (7) Werkbon-formulierantwoorden worden ruw opgeslagen zonder typering (work-orders.js:167) · zelfde patroon als forms-engine answer-index. (8) Custom fields op project/workorder/worksite kennen slechts 6 generieke types (config-platform.js:20-23), dus geen semantisch e-mail/telefoon/IBAN/BTW/bedrag/adres-veld mogelijk. Verder valt op: denormalisatie-duo's overal (customerId+customerName, userId+userName, clientName) zonder consistentiebewaking, en legacy-seeds die project/klant als vrije NAAM op shifts zetten i.p.v. referentie (golden-path.js:80-81, demo-seed.js:131). Aangrenzend maar buiten scope gelaten: changeOrders, progressClaims, venues (gedeeld locatie-object, POST eveneens schemaloos via `...body`, server.js:6529-6531; draagt worksId/ciawWorksId voor CIAW).

### Offertes, facturen, betalingen, contracten, prijzen & billing (209 velden)

AS-IS inventaris financieel domein (offertes, facturen, betalingen, contracten, prijzen, billing) van Monargo One. Opslagbeeld: de legacy JSON-store is de bron; SQL (006_finance) is een strangler-spiegel voor invoices/invoice_lines/payments/payment_allocations met numeric(14,2)-bedragen, maar quotes, contracten, vorderingsstaten, artikelen, prijsregels en het hele abonnements-/reseller-domein leven uitsluitend als vrije JSON-objecten; superadmin-facturen en dunning zitten zelfs embedded in tenant.billingOps. Bedragen zijn overal netjes (round2/centen-rekening/numeric), maar bijna alle semantisch getypeerde identiteitsvelden zijn platte strings: btw-nummer, ondernemingsnummer, IBAN, e-mail, valuta, land en adres worden zonder validatie opgeslagen; de bestaande validators (mod-97 btw, OGM-check, IBAN-regex) draaien alleen op gebruiksmoment (Peppol-verzending) of alleen in het reseller-domein. Concrete pijnpunten: (1) customerAddress is EEN vrij tekstveld waardoor de UBL-factuur city/PostalZone leeg laat (peppol-invoice.js:148); (2) sleutel-mismatch in tenant.invoiceProfile: onboarding schrijft zip, Peppol leest postalCode, dus de leverancierspostcode komt nooit in de UBL; (3) quote.status wordt via PATCH ongefilterd overgenomen en invoices.status/currency hebben in SQL geen CHECK; (4) tenant.status kent in JS waarden (trial/past_due/canceled) die de SQL-CHECK verbiedt; (5) invoice.currency is de facto hardcoded EUR. Positieve uitzondering en mogelijke blauwdruk: het reseller-domein (reseller-domain.js RESELLER_FIELDS) heeft als enige een declaratief veldmodel met semantische types (iban, email, address, enum, identifier) plus echte validatie (IBAN_RE, EMAIL_RE, gestructureerd adresobject, vier-ogen op payout_account); ook forms field-dictionary.json declareert al types als IBAN die vervolgens door engineFieldType worden gedegradeerd. Circa 40 procent van de gerapporteerde velden draagt een MISMATCH-vlag; de dichtheid is het hoogst op de partij-/identiteitsvelden (btw, IBAN, adres, e-mail, valuta, land) die precies de Peppol/UBL-verplichte velden zijn.

### Medewerkers, HR, tijdsregistratie/prikklok, verlof, sociaal secretariaat (Dimona/RSZ/CIAW/A1-Limosa/werkongevallen) (132 velden)

AS-IS HR-domein Monargo One. Structurele bevindingen: (1) Er bestaat GEEN enkele SQL-tabel voor dit domein - employees, clocks, leaves, incidents en postedWorkers leven uitsluitend als json-objecten in de platform_state-store; alleen users heeft een pg-spiegel (migrations/sql/005_identity.sql, met alle HR-velden verbatim in een attributes-jsonb) en formulierantwoorden landen in form_answers/form_answer_index (008_forms.sql: enkel value_text/value_num/value_date). Alle validatie is dus JS-code, geen schema. (2) Het domein heeft TWEE parallelle medewerker-entiteiten: users (loginaccount; wordt door prikklok, verlof, verlofsaldo, payroll-export en CIAW als "de medewerker" gebruikt) en employees (personeelsfiche h16, optionele userId-koppeling). Het INSZ staat op beide met verschillende strengheid: employees.insz is mod-97-gevalideerd, users.nationalId alleen cijfer-gestript (checksum pas bij export/CIAW); social-secretariat.js probeert drie aliassen (insz || nationalNumber || nationalId). (3) Grootste gaten: user.iban en user.address zijn door de medewerker zelf via /api/me in te vullen als volledig ongevalideerde vrije tekst (server.js:4283-4293); de employees-PATCH-route (server.js:7276-7302) spreidt willekeurige body-velden rauw het user-record in (zo komt o.a. leaveQuota binnen); e-mail kent nergens formaatvalidatie behalve position('@') in SQL. (4) Enum-achtige waarden zonder beheerd vocabularium: hourCode ("normaal", op zowel personeelsfiche als werkbon-workers), driverLicense, skills-keys, planningGroups; teamId verwijst naar een collectie die niet bestaat. (5) Namen zijn overal één vrij tekstveld (employee.name, user.name, incident.employeeName+witnesses, postedWorker.workerName) terwijl de eigen spec-dictionary h7 first_name/last_name eist. (6) Bestanden: A1-attest wordt als base64-data-URL in de json-state bewaard; certificaat-"documentRef" is een vrije string zonder echte bestandskoppeling. (7) Forms-engine-degradatie bevestigd voor dit domein: engineFieldType() (field-dictionary.js:20-25) plet Email/Phone/IBAN/Address/Country/Identifier/Enum/Reference naar "text"; "Money/date range" (cost_rate) matcht zelfs op "date" en "Money" (amount_currency) valt op text - geldvelden zijn in de answer-index dus niet numeriek aggregeerbaar. Special-category-gegevens (INSZ, medical_restrictions, ziekte-reden op leaves.reason) staan onversleuteld als platte tekst. Goed geregeld daarentegen: datumgebonden kosttarieven met historiekbescherming, Dimona/statusmachine/verloftype-enums met echte validatie, prikklok-pauzes en tijden strak op HH:MM-patroon, INSZ-mod-97 op de personeelsfiche. Custom fields (config-platform.js SUPPORTED_ENTITIES) dekken employee NIET - de personeelsfiche is dus niet uitbreidbaar zonder code.

### Assets, onderhoud, voorraad, artikelen, inkoop (incl. wagenpark, leveranciers, prijslijsten, eenheden) (197 velden)

AS-IS inventaris domein Assets/onderhoud/voorraad/artikelen/inkoop. Opslagfundament: voor dit hele domein bestaan GEEN SQL-tabellen; migrations/sql dekt enkel core/crm/jobs/identity/finance/forms/metadata. Alle domein-entiteiten (assets, maintenancePlans, vehicles, mileageLogs, stock, stockMutations, articles, priceRules, suppliers, purchaseOrders, stockMovements, stockReservations) leven als JSON-records in de platform_state-store; types zijn dus uitsluitend JS-runtime-conventies, geen databank-types. Belangrijkste bevindingen: (1) Er draaien TWEE parallelle voorraadsystemen: de eenvoudige stock-module (src/modules/stock.js, veldnamen qty/minQty, mutatietypes in het NL) en de inventory-ledger (src/platform/inventory.js, immutable movements, EN-types), met elk eigen veldvocabulaire; artikelen van de catalogus (src/platform/catalog.js) koppelen alleen aan de ledger. (2) Seed/import-drift: demo-seed.js:172 en robaws-import.js:141-150 schrijven stock-rijen met quantity/minQuantity/unitPrice terwijl de module qty/minQty leest en unitPrice nergens kent; gevolg: geseedete/geimporteerde rijen triggeren geen lage-voorraad-alerts. (3) Leverancier is het zwaarst getroffen door ontbrekende semantische types: vatNumber, phone en iban zijn kale strings zonder enige validatie en email kent enkel een bevat-'@'-check; het IBAN-veld is nota bene in de code als gevoelig (h8.2) gemarkeerd. (4) purchaseOrder.deliveryAddress is één vrij tekstveld (geen gestructureerd adres); stockItem.supplier is een vrije tekstnaam zonder koppeling aan de suppliers-collectie. (5) Eenheden zijn overal vrije tekst (article.unit, stockItem.unit, purchaseOrderLine.unit) ondanks dat de spec-dictionary een gecontroleerde ISO-lijst vraagt; prijsgroepen (priceRule.priceGroup) en artikelgroepen zijn eveneens vrije strings zonder entiteit. (6) Geldbedragen zijn overal kale JS-numbers (round2) zonder valuta. (7) Custom fields zijn beschikbaar op asset en supplier maar beperkt tot de zes generieke types uit config-platform.js:20 (text/number/date/boolean/select/multiselect), dus geen email/iban/btw/money mogelijk. (8) Forms-degradatie concreet aangetoond in dit domein: engineFieldType (field-dictionary.js:20-25) kent 'money' niet, waardoor spec-type 'Money' (unit_cost_snapshot) als TEXT wordt geindexeerd en 'Money/date range' (sales_price, cost_price) zelfs als DATE; IBAN/BIC, Identifier, Address, Enum, Reference, Files en Structured degraderen allemaal naar text met String(val)-index (forms-engine answer-index). (9) Vestigiaal: collectie stockLocations wordt in server.js:5256 gelezen voor naamverrijking maar heeft geen aanmaakroute. (10) UI vraagt beduidend minder uit dan het model toelaat: de artikel-editor (admin-domains.js:170-227) toont slechts 6 van de ~30 artikelvelden (name/type/unit/costPrice/salesPrice/vatRate); barcode, altUnits, supplierRefs, samenstelling, voorraadparameters en boekhoudrekeningen zijn API-only. Velden met vlag MISMATCH: 58 van de 172 gerapporteerde velden.

### Formulierenengine: velddictionary, seeds en tenant/identity/instellingen (491 velden)

AS-IS inventaris van 491 informatievelden: 403 uit de normatieve velddictionary (src/platform/field-dictionary.json, 19 hoofdstukken h6-h24) die via structureFor() de 35 geseede standaardformulieren voedt (forms-catalog.js: 25 CORE + 10 RES; seeding in pg-forms-repository.js:554-565), plus 88 velden uit SQL-migraties en JS voor tenant, company, user/identity, instellingen, custom-fields-platform en het canonieke forms-datamodel. KERNBEVINDINGEN: (1) De dictionary kent ruim 100 semantische spec-types (Email, Phone, IBAN, Address, Money, Identifier, Geo, Signature, ISO currency, ...), maar engineFieldType() in src/platform/field-dictionary.js:20-25 degradeert ALLES naar drie typen (text|number|date); form_fields.field_type is vrije tekst zonder CHECK (008_forms.sql:110); antwoorden landen in form_answers.value_json (jsonb) en de reporting-index kent enkel value_text/value_num/value_date (008_forms.sql:222-224). buildAnswerIndex (forms-engine.js:208-223) indexeert objecten als String(val), dus composieten worden "[object Object]". (2) De degradatie-regex matcht samengestelde spec-types fout: "Money" valt naar text; "Date/Money", "Money/date range" en "Date range/money" indexeren als date (bedrag weg); "Datetime/integer" indexeert als number. (3) Het runtime-validatievocabulaire is alleen required/maxLength/pattern/min/max/enum (forms-engine.js:183-205); er bestaan geen e-mail-, telefoon-, IBAN-, BTW/KBO- of adresvalidators, en structureFor() zet op geseede velden geen enkele validation, dus ook enums zijn effectief vrije tekst. (4) Het custom-fields-platform (config-platform.js:20) kent exact 6 typen (text,number,date,boolean,select,multiselect): elke e-mail/telefoon/IBAN/adres als extra veld wordt gedwongen platte text. (5) Tenant/company/identity: BTW-nummer (companies.vat, tenant.invoiceProfile.vat, tenant.vatNumber), KBO-nummer, IBAN (companies.iban), billing_email, telefoon en adres zijn overal platte tekst zonder validatie (enige uitzonderingen: users.email heeft een CHECK + registratie-regex, en de KBO-lookup verrijkt eenmalig bij registratie); tenants.status-CHECK (active|suspended|archived) mist de waarde 'trial' die de JS-registratie wel schrijft; users.role is vrije tekst zonder rollenlijst. 176 van 491 velden dragen de vlag MISMATCH. Conventies in deze lijst: entity "form:<domein>" = veld zoals uitgevraagd door de geseede formulieren (opslag form_answers.value_json + answer-index), currentType "jsonb->text|number|date" = het effectieve engine-/indextype; ISO-datetimes in de legacy-JSON-store en references/ids/json zonder rijker doeltype zijn bewust NIET geflagd om ruis te vermijden. Pure techniekkolommen (id, tenant_id, created_at, fingerprint, snapshot, password_hash, security-jsonb) zijn overgeslagen.

## Normatieve spec · gedekte hoofdstukken

- 1. Doel, scope en ontwerpprincipes (geen veldtabel; ontwerpprincipes)
- 2. Formuliertypes en activatiemodel (geen veldtabel; formuliertypes, activatielagen, statusmodel)
- 3. Rechtenmodel en veldbeveiliging (geen veldtabel; rechtgroepen incl. veldniveau-rechten zoals field.cost_price.view, field.salary.view, field.medical.view, field.bank_account.view, field.security_secret.view)
- 4. Generieke formulierengine en datamodel (geen veldtabel; engine-architectuur en typed answer index)
- 5. Universele metadata voor alle objecten (14 velden)
- 6. Tenant, onderneming en onboarding (22 velden)
- 7. Gebruiker, medewerker, team en HR (30 velden)
- 8. Klant, contactpersoon, adres en locatie (31 velden)
- 9. Lead, prospect en sales (15 velden)
- 10. Offerte, contract en digitale acceptatie (21 velden)
- 11. Project, werf en projectfinanciën (23 velden)
- 12. Planning, afspraak, shift en beschikbaarheid (16 velden)
- 13. Werkbon, uitvoering en service (21 velden)
- 14. Tijdregistratie, verlof en onkosten (20 velden)
- 15. Factuur, betaling en financiële goedkeuringen (19 velden)
- 16. Leverancier, aankoop en ontvangst (19 velden)
- 17. Artikel, voorraad en materiaal (18 velden)
- 18. Asset, installatie, voertuig en onderhoud (19 velden)
- 19. Compliance, veiligheid en sociaal-juridische informatie (16 velden)
- 20. Support, klachten en klantportaal (15 velden)
- 21. Security, privacy en governance (17 velden)
- 22. Integraties, API-sleutels en webhooks (16 velden)
- 23. Reseller, partnerkanaal en commissiebeheer (110 entries: 36 basisvelden 23.2 + 42 aanvullende velden 23.7 + 13 dealvelden 23.8 + 7 aanvraagsecties 23.9 + 6 licentierecords 23.10 + 6 commissierecords 23.11)
- 24. Documenten, bestanden en handtekeningen (16 velden)
- 25. Standaardformulieren bij livegang (geen veldtabel; catalogus 33 standaardformulieren CORE/CRM/SAL/PRJ/OPS/HR/EXP/FIN/PUR/STK/AST/CMP/SUP/PRV/SEC/RES-001..010 met default activatie)
- 26. Workflow-, notificatie- en rapporteringsregels (geen veldtabel; o.a. reportingAllowed en aiAllowed per veld vereist)
- 27. API, audit, retentie en migratie (geen veldtabel; minimumvereisten per onderdeel)
- 28. Implementatiefases, takenpakket en Definition of Done (geen veldtabel; fases F1-F6, werkstromen FORM-01..18, DoD)

## Marktbenchmark · categorieën

### organisatie_klant

| Veld | Type | BE-specifiek | Validatie | Waarom |
|---|---|---|---|---|
| legal_name | company_name | nee | verplicht, niet leeg; idealiter gevalideerd tegen KBO Public Search | Officiële naam zoals ingeschreven in de KBO is verplicht op contracten en facturen (Peppol BT-27). |
| trade_name | company_name | nee | optioneel; fallback naar legal_name | Handelsnaam wijkt vaak af van de juridische naam en is wat gebruikers herkennen in zoeken en planning. |
| enterprise_number | enterprise_number | ja | 10 cijfers beginnend met 0 of 1; mod-97: laatste 2 cijfers = 97 - (eerste 8 cijfers mod 97); optioneel live KBO-lookup | Uniek KBO-ondernemingsnummer identificeert de onderneming ondubbelzinnig en dient als Peppol-adres (schema 0208). |
| vat_number | vat_number | nee | EU-formaat per land; BE = 'BE' + 10 cijfers (identiek aan ondernemingsnummer, zelfde mod-97); VIES-check op geldigheid | BTW-nummer met landprefix is verplicht op facturen en nodig voor VIES-controle bij intracommunautaire handel. |
| vat_liable | boolean | nee | default true; indien true is vat_number verplicht | Niet-BTW-plichtige klanten (particulieren, sommige vzw's) vereisen een ander factuurregime en blokkeren medecontractant. |
| legal_form | enum | ja | gesloten lijst met Belgische rechtsvormen uit de KBO | Rechtsvorm (BV, NV, VZW, eenmanszaak, VOF, CommV) bepaalt aansprakelijkheid en verplichte factuurvermeldingen. |
| billing_address | address | nee | gestructureerd adres; land verplicht als ISO 3166-1 alpha-2 | Facturatieadres is verplicht in Peppol UBL (BT-35..BT-40) en wijkt geregeld af van het vestigingsadres. |
| visiting_address | address | nee | gestructureerd adres, geocodeerbaar | Vestigings-/werkadres stuurt routeplanning, technicus-toewijzing en werf-koppeling. |
| invoice_language | language | nee | ISO 639-1 uit {nl,fr,en,de} | In drietalig België moet de factuur- en communicatietaal per klant vastliggen, niet per tenant. |
| currency | currency | nee | ISO 4217, default EUR | Vrijwel altijd EUR, maar DocumentCurrencyCode is verplicht in UBL en nodig voor buitenlandse klanten. |
| payment_term_days | integer | nee | geheel getal >= 0; BE B2B wettelijk maximum 60 dagen (wet betalingsachterstand) | Betaaltermijn bepaalt de vervaldatum en de dunning-flow. |
| payment_conditions | longtext | nee | vrije tekst, per taal vertaalbaar | Afwijkende voorwaarden (korting contant, voorschotregeling) moeten letterlijk op de factuur kunnen verschijnen. |
| payment_method | enum | nee | gesloten lijst {overschrijving, sepa_dd, kaart, cash} | Overschrijving, SEPA-domiciliëring of kaart bepaalt de incasso- en reconciliatieflow. |
| nace_code | text | ja | code uit de NACE-BEL 2025-lijst, formaat 99.999 | NACE-BEL-code segmenteert klanten per sector en bepaalt sectorregels (bouw = 41-43). |
| website | url | nee | geldige http(s)-URL | Snelle context voor sales en support. |
| general_email | email | nee | RFC 5322-syntax; MX-check optioneel | Algemeen kanaal voor communicatie en documentverzending. |
| invoice_email | email | nee | RFC 5322; fallback naar general_email | Apart facturatieadres is nodig als Peppol-fallback en voor aanmaningen. |
| phone_main | phone | nee | E.164-normalisatie (+32...) | Telefonisch contact voor planning en spoedinterventies. |
| peppol_endpoint | id | ja | formaat 'scheme:waarde', BE gangbaar 0208:ondernemingsnummer; bereikbaarheid via SMP-lookup | Elektronisch adres bepaalt of je via Peppol kunt factureren; sinds 1/1/2026 is gestructureerde e-facturatie tussen Belgische BTW-plichtigen verplicht. |
| customer_number | id | nee | uniek per tenant, onveranderlijk na aanmaak | Intern uniek klantnummer is de basis voor referenties en de opbouw van gestructureerde mededelingen. |
| credit_limit | money | nee | >= 0, in klantvaluta | Kredietlimiet laat toe nieuwe orders te blokkeren bij te hoog openstaand saldo. |
| co_contractor_regime | boolean | ja | alleen toegestaan als klant BTW-plichtig is met geldig BE-BTW-nummer | Medecontractant/BTW-verlegd (KB nr. 1, art. 20) is de standaard in B2B-bouw en verandert de volledige factuurlogica. |
| account_manager | reference | nee | verwijzing naar actieve gebruiker binnen de tenant | Eigenaarschap per klant stuurt opvolging en rapportage. |
| customer_status | enum | nee | gesloten statuslijst met overgangsregels | Prospect/actief/geblokkeerd/gearchiveerd stuurt welke acties (offerte, order, facturatie) toegelaten zijn. |

### persoon_contact

| Veld | Type | BE-specifiek | Validatie | Waarom |
|---|---|---|---|---|
| first_name | person_name | nee | niet leeg; geen gecombineerd naamveld | Apart voornaamveld is nodig voor personalisatie, sortering en correcte aanschrijving. |
| last_name | person_name | nee | niet leeg | Achternaam apart maakt sorteren, ontdubbelen en formele aanschrijving mogelijk. |
| salutation | enum | nee | gesloten lijst {dhr, mevr, geen, dr, ir}, per taal gerenderd | Aanspreektitel stuurt de aanhef in offertes, facturen en mails. |
| job_title | text | nee | vrije tekst | Functie geeft context bij wie je aan tafel zit (zaakvoerder, werfleider, boekhouder). |
| contact_role | multienum | nee | gesloten lijst, meerdere rollen mogelijk | Rol bij de klant (facturatie, werfcontact, beslisser) routeert documenten en meldingen naar de juiste persoon. |
| contact_email | email | nee | RFC 5322; uniek binnen de klant aanbevolen | Persoonlijk e-mailadres is het primaire kanaal voor offertes, werkbonnen en portaaluitnodigingen. |
| mobile_phone | phone | nee | E.164; mobiel-prefixcontrole per land optioneel | Mobiel nummer is het kanaal voor SMS-notificaties en werfcommunicatie. |
| landline_phone | phone | nee | E.164 | Vast nummer blijft relevant voor administratieve contacten. |
| language_preference | language | nee | ISO 639-1 uit {nl,fr,en,de}; fallback naar organisatietaal | Taalvoorkeur per persoon kan afwijken van de organisatietaal (FR-boekhouder bij NL-bedrijf). |
| marketing_optin | boolean | nee | default false; wijziging altijd gelogd | GDPR art. 7 vereist expliciete, aantoonbare toestemming voor marketingcommunicatie. |
| consent_timestamp | datetime | nee | verplicht zodra marketing_optin true; onwijzigbaar audit-log | Bewijs van wanneer en hoe toestemming werd gegeven is de kern van GDPR-accountability. |
| is_primary | boolean | nee | maximaal één primair contact per klant | Eén hoofdcontact per klant stuurt standaard-adressering van documenten. |
| contact_active | boolean | nee | inactieve contacten uitgesloten van mailings | Vertrokken contactpersonen deactiveren voorkomt datalekken en houdt data juist (GDPR juistheidsbeginsel). |

### adres

| Veld | Type | BE-specifiek | Validatie | Waarom |
|---|---|---|---|---|
| street | text | nee | niet leeg bij gestructureerd adres | Losse tekstadressen falen voor routeplanning, geo-klok en Peppol; de straat apart is de basis van structurering. |
| house_number | text | nee | alfanumeriek (12, 12A) | Huisnummer apart is nodig voor geocoding-precisie en BeSt Address-matching. |
| box_number | text | ja | optioneel, alfanumeriek, apart van huisnummer | Belgische adressen vereisen een busnummer voor appartementen en units; zonder bus faalt post en facturatie. |
| postcode | postcode | nee | per land patroon; BE = ^[1-9][0-9]{3}$ | Postcode is de sleutel voor regiotoewijzing, tarieven en routeclustering. |
| municipality | text | nee | niet leeg; idealiter uit BeSt Address-gemeentelijst | Officiële gemeentenaam is verplicht in UBL; taalgrensgemeenten hebben een NL- en FR-variant. |
| country | country | nee | ISO 3166-1 alpha-2, default BE | Landcode is verplicht in UBL/Peppol en stuurt BTW-logica (intracommunautair vs. binnenlands). |
| geo_coordinates | geo | nee | WGS84; lat -90..90, lng -180..180; bron vastleggen (geocoder vs. handmatig) | Lat/lng maakt routeplanning, geofencing voor de prikklok en werf-nabijheidsdetectie mogelijk; tekstadressen kunnen dit niet. |
| address_type | enum | nee | gesloten lijst {facturatie, vestiging, werf, levering, correspondentie} | Facturatie-, vestigings-, werf- en leveringsadres hebben elk een andere rol in de flows. |
| best_address_id | id | ja | BeSt-ID (URI-formaat) uit het gewestelijke adressenregister | Koppeling aan het officiële Belgische BeSt Address-register maakt adressen uniek, valideerbaar en updatebaar. |

### financieel

| Veld | Type | BE-specifiek | Validatie | Waarom |
|---|---|---|---|---|
| iban | iban | nee | ISO 13616 mod-97-controle (rest = 1); BE-IBAN = 16 tekens | IBAN is nodig voor uitbetalingen, domiciliëring en het matchen van inkomende betalingen. |
| bic | bic | nee | ISO 9362, 8 of 11 tekens; consistent met IBAN-landcode | BIC blijft vereist voor niet-SEPA-verkeer en sommige bankkoppelingen. |
| account_holder | text | nee | niet leeg bij ingevuld IBAN | Tenaamstelling controleren tegen de klantnaam beschermt tegen factuurfraude. |
| sepa_mandate_ref | id | nee | max 35 tekens, uniek per schuldeiser (SEPA-rulebook) | SEPA-domiciliëring vereist een mandaatreferentie op elke incasso-instructie. |
| sepa_mandate_date | date | nee | verplicht bij sepa_mandate_ref; niet in de toekomst | Ondertekeningsdatum van het mandaat is verplicht in elk incassobestand. |
| sepa_mandate_type | enum | nee | gesloten lijst {CORE, B2B} | CORE vs. B2B-mandaat bepaalt terugboekingsrechten en bankverwerking. |
| structured_communication | id | ja | 12 cijfers; laatste 2 = (eerste 10 mod 97), rest 0 wordt 97 | De Belgische gestructureerde mededeling (OGM, +++123/4567/89002+++) maakt automatische betaalmatching mogelijk. |
| vat_regime | enum | ja | gesloten lijst; per regime de wettelijke vermelding automatisch op de factuur | BTW-regime (normaal, medecontractant/verlegd, intracommunautair, export, vrijgesteld) bepaalt tarief én verplichte factuurvermelding. |
| default_vat_rate | percentage | ja | waarde uit {0, 6, 12, 21} | Belgische tarieven 0/6/12/21 met 6% voor renovatie van woningen ouder dan 10 jaar zijn dagelijkse kost in de bouw. |
| vat_6_declaration | boolean | ja | alleen combineerbaar met tarief 6% en particuliere woning >10 jaar | Sinds 2022 vervangt de standaardverklaring op de factuur het attest voor het 6%-renovatietarief; het platform moet die vermelding kunnen afdrukken. |
| peppol_buyer_reference | text | nee | verplicht indien geen order_reference aanwezig | Peppol BIS 3.0 vereist BuyerReference (BT-10) of een orderreferentie; overheidsplatform Mercurius weigert facturen zonder. |
| order_reference | text | nee | vrije tekst, max 1 per factuur | Orderreferentie van de klant (BT-13) koppelt de factuur aan diens bestelling en versnelt goedkeuring. |
| einvoicing_status | enum | ja | gesloten lijst {peppol, email_pdf, papier}; peppol vereist geldig peppol_endpoint | Sinds 1/1/2026 is gestructureerde e-facturatie via Peppol verplicht tussen Belgische BTW-plichtigen; per klant moet het kanaal vastliggen. |

### medewerker_hr

| Veld | Type | BE-specifiek | Validatie | Waarom |
|---|---|---|---|---|
| national_register_number | id | ja | 11 cijfers; mod-97: controlegetal = 97 - (eerste 9 cijfers mod 97), voor geboren >= 2000 eerst 2000000000 optellen; versleuteld opslaan, apart leesrecht, volledige audit | Rijksregisternummer/INSZ is de sleutel voor Dimona en Checkinatwork, maar is een gevoelig gegeven met wettelijke doelbinding. |
| bis_number | id | ja | zelfde mod-97 als rijksregisternummer; maandcijfer +20 of +40 | BIS-nummer is het INSZ-equivalent voor niet-ingezetenen (buitenlandse arbeiders) zonder rijksregisternummer. |
| date_of_birth | date | nee | in het verleden; consistent met INSZ indien aanwezig | Geboortedatum is nodig voor Dimona en leeftijdsgebonden regels (studentenarbeid, barema's). |
| nationality | country | nee | ISO 3166-1 alpha-2 | Nationaliteit bepaalt of A1, Limosa of een single permit vereist is voor werfwerk. |
| contract_type | enum | ja | gesloten lijst met het Belgische arbeider/bediende-onderscheid | Arbeider/bediende plus contractvorm (onbepaald, bepaald, uitzend, student, flexi) bepaalt loon, opzeg en RSZ-behandeling. |
| joint_committee | enum | ja | code uit de officiële PC-lijst van de FOD WASO | Het paritair comité (PC 124 bouw, 111 metaal, 149.01 elektriciens) bepaalt barema's, premies en sectorverplichtingen. |
| wage_category | enum | ja | categorielijst afhankelijk van joint_committee; alleen zichtbaar met costs.view-recht | Looncategorie binnen het PC (bv. PC 124 cat I-IV) stuurt kostprijsberekening en facturatietarief. |
| dimona_period_id | id | ja | Dimona-periodenummer; aanwezig vóór startdatum tewerkstelling | Bewijs van Dimona-aangifte bij de RSZ vóór de eerste werkdag is een wettelijke werkgeversverplichting. |
| ciaw_registered | boolean | ja | vereist INSZ of Limosa-nummer; per werf en per dag registreerbaar | Checkinatwork-aanwezigheidsregistratie is verplicht op werven vanaf 500.000 EUR en koppelt idealiter aan de prikklok. |
| construbadge_id | id | ja | uniek badgenummer; koppeling aan actieve tewerkstelling | De ConstruBadge identificeert arbeiders visueel op de werf en is via PC 124 verplicht in de bouw. |
| limosa_number | id | ja | Limosa-1-nummer plus geldigheidsperiode; verplicht voor gedetacheerde buitenlandse werknemers | Buitenlandse werkgevers moeten detachering naar België vooraf melden via Limosa; het L1-bewijs moet op de werf toonbaar zijn. |
| a1_document | file | nee | bestand plus vervaldatum verplicht; expiratie blokkeert planning op de werf | Het A1-attest bewijst sociale-zekerheidsdekking in het thuisland bij detachering (EU-verordening 883/2004). |
| work_accident_policy | id | ja | polisnummer plus verzekeraar, verplicht ingevuld per werkgever | De arbeidsongevallenverzekering is wettelijk verplicht en het polisnummer hoort in het werkongevallenregister. |
| vca_certificate | file | ja | type {basis, VOL, VIL} + certificaatnummer + vervaldatum; check in het BeSaCC-VCA-register | VCA (basis of VOL) is de de-facto toegangseis op bouwwerven en verloopt na 10 jaar. |
| driving_license | multienum | nee | categorielijst plus vervaldatum per categorie | Rijbewijscategorieën (B, BE, C1, C, CE) bepalen wie welk voertuig of welke machine mag besturen. |
| medical_fitness_expiry | date | ja | vervaldatum; maximaal 5 jaar geldig; verval blokkeert inzet als chauffeur | De medische schifting is verplicht voor rijbewijs C/D en moet actief bewaakt worden op vervaldatum. |
| single_permit | file | ja | documenttype + vervaldatum; verplicht bij nationaliteit buiten EU/EER | Niet-EU-werknemers hebben een gecombineerde vergunning (arbeid + verblijf) nodig; verval moet planning blokkeren. |
| employee_iban | iban | nee | ISO 13616 mod-97 | Loonuitbetaling vereist een gevalideerd rekeningnummer van de medewerker. |
| emergency_contact_name | person_name | nee | niet leeg samen met emergency_contact_phone | Bij een werfongeval moet er onmiddellijk een noodcontact bereikbaar zijn. |
| emergency_contact_phone | phone | nee | E.164 | Telefoonnummer van het noodcontact hoort bij het werkongevallenregister en de werfmap. |
| badge_id | id | nee | uniek per tenant; intrekbaar | QR/NFC-badge identificeert de medewerker aan de prikklok en bij werftoegang. |

### field_service

| Veld | Type | BE-specifiek | Validatie | Waarom |
|---|---|---|---|---|
| site_name | text | nee | niet leeg, uniek binnen klant aanbevolen | Herkenbare werfnaam is de ankertekst in planning, prikklok en werkbonnen. |
| site_address | address | nee | gestructureerd + geocodeerbaar | Gestructureerd werfadres stuurt navigatie, CIAW-melding en facturatie per werf. |
| site_geo | geo | nee | WGS84; verplicht wanneer geo-klok actief is | Geocoördinaten van de werf zijn het middelpunt van de geofence voor de geo-prikklok. |
| geofence_radius | number | nee | meters, bereik 25-500, default per tenant | De straal bepaalt binnen welke afstand in- en uitklokken op de werf geldig is. |
| work_declaration_30bis | id | ja | RSZ-aangiftenummer; verplicht boven de drempelbedragen; aanwezigheidsregistratie vanaf 500.000 EUR | De aangifte van werken (art. 30bis RSZ) is verplicht vanaf 30.000 EUR (5.000 EUR met onderaannemer) en het nummer is nodig voor Checkinatwork. |
| access_instructions | longtext | nee | vrije tekst; gevoelige codes afschermen per rol | Sleutels, poortcodes en parkeerinfo besparen techniekers tijd en telefoontjes. |
| onsite_contact | reference | nee | verwijzing naar contact van de klant met telefoonnummer | De contactpersoon ter plaatse met telefoonnummer is nodig voor aankomstmelding en toegang. |
| safety_instructions | longtext | nee | vrije tekst, tonen vóór eerste inklok op de werf | Werfspecifieke risico's en instructies zijn een verplichting onder de welzijnswet en VCA. |
| required_ppe | multienum | nee | gesloten PBM-lijst, uitbreidbaar per tenant | Verplichte PBM's per werf (helm, S3-schoenen, harnas) afvinkbaar maken ondersteunt de veiligheidsflow. |
| asset_serial_number | id | nee | uniek per merk+model; exact-match zoekbaar | Serienummer identificeert het toestel uniek voor historiek, garantie en terugroepacties. |
| asset_gtin | id | nee | GS1-controlecijfer (mod-10), 8/12/13/14 cijfers | EAN/GTIN koppelt het asset aan de artikelcatalogus en leveranciersdata. |
| asset_qr | id | nee | uniek per tenant; onherbruikbaar na verwijdering | QR-code op het toestel opent in het veld direct de juiste asset met historiek. |
| installation_date | date | nee | niet in de toekomst | Installatiedatum start garantie- en onderhoudstermijnen. |
| warranty_end | date | nee | >= installation_date | Garantie-einddatum bepaalt of een interventie facturabel is. |
| meter_reading | number | nee | >= vorige meting (tenzij vervangen teller); eenheid en datetime verplicht | Meterstanden (draaiuren, kWh, tellerstand) met eenheid en tijdstip sturen preventief onderhoud. |
| work_photo | image | nee | EXIF-GPS + datetime aanwezig of client-side toegevoegd; onwijzigbaar na upload | Foto met GPS en timestamp in de EXIF is het bewijsstuk bij discussies en oplevering. |
| customer_signature | signature | nee | naam ondertekenaar + datetime + optioneel geo vastleggen; onwijzigbaar na opslag | Digitale handtekening op de werkbon met naam en tijdstip maakt de bon rechtsgeldig afgetekend. |
| travel_time | duration | nee | >= 0; apart van werktijd | Aanrijtijd apart registreren is nodig voor facturatie en de mobiliteitsvergoeding in de bouw. |

### saas_platform

| Veld | Type | BE-specifiek | Validatie | Waarom |
|---|---|---|---|---|
| tenant_id | id | nee | UUID v4, onveranderlijk | Onvervalsbare tenant-identiteit is de basis van alle multi-tenant scoping. |
| tenant_legal_name | company_name | nee | verplicht bij betalend plan | Juridische naam van de tenant is nodig voor de abonnementsfactuur en de DPA. |
| tenant_vat_number | vat_number | nee | VIES-check; formaat per land | BTW-nummer van de tenant bepaalt of het abonnement met 21% BE-BTW of intracommunautair verlegd wordt gefactureerd. |
| billing_email | email | nee | RFC 5322 | Apart facturatieadres voor abonnementsfacturen en betalingsmeldingen. |
| stripe_customer_id | reference | nee | patroon cus_...; uniek per tenant | Koppeling met het billingplatform houdt abonnement, betaalmethode en facturen synchroon. |
| plan_bundle | enum | nee | gesloten lijst van samengestelde bundels | Gekozen bundel stuurt entitlements en 403-handhaving per module. |
| seats | integer | nee | >= aantal actieve gebruikers | Aantal betaalde seats begrenst actieve gebruikers en stuurt MRR. |
| default_language | language | nee | ISO 639-1 uit {nl,fr,en} | Standaardtaal van de tenant is de fallback voor gebruikers en documenten. |
| timezone | text | nee | IANA tz-database (Europe/Brussels), default per regio | Tijdzone bepaalt prikklok-, plannings- en rapportagetijden correct. |
| locale | text | nee | BCP 47-tag | Locale (nl-BE) stuurt datum-, getal- en valutanotatie los van de taal. |
| data_retention_days | integer | nee | >= wettelijk minimum per categorie (BE: facturen/boekhouding 10 jaar, sociale documenten 5 jaar) | GDPR-opslagbeperking vereist een bewaartermijn per datacategorie die auto-opruiming stuurt. |
| legal_hold | boolean | nee | reden + ingesteld-door verplicht bij true | Juridische bewaring moet de automatische opruiming kunnen overrulen bij geschillen. |
| dpa_accepted | boolean | nee | versienummer + datetime + acceptant vastleggen, onwijzigbaar | Een verwerkersovereenkomst (GDPR art. 28) met versie en tijdstip is een harde B2B-aankoopvoorwaarde. |
| subprocessors_ack | json | nee | lijst {naam, doel, regio, datum}; wijzigingen gemeld aan tenant | Transparantie over subverwerkers en notificatie bij wijziging is een standaard DPA-verplichting. |
| mfa_enforced | boolean | nee | true dwingt MFA af voor alle gebruikers van de tenant | Tenant-brede MFA-afdwinging is een security-baseline die B2B-kopers in vragenlijsten eisen. |
| sso_domain | text | nee | geldig domein + DNS TXT-verificatie vóór activatie | Geverifieerd e-maildomein stuurt de SAML-resolve voor de SSO-add-on. |
| support_access_consent | boolean | nee | consent + sliding expiry + read/write-scope + audit-log | Impersonatie door support mag alleen met expliciete, aflopende klant-toestemming (GDPR). |
| data_region | enum | nee | gesloten regiolijst; wijziging = migratieproces | EU-datalocatie is een terugkerende GDPR- en aanbestedingseis bij Belgische B2B-klanten. |

## Bronverwijzing

De volledige ruwe inventaris (1256 velden met bestand:regel-verwijzingen) staat in het workflow-resultaat; dit rapport is de beslisbare samenvatting. Kernlocaties in de code: config-platform.js:20 (6 veldtypes custom fields), forms-engine.js:216 (answer-index degradatie), field-dictionary.js:20-25 (engineFieldType-degradatie), crm.js:71 (e-mail = bevat @), peppol-invoice.js:148 (leeg city/PostalZone door plat adres).
