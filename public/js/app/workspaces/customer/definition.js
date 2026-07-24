/* ============================================================
   IA-07 · Klantwerkruimte (IA handover §7/§8)

   Contract: "Customers, contacts, locations, requests and relationship
   tabs."
   Acceptatie: "Canonical links; no duplicate customer/location data."

   Die tweede eis is de kern van deze workstream. Vandaag draagt een
   werkbon een eigen adresveld, een offerte een eigen klantnaam en een
   project een eigen locatietekst. Dat leest prettig tot iemand het adres
   wijzigt: dan klopt de werkbon van vorige week niet meer met de klant,
   en niemand weet welke van de twee waar is.

   De regel: de KLANT bezit zijn contacten en locaties. Elk ander record
   verwijst met een id (customerId, locationId, contactId). De naam en het
   adres die je op een werkbon ziet worden geresolved, niet gekopieerd.

   Uitzondering en enige uitzondering: een VERSTUURD of GEBOEKT document -
   een offerteversie, een factuur, een ondertekende werkbon - bevriest de
   adresgegevens bewust. Dat is geen duplicaat maar een momentopname, want
   een verstuurde factuur mag niet met terugwerkende kracht veranderen.
   Zulke velden staan hieronder expliciet als snapshot geregistreerd.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.customer = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "customers",
    recordBase: "/app/customers",
    idParam: "customerId",
    defaultTab: "overview",
    // Velden die de klant BEZIT. Andere records verwijzen ernaar.
    ownedFields: ["name", "vatNumber", "email", "phone", "language", "paymentTerms"],
    tabs: [
      { id: "overview", labelKey: "customer.tab.overview", permission: "customers.view" },
      { id: "contacts", labelKey: "customer.tab.contacts", permission: "customers.view", countSource: "customer.contacts" },
      { id: "locations", labelKey: "customer.tab.locations", permission: "customers.view", countSource: "customer.locations" },
      { id: "requests", labelKey: "customer.tab.requests", permission: "customer_requests.view", countSource: "customer.requests" },
      { id: "quotes", labelKey: "customer.tab.quotes", permission: "quotes.view", entitlement: "quotes", countSource: "customer.quotes" },
      { id: "projects", labelKey: "customer.tab.projects", permission: "projects.view", entitlement: "projects", countSource: "customer.projects" },
      { id: "work-orders", labelKey: "customer.tab.work_orders", permission: "workorders.view", entitlement: "workorders", countSource: "customer.work_orders" },
      { id: "invoices", labelKey: "customer.tab.invoices", permission: "invoices.view", entitlement: "invoices", countSource: "customer.invoices" },
      { id: "files", labelKey: "customer.tab.files", permission: "customers.view", countSource: "customer.files" },
      { id: "activity", labelKey: "customer.tab.activity", permission: "customers.view" },
    ],
  };

  /**
   * Het canonieke verwijzingsregister.
   *
   * Per recordsoort: met welke sleutel verwijst hij naar de klant en naar
   * de locatie, en welke velden mag hij bevriezen als momentopname.
   * Alles wat NIET in snapshotFields staat en toch de klantnaam of het
   * adres draagt, is een duplicaat.
   */
  const CANONICAL_LINKS = {
    contact: { customerKey: "customerId", locationKey: null, snapshotFields: [] },
    location: { customerKey: "customerId", locationKey: null, snapshotFields: [] },
    customer_request: { customerKey: "customerId", locationKey: "locationId", snapshotFields: [] },
    quote: { customerKey: "customerId", locationKey: "locationId", snapshotFields: [] },
    // Een offerteVERSIE is verstuurd naar de klant en bevriest dus bewust.
    quote_version: { customerKey: "customerId", locationKey: "locationId", snapshotFields: ["customerName", "billingAddress", "vatNumber"] },
    project: { customerKey: "customerId", locationKey: "locationId", snapshotFields: [] },
    work_order: { customerKey: "customerId", locationKey: "locationId", snapshotFields: [] },
    // Een factuur is een boekstuk: bevroren op het moment van uitgifte.
    invoice: { customerKey: "customerId", locationKey: "locationId", snapshotFields: ["customerName", "billingAddress", "vatNumber"] },
    appointment: { customerKey: "customerId", locationKey: "locationId", snapshotFields: [] },
  };

  // Velden die een klant of locatie beschrijven. Draagt een ander record ze
  // zonder snapshot-recht, dan is het een kopie die uit de pas gaat lopen.
  const DESCRIPTIVE_FIELDS = [
    "customerName", "clientName", "customerEmail", "customerPhone", "vatNumber",
    "address", "street", "city", "postalCode", "billingAddress", "siteAddress", "locationName",
  ];

  /**
   * Controleer of een record de canonieke verwijzing respecteert.
   *
   * @returns {{ ok, violations:[{field, reason}] }}
   */
  function checkCanonicalLinks(recordType, record) {
    const regel = CANONICAL_LINKS[recordType];
    if (!regel) return { ok: false, violations: [{ field: null, reason: "UNKNOWN_RECORD_TYPE" }] };
    const overtredingen = [];

    if (regel.customerKey && !record[regel.customerKey]) {
      overtredingen.push({ field: regel.customerKey, reason: "MISSING_CANONICAL_LINK" });
    }
    for (const veld of DESCRIPTIVE_FIELDS) {
      if (record[veld] === undefined) continue;
      if (regel.snapshotFields.includes(veld)) continue;
      overtredingen.push({ field: veld, reason: "DUPLICATED_CUSTOMER_DATA" });
    }
    return { ok: overtredingen.length === 0, violations: overtredingen };
  }

  /**
   * Los een verwijzing op tot weergavegegevens. Dit is de vervanger van
   * kopiëren: de werkbon toont de klantnaam, maar bezit hem niet.
   */
  function resolveDisplay(record, recordType, { customers, locations }) {
    const regel = CANONICAL_LINKS[recordType];
    if (!regel) return null;
    const klant = (customers || {})[record[regel.customerKey]] || null;
    const locatie = regel.locationKey ? (locations || {})[record[regel.locationKey]] || null : null;
    return {
      customerId: record[regel.customerKey] || null,
      customerName: klant ? klant.name : null,
      locationId: regel.locationKey ? record[regel.locationKey] || null : null,
      locationLabel: locatie ? locatie.label : null,
      // Bij een bevroren document wint de momentopname · anders zou een
      // adreswijziging een verstuurde factuur veranderen.
      frozen: regel.snapshotFields.length > 0
        ? regel.snapshotFields.reduce((a, f) => (record[f] !== undefined ? { ...a, [f]: record[f] } : a), {})
        : null,
    };
  }

  /** De relaties die de klantwerkruimte toont, in vaste volgorde. */
  function relatedTypes() {
    return Object.keys(CANONICAL_LINKS).filter(t => t !== "contact" && t !== "location").sort();
  }

  return { DEFINITION, CANONICAL_LINKS, DESCRIPTIVE_FIELDS, checkCanonicalLinks, resolveDisplay, relatedTypes };
});
