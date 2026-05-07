const KBO_FIXTURES = {
  "BE0123456789": {
    name: "Demo Bouwgroep NV",
    companyNumber: "0123456789",
    street: "Kerkstraat 12",
    postalCode: "9000",
    city: "Gent",
    country: "Belgie"
  },
  "BE0897225572": {
    name: "ABMS Consultancy BV",
    companyNumber: "0897225572",
    street: "Stationsstraat 44",
    postalCode: "2800",
    city: "Mechelen",
    country: "Belgie"
  }
};

function normalizeVat(vat) {
  const clean = String(vat || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!clean) return "";
  return clean.startsWith("BE") ? clean : `BE${clean}`;
}

function lookupKbo(vat) {
  const normalized = normalizeVat(vat);
  const hit = KBO_FIXTURES[normalized];
  if (hit) return { vat: normalized, source: "mock-kbo", ...hit };
  const companyNumber = normalized.replace(/^BE/, "");
  return {
    vat: normalized,
    source: "mock-kbo-fallback",
    name: `KBO onderneming ${companyNumber}`,
    companyNumber,
    street: "",
    postalCode: "",
    city: "",
    country: "Belgie"
  };
}

module.exports = { lookupKbo, normalizeVat };
