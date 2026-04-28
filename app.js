var useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo, useCallback = React.useCallback, useRef = React.useRef;
var __assign = (false) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __rest = (false) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __spreadArray = (false) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
// ─── TOKENS ───────────────────────────────────────────────────────────────────
var BG = "#F5F8FB", SUR = "#FFFFFF", BOR = "#DDE7EF", TXT = "#10233F", SUB = "#526579", MUT = "#9AAABC";
var BLU = "#246BFE", BLUL = "#EEF5FF", BLUB = "#BFD7FF";
var GRN = "#18A999", GRNL = "#EAFBF7", AMB = "#F59E0B", AMBL = "#FFF8E8";
var RED = "#E5484D", REDL = "#FFF1F2", PUR = "#6F5DE7", PURL = "#F4F1FF";
var TEAL = "#00A7C8", NAV_BG = "#10233F";
var SH = "0 1px 2px rgba(16,35,63,.04),0 10px 30px rgba(16,35,63,.055)";
var SHM = "0 16px 38px rgba(16,35,63,.12)";
var SHL = "0 30px 80px rgba(16,35,63,.18)";
var VCOLS = ["#246BFE", "#18A999", "#F59E0B", "#E5484D", "#6F5DE7", "#00A7C8", "#B45309", "#526579"];
var KM_RATE = 0.4269;
var SCOL = {
    active: GRN, trial: AMB, suspended: RED, cancelled: MUT,
    Voltooid: GRN, Goedgekeurd: GRN, paid: GRN, approved: GRN, Beschikbaar: GRN,
    Bezig: BLU, "In gebruik": BLU, submitted: AMB,
    "In behandeling": AMB, Onderhoud: AMB,
    Geannuleerd: RED, Geweigerd: RED, rejected: RED, draft: MUT, Defect: RED,
};
var CAT_IC = { brandstof: "⛽", parking: "🅿️", tolkosten: "🛣️", maaltijden: "🍽️", hotel: "🏨",
    kantoormateriaal: "📎", gereedschap: "🔧", verzending: "📦", software: "💻",
    training: "📚", representatie: "🤝", kilometers: "🚗", overig: "📋" };
var EXP_ST = { draft: "Concept", submitted: "Ingediend", approved: "Goedgekeurd", rejected: "Afgewezen", paid: "Uitbetaald" };
// ─── PERMISSIONS ──────────────────────────────────────────────────────────────
var ALL_PERMS = ["onboarding", "alerts", "planning", "clockings", "expenses", "workorders", "stock", "vehicles", "leaves", "messages", "reports", "datahub", "integrations", "billing", "employees", "venues", "customers", "settings", "audit"];
var ROLE_DEFAULTS = {
    super_admin: ALL_PERMS,
    tenant_admin: ALL_PERMS,
    venue_manager: ["alerts", "planning", "clockings", "expenses", "workorders", "stock", "leaves", "messages", "customers"],
    employee: ["planning", "expenses", "workorders", "leaves", "messages"],
};
var ROLE_LABELS = { super_admin: "Super Admin", tenant_admin: "Admin", venue_manager: "Werfleider", employee: "Medewerker" };
var PLAN_LIMITS = {
    starter: { users: 10, venues: 2, customRoles: 2, integrations: 0, auditDays: 30, label: "Starter" },
    business: { users: 50, venues: 10, customRoles: 10, integrations: 3, auditDays: 365, label: "Business" },
    enterprise: { users: 500, venues: 999, customRoles: 999, integrations: 999, auditDays: 2555, label: "Enterprise" },
};
var hasPerm = function (user, perm) {
    if (!user)
        return false;
    if (user.role === "super_admin")
        return true;
    return (user.permissions || ROLE_DEFAULTS[user.role] || []).includes(perm);
};
var isAdminRole = function (r) { return r === "super_admin" || r === "tenant_admin" || r === "venue_manager"; };
// ─── HELPERS ──────────────────────────────────────────────────────────────────
var gd = function (n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };
var TODAY = new Date().toISOString().split("T")[0];
var uid = function () { return Math.random().toString(36).slice(2, 8); };
var fD = function (d) { return new Date(d).toLocaleDateString("nl-BE", { day: "2-digit", month: "2-digit", year: "numeric" }); };
var fS = function (d) { return new Date(d).toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" }); };
var hH = function (s, e) { var _a = s.split(":").map(Number), sh = _a[0], sm = _a[1]; var _b = e.split(":").map(Number), eh = _b[0], em = _b[1]; var d = eh * 60 + em - sh * 60 - sm; return d > 0 ? (d / 60).toFixed(1) : "0.0"; };
var getTC = function (name, customTypes) {
    var ct = customTypes === null || customTypes === void 0 ? void 0 : customTypes.find(function (t) { return t.name === name; });
    if (ct)
        return { col: ct.color, bg: ct.color + "22" };
    var BUILTIN = { "Dagdienst": { col: BLU, bg: BLUL }, "Vroegdienst": { col: AMB, bg: AMBL }, "Avonddienst": { col: PUR, bg: PURL }, "Nachtdienst": { col: NAV_BG, bg: "#F1F5F9" }, "Vrij": { col: GRN, bg: GRNL }, "Verlof": { col: RED, bg: REDL } };
    return BUILTIN[name] || { col: MUT, bg: BG };
};
var scopeV = function (venues, u) { return venues.filter(function (v) { return u.role === "super_admin" ? true : v.tenantId === u.tenantId && (u.role === "tenant_admin" || (u.venueIds || []).includes(v.id)); }); };
var scopeU = function (users, u) {
    if (u.role === "super_admin")
        return users.filter(function (x) { return x.role !== "super_admin"; });
    if (u.role === "tenant_admin")
        return users.filter(function (x) { return x.tenantId === u.tenantId && x.id !== u.id; });
    if (u.role === "venue_manager")
        return users.filter(function (x) { return x.tenantId === u.tenantId && (u.venueIds || []).some(function (v) { return (x.venueIds || []).includes(v); }) && x.role === "employee"; });
    return [];
};
var scopeC = function (c, u, au) { return c.filter(function (x) { var _a; return u.role === "super_admin" ? true : ((_a = au.find(function (a) { return a.id === x.userId; })) === null || _a === void 0 ? void 0 : _a.tenantId) === u.tenantId; }); };
var scopeE = function (e, u, au) { return e.filter(function (x) { var _a; return u.role === "super_admin" ? true : ((_a = au.find(function (a) { return a.id === x.userId; })) === null || _a === void 0 ? void 0 : _a.tenantId) === u.tenantId; }); };
var scopeW = function (w, u, au) { return w.filter(function (x) { var _a; return u.role === "super_admin" ? true : ((_a = au.find(function (a) { return a.id === x.userId; })) === null || _a === void 0 ? void 0 : _a.tenantId) === u.tenantId; }); };
var scopeL = function (l, u, au) { return l.filter(function (x) { var _a; return u.role === "super_admin" ? true : ((_a = au.find(function (a) { return a.id === x.userId; })) === null || _a === void 0 ? void 0 : _a.tenantId) === u.tenantId; }); };
var scopeS = function (s, u, venues) { return s.filter(function (x) { return u.role === "super_admin" ? true : scopeV(venues, u).some(function (v) { return v.id === x.venueId; }); }); };
var scopeCustomers = function (customers, u) { return customers.filter(function (c) { return u.role === "super_admin" ? true : c.tenantId === u.tenantId; }); };
// ─── SEED DATA ────────────────────────────────────────────────────────────────
var USERS = [
    { id: 99, name: "Super Admin", ini: "SA", email: "sa@workflowpro.be", phone: "", dept: "Platform", role: "super_admin", hue: 270, tenantId: null, venueIds: [], primaryVenueId: null, active: true, permissions: ALL_PERMS },
    { id: 10, name: "Admin Claes", ini: "AC", email: "admin@claes.be", phone: "0477 55 66 77", dept: "Management", role: "tenant_admin", hue: 260, tenantId: "t1", venueIds: ["v1", "v2", "v3"], primaryVenueId: "v1", active: true, permissions: ALL_PERMS },
    { id: 5, name: "Werfleider Kim", ini: "WK", email: "kim@claes.be", phone: "0477 33 44 55", dept: "Werf", role: "venue_manager", hue: 190, tenantId: "t1", venueIds: ["v2", "v3"], primaryVenueId: "v2", active: true, permissions: ["planning", "clockings", "expenses", "workorders", "leaves", "messages"] },
    { id: 1, name: "Lena De Smet", ini: "LD", email: "lena@claes.be", phone: "0477 11 22 33", dept: "Logistiek", role: "employee", hue: 220, tenantId: "t1", venueIds: ["v1", "v2"], primaryVenueId: "v2", active: true, permissions: ["expenses", "workorders", "leaves", "messages"] },
    { id: 2, name: "Jarne Claes", ini: "JC", email: "jarne@claes.be", phone: "0477 44 55 66", dept: "Techniek", role: "employee", hue: 150, tenantId: "t1", venueIds: ["v1", "v3"], primaryVenueId: "v3", active: true, permissions: ["expenses", "workorders", "leaves", "messages"] },
    { id: 3, name: "Nora Pieters", ini: "NP", email: "nora@claes.be", phone: "0477 77 88 99", dept: "Admin", role: "employee", hue: 340, tenantId: "t1", venueIds: ["v1"], primaryVenueId: "v1", active: true, permissions: ["expenses", "leaves", "messages"] },
    { id: 4, name: "Bram Declercq", ini: "BD", email: "bram@claes.be", phone: "0477 22 33 44", dept: "Techniek", role: "employee", hue: 30, tenantId: "t1", venueIds: ["v2", "v3"], primaryVenueId: "v2", active: true, permissions: ["expenses", "workorders", "leaves", "messages", "vehicles"] },
];
var TENANTS = [
    { id: "t1", name: "Bouwgroep Claes NV", plan: "business", users: 6, venues: 3, mrr: 324, status: "active", billingEmail: "admin@claes.be", accountOwner: "Nina", lifecycle: "active", trialEndsAt: gd(9), lastActiveAt: TODAY, billingStatus: "paid", paymentMethod: "Visa **** 4242", nextInvoiceAt: gd(18), renewalAt: gd(330), churnRisk: "low", successNote: "Uitbreiding naar extra werf bespreken.", supportTickets: 1, supportAccess: { enabled: true, autoRenew: false, grantedBy: "Admin Claes", grantedAt: gd(-1), expiresAt: gd(7), reason: "Onboarding support" } },
    { id: "t2", name: "LogiTrans BVBA", plan: "enterprise", users: 45, venues: 5, mrr: 1305, status: "active", billingEmail: "info@logitrans.be", accountOwner: "Nina", lifecycle: "renewal", trialEndsAt: gd(-120), lastActiveAt: gd(-2), billingStatus: "paid", paymentMethod: "SEPA", nextInvoiceAt: gd(11), renewalAt: gd(42), churnRisk: "medium", successNote: "Renewal call plannen rond integraties.", supportTickets: 2, supportAccess: { enabled: false } },
    { id: "t3", name: "Schoonmaak Tops", plan: "starter", users: 8, venues: 2, mrr: 72, status: "trial", billingEmail: "tops@cleaning.be", accountOwner: "Sam", lifecycle: "trial", trialEndsAt: gd(3), lastActiveAt: gd(-5), billingStatus: "trialing", paymentMethod: "", nextInvoiceAt: gd(3), renewalAt: gd(365), churnRisk: "high", successNote: "Nog geen betaalmethode en lage activiteit.", supportTickets: 0, supportAccess: { enabled: false } },
    { id: "t4", name: "Installatie Plus", plan: "business", users: 12, venues: 2, mrr: 216, status: "suspended", billingEmail: "info@plus.be", accountOwner: "Sam", lifecycle: "at_risk", trialEndsAt: gd(-60), lastActiveAt: gd(-18), billingStatus: "payment_failed", paymentMethod: "Mastercard verlopen", nextInvoiceAt: gd(-4), renewalAt: gd(102), churnRisk: "high", successNote: "Payment failed. Heractivatie nodig.", supportTickets: 3, supportAccess: { enabled: false } },
];
var VENUES = [
    { id: "v1", tenantId: "t1", name: "Hoofdkantoor Gent", code: "HK", color: VCOLS[0], address: "Korenmarkt 14, 9000 Gent", active: true },
    { id: "v2", tenantId: "t1", name: "Magazijn Noord", code: "MN", color: VCOLS[1], address: "Industrieweg 42, 9000 Gent", active: true },
    { id: "v3", tenantId: "t1", name: "Werf Brussel", code: "WB", color: VCOLS[2], address: "Reyerslaan 80, 1030 Brussel", active: true },
    { id: "v4", tenantId: "t2", name: "Depot Antwerpen", code: "DA", color: VCOLS[3], address: "Havenweg 1, 2000 Antwerpen", active: true },
];
var CUSTOMERS = [
    { id: "cu1", tenantId: "t1", name: "Klant A BV", type: "bedrijf", status: "active", vat: "BE 0741.258.963", email: "info@klanta.be", phone: "09 222 33 44", address: "Dok Noord 7, 9000 Gent", contact: "Els Vermeiren", ownerId: 10, sector: "Industrie", paymentTerms: "30 dagen", note: "Belangrijke onderhoudsklant. Jaarcontract loopt tot december.", tags: ["onderhoud", "VIP"] },
    { id: "cu2", tenantId: "t1", name: "Klant B NV", type: "bedrijf", status: "active", vat: "BE 0456.789.123", email: "facilities@klantb.be", phone: "02 456 78 90", address: "Louizalaan 210, 1050 Brussel", contact: "Tom Michiels", ownerId: 5, sector: "Vastgoed", paymentTerms: "14 dagen", note: "Veel werkbonnen op werven in Brussel.", tags: ["werf", "facturabel"] },
    { id: "cu3", tenantId: "t1", name: "Intern", type: "intern", status: "active", vat: "", email: "admin@claes.be", phone: "", address: "Korenmarkt 14, 9000 Gent", contact: "Admin Claes", ownerId: 10, sector: "Intern", paymentTerms: "", note: "Interne taken en niet-facturabele planning.", tags: ["intern"] },
    { id: "cu4", tenantId: "t2", name: "Retail Hub Antwerpen", type: "bedrijf", status: "prospect", vat: "BE 0666.111.222", email: "ops@retailhub.be", phone: "03 888 77 66", address: "Meir 12, 2000 Antwerpen", contact: "Sarah Peeters", ownerId: null, sector: "Retail", paymentTerms: "30 dagen", note: "Prospect voor logistieke planning.", tags: ["prospect"] },
];
var CUSTOM_TYPES_INIT = [
    { id: "ct1", tenantId: "t1", name: "Leidingwerk", color: "#0891B2", icon: "🔧", desc: "Sanitair en leidingwerk" },
    { id: "ct2", tenantId: "t1", name: "Elektriciteit", color: "#D97706", icon: "⚡", desc: "Elektriciteitswerken" },
    { id: "ct3", tenantId: "t1", name: "Ruwbouw", color: "#B45309", icon: "🧱", desc: "Metselwerk en ruwbouw" },
    { id: "ct4", tenantId: "t1", name: "Vergadering", color: "#7C3AED", icon: "📋", desc: "Intern overleg" },
    { id: "ct5", tenantId: "t1", name: "Opleiding", color: "#16A34A", icon: "📚", desc: "Training en opleiding" },
];
var SHIFTS = [
    { id: 1, userId: 1, venueId: "v2", date: TODAY, start: "08:00", end: "16:30", type: "Dagdienst", taskTypeId: "", project: "", client: "", note: "", billable: false },
    { id: 2, userId: 2, venueId: "v3", date: TODAY, start: "07:00", end: "15:00", type: "Leidingwerk", taskTypeId: "ct1", project: "Renovatie hal 3", client: "Klant A BV", note: "Aankomst voor 7u", billable: true },
    { id: 3, userId: 3, venueId: "v1", date: TODAY, start: "09:00", end: "17:00", type: "Dagdienst", taskTypeId: "", project: "", client: "", note: "", billable: false },
    { id: 4, userId: 4, venueId: "v2", date: TODAY, start: "07:00", end: "15:00", type: "Elektriciteit", taskTypeId: "ct2", project: "Nieuwbouw Gent", client: "Klant B NV", note: "Materiaal meebrengen", billable: true },
    { id: 5, userId: 5, venueId: "v2", date: TODAY, start: "07:00", end: "15:00", type: "Leidingwerk", taskTypeId: "ct1", project: "Renovatie hal 3", client: "Klant A BV", note: "Werfleider aanwezig", billable: true },
    { id: 6, userId: 1, venueId: "v2", date: gd(1), start: "08:00", end: "16:30", type: "Ruwbouw", taskTypeId: "ct3", project: "Uitbreiding depot", client: "Intern", note: "", billable: false },
    { id: 7, userId: 2, venueId: "v3", date: gd(2), start: "08:00", end: "12:00", type: "Vergadering", taskTypeId: "ct4", project: "Projectbespreking", client: "", note: "Teams-call 9u", billable: false },
];
var CLOCKS = [
    { id: 1, userId: 1, venueId: "v2", date: gd(-6), clockIn: "07:58", clockOut: "16:33" },
    { id: 2, userId: 2, venueId: "v3", date: gd(-6), clockIn: "06:55", clockOut: "15:05" },
    { id: 3, userId: 3, venueId: "v1", date: gd(-5), clockIn: "09:00", clockOut: "17:10" },
    { id: 4, userId: 4, venueId: "v2", date: gd(-5), clockIn: "13:58", clockOut: "22:05" },
    { id: 5, userId: 1, venueId: "v2", date: gd(-4), clockIn: "08:02", clockOut: "16:28" },
    { id: 6, userId: 2, venueId: "v3", date: gd(-4), clockIn: "06:58", clockOut: "14:55" },
    { id: 7, userId: 1, venueId: "v2", date: gd(-3), clockIn: "07:55", clockOut: "16:35" },
    { id: 8, userId: 3, venueId: "v1", date: gd(-3), clockIn: "09:05", clockOut: "17:00" },
    { id: 9, userId: 4, venueId: "v2", date: gd(-2), clockIn: "14:00", clockOut: "22:10" },
    { id: 10, userId: 1, venueId: "v2", date: gd(-1), clockIn: "08:00", clockOut: "16:30" },
    { id: 11, userId: 2, venueId: "v3", date: gd(-1), clockIn: "07:00", clockOut: "15:05" },
    { id: 12, userId: 5, venueId: "v2", date: gd(-1), clockIn: "06:50", clockOut: "15:10" },
    { id: 13, userId: 1, venueId: "v2", date: TODAY, clockIn: "07:57", clockOut: null },
];
var EXPS = [
    { id: "e1", userId: 1, venueId: "v2", title: "Brandstof VW Caddy", amount: 68.40, date: gd(-3), category: "brandstof", status: "approved", receiptName: "bon.jpg", isBillable: false, description: "Tankbeurt werf Noord", reviewNote: "", vehicleId: 2, kmCount: 0 },
    { id: "e2", userId: 2, venueId: "v3", title: "Parking klant Brussel", amount: 12.50, date: gd(-1), category: "parking", status: "submitted", receiptName: "parking.jpg", isBillable: true, clientName: "Klant B NV", description: "", reviewNote: "", vehicleId: null, kmCount: 0 },
    { id: "e3", userId: 4, venueId: "v2", title: "Slagboormachine", amount: 189.00, date: gd(-5), category: "gereedschap", status: "submitted", receiptName: "factuur.pdf", isBillable: false, description: "Kabel gebroken", reviewNote: "", vehicleId: null, kmCount: 0 },
    { id: "e4", userId: 1, venueId: "v1", title: "Lunch klant vergadering", amount: 45.80, date: gd(-7), category: "maaltijden", status: "paid", receiptName: "restaurant.jpg", isBillable: true, clientName: "Klant A BV", description: "", reviewNote: "", vehicleId: null, kmCount: 0 },
    { id: "e5", userId: 2, venueId: "v3", title: "Tolkosten snelweg", amount: 8.20, date: gd(-2), category: "tolkosten", status: "rejected", receiptName: "", isBillable: false, description: "", reviewNote: "Geen bon", vehicleId: null, kmCount: 0 },
    { id: "e6", userId: 1, venueId: "v2", title: "Woon-werkverkeer", amount: +(92 * KM_RATE).toFixed(2), date: gd(-1), category: "kilometers", status: "submitted", receiptName: "", isBillable: false, description: "Gent–Brussel v/v", reviewNote: "", vehicleId: null, kmCount: 92 },
];
var EXP_LIMITS_INIT = { maaltijden: 35, hotel: 150, representatie: 100 };
var CUSTOM_ROLES_INIT = [
    { id: "cr_planner", tenantId: "t1", name: "Planner", desc: "Planning, uren en verlof opvolgen", permissions: ["planning", "clockings", "leaves", "messages"], actions: ["view", "create", "update"], scope: "tenant", sensitivity: "internal" },
    { id: "cr_finance", tenantId: "t1", name: "Finance", desc: "Onkosten, rapportages, billing en integraties", permissions: ["expenses", "reports", "billing", "integrations", "audit", "messages"], actions: ["view", "approve", "export"], scope: "tenant", sensitivity: "confidential" },
    { id: "cr_field_lead", tenantId: "t1", name: "Field Lead", desc: "Werkbonnen, stock en voertuigen per locatie", permissions: ["planning", "workorders", "stock", "vehicles", "messages"], actions: ["view", "create", "update"], scope: "venue", sensitivity: "internal" },
];
var AUDIT_LOG_INIT = [
    { id: "al1", at: gd(-2), time: "09:14", actor: "Admin Claes", action: "Rol aangepast", area: "Rechten", detail: "Werfleider Kim kreeg toegang tot werkbonnen en stock", severity: "info" },
    { id: "al2", at: gd(-1), time: "16:40", actor: "System", action: "Billing status", area: "Abonnement", detail: "Business plan actief, 6 gebruikers", severity: "ok" },
    { id: "al3", at: TODAY, time: "08:22", actor: "System", action: "Integratie sync", area: "Integraties", detail: "Acerta synchronisatie succesvol verwerkt", severity: "ok" },
];
var PLATFORM_CONFIG_INIT = {
    billing: { currency: "EUR", vatRate: 21, yearlyDiscount: 20, defaultTrialDays: 14, invoicePrefix: "WFP", dunningDays: "3,7,14", proration: true },
    stripe: { mode: "test", publishableKey: "pk_test_demo", secretKeyConfigured: false, webhookSecretConfigured: false, customerPortal: true, webhookUrl: "/api/billing/stripe/webhook" },
    plans: [
        { id: "starter", name: "Starter", tagline: "Voor kleine teams", pricePerUser: 9, trialDays: 14, active: true, color: MUT, popular: false, features: ["Prikklok & tijdregistratie", "Weekplanning", "Verlofbeheer", "Team berichten", "Klantenbeheer", "Support"], notIncluded: ["Werkbonnen", "Wagenpark beheer", "Stockbeheer", "Integraties", "Rapportages", "Datahub export", "Billing", "Audit logging", "Security/GDPR"] },
        { id: "business", name: "Business", tagline: "Meest gekozen", pricePerUser: 18, trialDays: 14, active: true, color: BLU, popular: true, features: ["Prikklok & tijdregistratie", "Weekplanning", "Verlofbeheer", "Team berichten", "Klantenbeheer", "Werkbonnen", "Wagenpark beheer", "Stockbeheer", "Integraties", "Rapportages", "Audit logging", "Security/GDPR", "Support"], notIncluded: ["Datahub export", "Billing"] },
        { id: "enterprise", name: "Enterprise", tagline: "Voor grote organisaties", pricePerUser: 29, trialDays: 30, active: true, color: NAV_BG, popular: false, features: ["Prikklok & tijdregistratie", "Weekplanning", "Verlofbeheer", "Team berichten", "Klantenbeheer", "Werkbonnen", "Wagenpark beheer", "Stockbeheer", "Integraties", "Rapportages", "Datahub export", "Billing", "Audit logging", "Security/GDPR", "Support"], notIncluded: [] },
    ],
    modules: [
        { id: "workorders", icon: "W", name: "Werkbonnen Pro", price: 3, per: "user/mnd", active: true, color: BLU, desc: "Digitale werkbonnen, foto-uploads, handtekening" },
        { id: "vehicles", icon: "V", name: "Wagenpark", price: 2, per: "user/mnd", active: true, color: PUR, desc: "Voertuigbeheer, service-alerts, bestuurder" },
        { id: "stock", icon: "S", name: "Stockbeheer", price: 2, per: "user/mnd", active: true, color: AMB, desc: "Voorraad, min/max alerts, locaties" },
        { id: "integr", icon: "I", name: "Integraties", price: 5, per: "mnd", active: true, color: TEAL, desc: "Acerta, Liantis, SD Worx, Securex, Partena, Robaws" },
    ],
    rolePolicies: {
        tenant_admin: { name: "Admin", permissions: ALL_PERMS, actions: ["view", "create", "update", "delete", "approve", "export"], scope: "tenant", sensitivity: "financial", lockedBySuperAdmin: true }
    },
    support: { requireTenantConsent: true, maxSessionMinutes: 60, defaultConsentDays: 7, auditEverySession: true },
    featureFlags: { robaws: true, customRoles: true, auditLog: true, selfServeCheckout: true, customerPortal: true, apiKeys: false },
};
var getTenantAdminPolicy = function (platformConfig) {
    var _a;
    return ((_a = platformConfig === null || platformConfig === void 0 ? void 0 : platformConfig.rolePolicies) === null || _a === void 0 ? void 0 : _a.tenant_admin) || PLATFORM_CONFIG_INIT.rolePolicies.tenant_admin;
};
var SECURITY_POLICY_INIT = {
    auth: { mfaRequired: false, passwordMinLength: 12, sessionMinutes: 480, idleTimeoutMinutes: 60, passwordResetEnabled: true },
    sessions: { forceLogoutOnRoleChange: true, rememberDeviceDays: 30, ipLogging: true, deviceLogging: true },
    data: { tenantIsolation: "demo-client-side", retentionDays: 2555, gdprExportEnabled: true, gdprDeleteEnabled: false, dpaRequired: true },
    credentials: { encryptedVault: false, stripeSecretsServerSide: false, integrationKeysServerSide: false, rotationDays: 90 },
    support: { reasonRequired: false, approvalTrailRequired: true, readOnlyModePreferred: true, sessionRecording: false },
};
var SECURITY_EVENTS_INIT = [
    { id: "se1", at: TODAY, time: "08:40", tenantId: "t1", actor: "Admin Claes", type: "support_consent", detail: "Supporttoegang tijdelijk ingeschakeld tot " + fD(gd(7)), severity: "info", ip: "81.82.***.***", device: "Chrome / Windows" },
    { id: "se2", at: gd(-1), time: "16:12", tenantId: "t4", actor: "System", type: "billing_risk", detail: "Payment failed en tenant geschorst", severity: "high", ip: "system", device: "server" },
    { id: "se3", at: gd(-2), time: "10:05", tenantId: "t1", actor: "Super Admin", type: "role_change", detail: "Rechten van werfleider aangepast", severity: "medium", ip: "185.12.***.***", device: "Chrome / Windows" },
    { id: "se4", at: gd(-3), time: "09:18", tenantId: "t3", actor: "System", type: "trial_risk", detail: "Trial eindigt binnen 7 dagen zonder betaalmethode", severity: "medium", ip: "system", device: "server" },
];
var WOS = [
    { id: 1, userId: 1, venueId: "v2", date: gd(-2), title: "Onderhoud pomp", client: "Klant A BV", location: "Industrieweg 12", status: "Voltooid", desc: "Regulier onderhoud hal 3", note: "Filter vervangen.", billableHours: 3.5,
        checklist: [{ id: "cl1", label: "Visuele inspectie", done: true }, { id: "cl2", label: "Filter vervanging", done: true }, { id: "cl3", label: "Druktest", done: true }],
        materials: [{ stockId: 1, name: "Oliefilter", qty: 1, unit: "st" }, { stockId: 4, name: "Motorolie 5W-30", qty: 2, unit: "L" }],
        files: [{ name: "wb001.pdf", type: "pdf", size: "124 KB", dataUrl: null }], signed: true, reviewed: true },
    { id: 2, userId: 2, venueId: "v3", date: gd(-1), title: "Elektrische storing kantine", client: "Intern", location: "Hoofdkantoor", status: "In behandeling", desc: "Kortsluiting verdeelkast.", note: "", billableHours: 0,
        checklist: [{ id: "cl4", label: "Oorzaak bepalen", done: true }, { id: "cl5", label: "Onderdelen bestellen", done: false }, { id: "cl6", label: "Herstelling uitvoeren", done: false }],
        materials: [], files: [], signed: false, reviewed: false },
    { id: 3, userId: 1, venueId: "v2", date: TODAY, title: "LED verlichting magazijn", client: "Klant B NV", location: "Brugge", status: "Bezig", desc: "40 LED armaturen plaatsen.", note: "", billableHours: 0,
        checklist: [{ id: "cl7", label: "Demontage oude armaturen", done: true }, { id: "cl8", label: "Bekabeling controleren", done: false }, { id: "cl9", label: "Montage LED", done: false }, { id: "cl10", label: "Test & oplevering", done: false }],
        materials: [], files: [], signed: false, reviewed: false },
];
var LEAVES = [
    { id: 1, userId: 1, venueId: "v2", type: "Verlof", from: gd(7), to: gd(9), status: "Goedgekeurd", note: "Vakantie" },
    { id: 2, userId: 2, venueId: "v3", type: "Ziekte", from: gd(14), to: gd(14), status: "In behandeling", note: "" },
];
var MSGS = [
    { id: 1, from: 1, to: 10, text: "Kan ik morgen 30 min later starten?", date: gd(-1), time: "17:45", read: false },
    { id: 2, from: 10, to: 1, text: "Ja dat is ok Lena!", date: gd(-1), time: "18:02", read: true },
    { id: 3, from: 2, to: 10, text: "Parking bon is ingediend.", date: TODAY, time: "09:10", read: false },
];
var VEHICLES = [
    { id: 1, venueId: "v2", plate: "1-ABC-123", brand: "Ford Transit", year: 2022, km: 42300, status: "Beschikbaar", assignedTo: null, nextService: gd(40), fuel: "Diesel", notes: "" },
    { id: 2, venueId: "v2", plate: "1-DEF-456", brand: "VW Caddy", year: 2021, km: 67800, status: "In gebruik", assignedTo: 1, nextService: gd(23), fuel: "Diesel", notes: "Bandenwissel nodig" },
    { id: 3, venueId: "v3", plate: "1-GHI-789", brand: "Renault Master", year: 2023, km: 18400, status: "Onderhoud", assignedTo: null, nextService: gd(6), fuel: "Benzine", notes: "APK volgende week" },
];
var STOCK = [
    { id: 1, venueId: "v2", name: "Oliefilter", sku: "OF-001", qty: 12, min: 5, unit: "st", cat: "Motor", loc: "Rek A1" },
    { id: 2, venueId: "v2", name: "Remblokken voor", sku: "RB-F02", qty: 3, min: 4, unit: "set", cat: "Remmen", loc: "Rek B2" },
    { id: 3, venueId: "v1", name: "Wisserbladen", sku: "WB-003", qty: 8, min: 3, unit: "st", cat: "Carrosserie", loc: "Rek C1" },
    { id: 4, venueId: "v2", name: "Motorolie 5W-30", sku: "MO-004", qty: 24, min: 10, unit: "L", cat: "Motor", loc: "Kast D" },
    { id: 5, venueId: "v1", name: "Koelvloeistof", sku: "KV-005", qty: 2, min: 5, unit: "L", cat: "Motor", loc: "Kast D" },
];
var INIT = { users: USERS, tenants: TENANTS, venues: VENUES, shifts: SHIFTS, clocks: CLOCKS,
    expenses: EXPS, workorders: WOS, leaves: LEAVES, messages: MSGS, vehicles: VEHICLES, stock: STOCK,
    customers: CUSTOMERS, customTypes: CUSTOM_TYPES_INIT, expLimits: EXP_LIMITS_INIT, customRoles: CUSTOM_ROLES_INIT, auditLogs: AUDIT_LOG_INIT, platformConfig: PLATFORM_CONFIG_INIT, securityPolicy: SECURITY_POLICY_INIT, securityEvents: SECURITY_EVENTS_INIT };
var STORAGE_KEY = "workflow-pro-saas-state-v1";
var loadInitialData = function () {
    try {
        var raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return INIT;
        return normalizeData(JSON.parse(raw));
    }
    catch (e) {
        console.warn("Kon lokale WorkFlow Pro data niet laden.", e);
        return INIT;
    }
};
var normalizeData = function (next) {
    var merged = __assign(__assign({}, INIT), (next || {}));
    Object.keys(INIT).forEach(function (key) {
        if (Array.isArray(INIT[key]) && !Array.isArray(merged[key])) {
            merged[key] = INIT[key];
        }
        if (!Array.isArray(INIT[key]) && (!merged[key] || typeof merged[key] === "function")) {
            merged[key] = INIT[key];
        }
    });
    if (merged.platformConfig && merged.platformConfig.rolePolicies && merged.platformConfig.rolePolicies.tenant_admin) {
        var p = merged.platformConfig.rolePolicies.tenant_admin.permissions || [];
        if (!p.includes("customers"))
            merged.platformConfig.rolePolicies.tenant_admin = __assign(__assign({}, merged.platformConfig.rolePolicies.tenant_admin), { permissions: __spreadArray(__spreadArray([], p, true), ["customers"], false) });
    }
    return merged;
};
// ─── UI ATOMS ─────────────────────────────────────────────────────────────────
function Av(_a) {
    var u = _a.u, _b = _a.sz, sz = _b === void 0 ? 34 : _b;
    return React.createElement("div", { style: { width: sz, height: sz, borderRadius: "50%", background: "hsl(".concat(u.hue, ",58%,54%)"), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: sz * .33, flexShrink: 0 } }, u.ini);
}
function Chip(_a) {
    var label = _a.label, _b = _a.color, color = _b === void 0 ? BLU : _b;
    return React.createElement("span", { style: { display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 20, background: color + "1A", color: color, whiteSpace: "nowrap" } }, label);
}
function SChip(_a) {
    var label = _a.label, sk = _a.sk;
    return React.createElement(Chip, { label: label, color: SCOL[sk || label] || MUT });
}
function RoleBadge(_a) {
    var role = _a.role;
    var map = { super_admin: { l: "⚡ Super Admin", c: PUR }, tenant_admin: { l: "🔑 Admin", c: BLU }, venue_manager: { l: "🏗 Werfleider", c: TEAL }, employee: { l: "👤 Medewerker", c: SUB } };
    var m = map[role] || { l: "◈ " + role, c: PUR };
    return React.createElement(Chip, { label: m.l, color: m.c });
}
function Btn(_a) {
    var children = _a.children, _b = _a.v, v = _b === void 0 ? "pri" : _b, sm = _a.sm, lg = _a.lg, full = _a.full, onClick = _a.onClick, disabled = _a.disabled, s = _a.style;
    var vs = { pri: { background: BLU, color: "#fff", border: "1px solid ".concat(BLU) }, ghost: { background: SUR, color: TXT, border: "1px solid ".concat(BOR) }, danger: { background: RED, color: "#fff", border: "1px solid ".concat(RED) }, success: { background: GRN, color: "#fff", border: "1px solid ".concat(GRN) }, warn: { background: AMB, color: "#fff", border: "1px solid ".concat(AMB) }, subtle: { background: "#F7FAFD", color: SUB, border: "1px solid ".concat(BOR) }, accent: { background: GRN, color: "#fff", border: "1px solid ".concat(GRN) } };
    return React.createElement("button", { onClick: onClick, disabled: disabled, style: __assign(__assign(__assign({}, vs[v]), { borderRadius: 8, padding: lg ? "12px 22px" : sm ? "6px 12px" : "9px 15px", fontSize: lg ? 14 : sm ? 12 : 13, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: disabled ? .5 : 1, display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center", transition: "transform .12s ease, box-shadow .12s ease, opacity .12s ease", width: full ? "100%" : undefined, boxShadow: v === "ghost" || v === "subtle" ? "none" : "0 10px 22px rgba(36,107,254,.16)" }), s), onMouseEnter: function (e) { if (!disabled) {
            e.currentTarget.style.opacity = ".9";
            e.currentTarget.style.transform = "translateY(-1px)";
        } }, onMouseLeave: function (e) { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = ""; } }, children);
}
function Modal(_a) {
    var title = _a.title, onClose = _a.onClose, children = _a.children, wide = _a.wide;
    return React.createElement("div", { onClick: function (e) { return e.target === e.currentTarget && onClose(); }, style: { position: "fixed", inset: 0, background: "rgba(15,23,42,.48)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" } },
        React.createElement("div", { style: { background: SUR, borderRadius: 8, width: "100%", maxWidth: wide ? 820 : 540, maxHeight: "90vh", overflowY: "auto", boxShadow: SHL, border: "1px solid ".concat(BOR) } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "17px 22px 14px", borderBottom: "1px solid ".concat(BOR), background: BLUL } },
                React.createElement("span", { style: { fontWeight: 700, fontSize: 16, color: TXT } }, title),
                React.createElement("button", { onClick: onClose, style: { width: 30, height: 30, background: SUR, border: "1px solid ".concat(BOR), cursor: "pointer", color: SUB, fontSize: 17, borderRadius: 8 } }, "\u00D7")),
            React.createElement("div", { style: { padding: "18px 22px" } }, children)));
}
function Inp(_a) {
    var label = _a.label, ta = _a.ta, rows = _a.rows, p = __rest(_a, ["label", "ta", "rows"]);
    return React.createElement("div", { style: { marginBottom: 12 } },
        label && React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 4, textTransform: "uppercase", letterSpacing: .6 } }, label),
        ta ? React.createElement("textarea", __assign({ rows: rows || 3 }, p, { style: { width: "100%", border: "1px solid ".concat(BOR), borderRadius: 8, padding: "10px 12px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", outline: "none", resize: "vertical", background: "#fff", color: TXT } }))
            : React.createElement("input", __assign({}, p, { style: __assign({ width: "100%", border: "1px solid ".concat(BOR), borderRadius: 8, padding: "10px 12px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", outline: "none", background: "#fff", color: TXT }, (p.style || {})) })));
}
function Sel(_a) {
    var label = _a.label, opts = _a.opts, p = __rest(_a, ["label", "opts"]);
    return React.createElement("div", { style: { marginBottom: 12 } },
        label && React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 4, textTransform: "uppercase", letterSpacing: .6 } }, label),
        React.createElement("select", __assign({}, p, { style: { width: "100%", border: "1px solid ".concat(BOR), borderRadius: 8, padding: "10px 12px", fontSize: 13, fontFamily: "inherit", background: SUR, color: TXT } }), opts.map(function (o) { return React.createElement("option", { key: Array.isArray(o) ? o[0] : o, value: Array.isArray(o) ? o[0] : o }, Array.isArray(o) ? o[1] : o); })));
}
function PageHeader(_a) {
    var title = _a.title, sub = _a.sub, action = _a.action;
    return React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 12 } },
        React.createElement("div", null,
            React.createElement("h2", { style: { fontWeight: 900, fontSize: 24, color: TXT, letterSpacing: 0, margin: 0 } }, title),
            sub && React.createElement("p", { style: { fontSize: 13, color: SUB, marginTop: 5, lineHeight: 1.55 } }, sub)),
        action);
}
function Card(_a) {
    var children = _a.children, s = _a.style, onClick = _a.onClick;
    return React.createElement("div", { onClick: onClick, style: __assign({ background: SUR, borderRadius: 8, border: "1px solid ".concat(BOR), boxShadow: SH, transition: "transform .15s ease, box-shadow .15s ease, border-color .15s ease", cursor: onClick ? "pointer" : "default" }, s), onMouseEnter: function (e) { if (onClick) {
            e.currentTarget.style.boxShadow = SHM;
            e.currentTarget.style.borderColor = BLUB;
            e.currentTarget.style.transform = "translateY(-2px)";
        } }, onMouseLeave: function (e) { if (onClick) {
            e.currentTarget.style.boxShadow = SH;
            e.currentTarget.style.borderColor = BOR;
            e.currentTarget.style.transform = "";
        } } }, children);
}
function EmptyState(_a) {
    var title = _a.title, body = _a.body, action = _a.action, compact = _a.compact;
    return React.createElement(Card, { style: { padding: compact ? "18px 20px" : "28px 24px", textAlign: "center", background: "linear-gradient(180deg,#FFFFFF 0%,#F8FBFF 100%)", borderStyle: "dashed", boxShadow: "none" } },
        React.createElement("div", { style: { width: compact ? 44 : 58, height: compact ? 44 : 58, borderRadius: "50%", margin: "0 auto 12px", background: BLUL, color: BLU, display: "flex", alignItems: "center", justifyContent: "center", fontSize: compact ? 25 : 34, fontWeight: 900, animation: "wfpSmile 1.8s ease-in-out infinite" } }, "☺"),
        React.createElement("div", { style: { fontWeight: 900, fontSize: compact ? 14 : 16, color: TXT, marginBottom: 5 } }, title || "Nog geen data"),
        React.createElement("div", { style: { fontSize: 12, color: SUB, lineHeight: 1.5, maxWidth: 420, margin: "0 auto" } }, body || "Zodra er data beschikbaar is, verschijnt die hier automatisch."),
        action && React.createElement("div", { style: { marginTop: 14 } }, action));
}
function KPI(_a) {
    var icon = _a.icon, label = _a.label, value = _a.value, sub = _a.sub, _b = _a.color, color = _b === void 0 ? BLU : _b, onClick = _a.onClick;
    return React.createElement("div", { onClick: onClick, style: { background: SUR, borderRadius: 8, padding: "18px 19px", border: "1px solid ".concat(BOR), boxShadow: SH, transition: "all .15s", cursor: onClick ? "pointer" : "default" }, onMouseEnter: function (e) { if (onClick) {
            e.currentTarget.style.boxShadow = SHM;
            e.currentTarget.style.transform = "translateY(-2px)";
        } }, onMouseLeave: function (e) { e.currentTarget.style.boxShadow = SH; e.currentTarget.style.transform = ""; } },
        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 } },
            React.createElement("div", { style: { width: 38, height: 38, borderRadius: 8, background: color + "12", color: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, border: "1px solid ".concat(color, "22") } }, icon),
            onClick && React.createElement("span", { style: { color: MUT, fontSize: 14 } }, "\u203A")),
        React.createElement("div", { style: { fontWeight: 800, fontSize: 25, color: TXT, letterSpacing: 0, lineHeight: 1 } }, value),
        React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 3 } }, label),
        sub && React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: color, marginTop: 4 } }, sub));
}
function Toasts(_a) {
    var items = _a.items, rm = _a.rm;
    return React.createElement("div", { style: { position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" } }, items.map(function (t) { return React.createElement("div", { key: t.id, onClick: function () { return rm(t.id); }, style: { background: t.tp === "err" ? RED : t.tp === "warn" ? AMB : t.tp === "info" ? BLU : GRN, color: "#fff", padding: "10px 15px", borderRadius: 12, cursor: "pointer", boxShadow: SHM, maxWidth: 300, fontSize: 13, pointerEvents: "all", display: "flex", gap: 9, alignItems: "flex-start" } },
        React.createElement("span", null, t.tp === "err" ? "⚠" : "✓"),
        React.createElement("div", null,
            React.createElement("div", { style: { fontWeight: 700, fontSize: 12 } }, t.title),
            t.body && React.createElement("div", { style: { opacity: .85, marginTop: 1, fontSize: 11 } }, t.body))); }));
}
function LiveClock() {
    var _a = useState(new Date()), t = _a[0], setT = _a[1];
    useEffect(function () { var i = setInterval(function () { return setT(new Date()); }, 1000); return function () { return clearInterval(i); }; }, []);
    return React.createElement("div", { style: { textAlign: "center" } },
        React.createElement("div", { style: { fontWeight: 800, fontSize: 50, color: TXT, letterSpacing: -3, lineHeight: 1 } }, t.toTimeString().slice(0, 8)),
        React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 5 } }, t.toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })));
}
// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login(_a) {
    var onLogin = _a.onLogin;
    var _b = useState(null), sel = _b[0], setSel = _b[1];
    var LOGINS = [
        { u: USERS[0], note: "Volledig platform beheer" },
        { u: USERS[1], note: "Bouwgroep Claes NV" },
        { u: USERS[2], note: "Venues: Magazijn + Werf Brussel" },
        { u: USERS[3], note: "Logistiek · Magazijn Noord" },
        { u: USERS[4], note: "Techniek · Werf Brussel" },
    ];
    return React.createElement("div", { style: { minHeight: "100vh", background: "linear-gradient(135deg,#0B1220 0%,#143329 48%,#172554 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 } },
        React.createElement("div", { style: { width: "100%", maxWidth: 460 } },
            React.createElement("div", { style: { textAlign: "center", marginBottom: 24 } },
                React.createElement("div", { style: { width: 54, height: 54, borderRadius: 12, background: "linear-gradient(135deg,#2563EB,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 14px", boxShadow: "0 18px 38px rgba(37,99,235,.28)", border: "1px solid rgba(255,255,255,.22)" } }, "\u26A1"),
                React.createElement("h1", { style: { fontWeight: 900, fontSize: 30, color: "#fff", letterSpacing: 0 } }, "WorkFlow Pro"),
                React.createElement("p", { style: { color: "rgba(255,255,255,.62)", marginTop: 6, fontSize: 13 } }, "Kies een rol om te testen")),
            React.createElement("div", { style: { background: "rgba(255,255,255,.96)", borderRadius: 10, padding: 22, boxShadow: SHL, border: "1px solid rgba(255,255,255,.45)" } },
                React.createElement("p", { style: { fontSize: 11, fontWeight: 700, color: SUB, textTransform: "uppercase", letterSpacing: .8, marginBottom: 13 } }, "Inloggen als"),
                React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7, marginBottom: 18 } }, LOGINS.map(function (_a) {
                    var u = _a.u, note = _a.note;
                    return (React.createElement("div", { key: u.id, onClick: function () { return setSel(u); }, style: { display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", borderRadius: 8, cursor: "pointer", border: "1px solid ".concat((sel === null || sel === void 0 ? void 0 : sel.id) === u.id ? BLU : BOR), background: (sel === null || sel === void 0 ? void 0 : sel.id) === u.id ? BLUL : "#fff", transition: "all .15s", boxShadow: (sel === null || sel === void 0 ? void 0 : sel.id) === u.id ? "0 8px 20px rgba(37,99,235,.10)" : "none" } },
                        React.createElement(Av, { u: u, sz: 38 }),
                        React.createElement("div", { style: { flex: 1 } },
                            React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: TXT } }, u.name),
                            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, marginTop: 3 } },
                                React.createElement(RoleBadge, { role: u.role }),
                                React.createElement("span", { style: { fontSize: 11, color: MUT } },
                                    "\u00B7 ",
                                    note))),
                        (sel === null || sel === void 0 ? void 0 : sel.id) === u.id && React.createElement("div", { style: { width: 18, height: 18, borderRadius: "50%", background: BLU, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 } }, "\u2713")));
                })),
                React.createElement(Btn, { v: sel ? "pri" : "subtle", lg: true, full: true, onClick: function () { return sel && onLogin(sel); }, disabled: !sel }, sel ? "Inloggen als ".concat(sel.name.split(" ")[0], " \u2192") : "Selecteer een account"))));
}
// ─── DASHBOARDS ───────────────────────────────────────────────────────────────
function DashSA(_a) {
    var tenants = _a.tenants, go = _a.go;
    var mrr = tenants.filter(function (t) { return t.status === "active"; }).reduce(function (a, t) { return a + t.mrr; }, 0);
    var PLANC = { starter: MUT, business: BLU, enterprise: GRN };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Platform Dashboard", sub: "Super Admin \u2014 overzicht alle klanten" }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", gap: 12, marginBottom: 22 } },
            React.createElement(KPI, { icon: "\uD83C\uDFE2", label: "Actieve klanten", value: tenants.filter(function (t) { return t.status === "active"; }).length, color: BLU, onClick: function () { return go("tenants"); } }),
            React.createElement(KPI, { icon: "\uD83D\uDCB0", label: "MRR", value: "\u20AC".concat(mrr), color: GRN, onClick: function () { return go("tenants"); } }),
            React.createElement(KPI, { icon: "\uD83D\uDCC8", label: "ARR", value: "\u20AC".concat((mrr * 12).toLocaleString()), color: TEAL }),
            React.createElement(KPI, { icon: "\u26A0", label: "Geschorst", value: tenants.filter(function (t) { return t.status === "suspended"; }).length, color: RED, onClick: function () { return go("tenants"); } }),
            React.createElement(KPI, { icon: "\u25D0", label: "In trial", value: tenants.filter(function (t) { return t.status === "trial"; }).length, color: AMB, onClick: function () { return go("tenants"); } }),
            React.createElement(KPI, { icon: "\uD83D\uDC65", label: "Totaal users", value: tenants.reduce(function (a, t) { return a + t.users; }, 0), color: PUR })),
        React.createElement(Card, { onClick: function () { return go("onboarding"); }, style: { padding: "18px 20px", marginBottom: 18, cursor: "pointer", border: "1.5px solid ".concat(BLUB), background: BLUL } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 900, fontSize: 16, color: TXT } }, "Tenant onboarding"),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 3 } }, "Start en volg klantactivatie vanuit Super Admin.")),
                React.createElement(Btn, { sm: true, onClick: function (e) { e.stopPropagation(); go("onboarding"); } }, "Open onboarding"))),
        React.createElement(Card, { style: { padding: 0, overflow: "hidden" } },
            React.createElement("div", { style: { padding: "14px 18px", borderBottom: "1px solid ".concat(BOR), display: "flex", alignItems: "center", justifyContent: "space-between" } },
                React.createElement("span", { style: { fontWeight: 700, fontSize: 14 } }, "Alle klanten"),
                React.createElement(Btn, { sm: true, onClick: function () { return go("tenants"); } }, "Beheren \u2192")),
            tenants.map(function (t) { return React.createElement("div", { key: t.id, onClick: function () { return go("tenants"); }, style: { display: "grid", gridTemplateColumns: "1fr 90px 65px 75px 70px 95px", gap: 12, padding: "12px 18px", borderBottom: "1px solid ".concat(BOR), alignItems: "center", cursor: "pointer" }, onMouseEnter: function (e) { return e.currentTarget.style.background = BG; }, onMouseLeave: function (e) { return e.currentTarget.style.background = ""; } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 600, fontSize: 13, color: TXT } }, t.name),
                    React.createElement("div", { style: { fontSize: 11, color: MUT } }, t.billingEmail)),
                React.createElement(Chip, { label: t.plan, color: PLANC[t.plan] }),
                React.createElement("span", { style: { fontSize: 12, color: SUB } },
                    t.users,
                    " users"),
                React.createElement("span", { style: { fontWeight: 700, fontSize: 12, color: GRN } },
                    "\u20AC",
                    t.mrr,
                    "/mnd"),
                React.createElement("span", { style: { fontSize: 11, color: SUB } },
                    t.venues,
                    " venues"),
                React.createElement(SChip, { label: t.status, sk: t.status })); })));
}
function DashAdmin(_a) {
    var user = _a.user, allUsers = _a.allUsers, allShifts = _a.allShifts, allClocks = _a.allClocks, allExp = _a.allExp, allWO = _a.allWO, allLeaves = _a.allLeaves, allMsgs = _a.allMsgs, venues = _a.venues, go = _a.go;
    var myV = scopeV(venues, user);
    var myU = scopeU(allUsers, user);
    var todayS = scopeS(allShifts, user, venues).filter(function (s) { return s.date === TODAY; });
    var pendExp = scopeE(allExp, user, allUsers).filter(function (e) { return e.status === "submitted"; });
    var unread = allMsgs.filter(function (m) { return m.to === user.id && !m.read; });
    var pendL = scopeL(allLeaves, user, allUsers).filter(function (l) { return l.status === "In behandeling"; });
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Dashboard", sub: new Date().toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", gap: 12, marginBottom: 22 } },
            React.createElement(KPI, { icon: "\uD83C\uDFE2", label: "Venues", value: myV.length, color: BLU, onClick: function () { return go("venues"); } }),
            React.createElement(KPI, { icon: "\uD83D\uDC65", label: "Team", value: myU.length, color: NAV_BG, onClick: function () { return go("employees"); } }),
            React.createElement(KPI, { icon: "\uD83D\uDCC5", label: "Diensten vandaag", value: todayS.length, color: PUR, onClick: function () { return go("planning"); } }),
            React.createElement(KPI, { icon: "\uD83D\uDCB8", label: "Onkosten", value: pendExp.length, sub: pendExp.length > 0 ? "te behandelen" : undefined, color: AMB, onClick: function () { return go("expenses"); } }),
            React.createElement(KPI, { icon: "\uD83D\uDCAC", label: "Ongelezen", value: unread.length, color: TEAL, onClick: function () { return go("messages"); } }),
            pendL.length > 0 && React.createElement(KPI, { icon: "\uD83C\uDFD6", label: "Verlof", value: pendL.length, sub: "in behandeling", color: RED, onClick: function () { return go("leaves"); } })),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } },
            React.createElement(Card, { style: { padding: "18px 20px" } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 13 } }, "\uD83D\uDC65 Team vandaag"),
                myU.slice(0, 6).map(function (u) {
                    var sh = todayS.find(function (s) { return s.userId === u.id; });
                    var cl = allClocks.find(function (c) { return c.userId === u.id && c.date === TODAY; });
                    var tc = sh ? getTC(sh.type, []) : null;
                    return React.createElement("div", { key: u.id, onClick: function () { return go("clockings"); }, style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 7px", borderRadius: 8, marginBottom: 3, cursor: "pointer" }, onMouseEnter: function (e) { return e.currentTarget.style.background = BG; }, onMouseLeave: function (e) { return e.currentTarget.style.background = ""; } },
                        React.createElement(Av, { u: u, sz: 28 }),
                        React.createElement("div", { style: { flex: 1 } },
                            React.createElement("div", { style: { fontWeight: 600, fontSize: 12, color: TXT } }, u.name),
                            sh ? React.createElement("div", { style: { fontSize: 11, color: tc === null || tc === void 0 ? void 0 : tc.col, marginTop: 1 } },
                                sh.type,
                                sh.project ? " \u00B7 ".concat(sh.project) : "",
                                " \u00B7 ",
                                sh.start,
                                "\u2013",
                                sh.end) : React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 1 } }, "Niet ingepland")),
                        cl && React.createElement(Chip, { label: cl.clockOut ? "✓" : "● Actief", color: cl.clockOut ? GRN : BLU }));
                })),
            React.createElement(Card, { style: { padding: "18px 20px" } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 13 } }, "\uD83C\uDFE2 Venues"),
                myV.map(function (v) {
                    var vU = myU.filter(function (u) { return (u.venueIds || []).includes(v.id); });
                    var vS = todayS.filter(function (s) { return s.venueId === v.id; });
                    return React.createElement("div", { key: v.id, onClick: function () { return go("venues"); }, style: { display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid ".concat(BOR), cursor: "pointer" } },
                        React.createElement("div", { style: { width: 32, height: 32, borderRadius: 8, background: v.color + "15", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, color: v.color } }, v.code),
                        React.createElement("div", { style: { flex: 1 } },
                            React.createElement("div", { style: { fontWeight: 600, fontSize: 13, color: TXT } }, v.name),
                            React.createElement("div", { style: { fontSize: 11, color: SUB } },
                                vU.length,
                                " personen \u00B7 ",
                                vS.length,
                                " diensten")));
                }))));
}
function DashEmp(_a) {
    var user = _a.user, allShifts = _a.allShifts, allClocks = _a.allClocks, customTypes = _a.customTypes;
    var todayS = allShifts.find(function (s) { return s.userId === user.id && s.date === TODAY; });
    var todayCl = allClocks.find(function (c) { return c.userId === user.id && c.date === TODAY; });
    var upcoming = allShifts.filter(function (s) { return s.userId === user.id && s.date >= TODAY; }).slice(0, 7);
    var weekH = allClocks.filter(function (c) { return c.userId === user.id && c.clockOut && c.date >= gd(-7); }).reduce(function (a, c) { return a + parseFloat(hH(c.clockIn, c.clockOut)); }, 0);
    var tc = todayS ? getTC(todayS.type, customTypes) : null;
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Hallo, ".concat(user.name.split(" ")[0], " \uD83D\uDC4B"), sub: new Date().toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 } },
            React.createElement(KPI, { icon: "\uD83D\uDCC5", label: "Komende taken", value: upcoming.length, color: PUR }),
            React.createElement(KPI, { icon: "\u23F1", label: "Uren deze week", value: weekH.toFixed(1) + "u", color: BLU })),
        todayS ? React.createElement(Card, { style: { padding: "20px 22px", marginBottom: 14, borderLeft: "4px solid ".concat(tc === null || tc === void 0 ? void 0 : tc.col) } },
            React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: tc === null || tc === void 0 ? void 0 : tc.col, textTransform: "uppercase", letterSpacing: .8, marginBottom: 7 } }, "Taak vandaag"),
            React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 20, color: TXT, letterSpacing: -.4 } }, todayS.type),
                    todayS.project && React.createElement("div", { style: { fontSize: 13, color: BLU, fontWeight: 600, marginTop: 2 } },
                        "\uD83D\uDCC1 ",
                        todayS.project,
                        todayS.client ? " \u00B7 ".concat(todayS.client) : ""),
                    React.createElement("div", { style: { fontSize: 13, color: SUB, marginTop: 2 } },
                        todayS.start,
                        " \u2013 ",
                        todayS.end,
                        " \u00B7 ",
                        hH(todayS.start, todayS.end),
                        " uur"),
                    todayS.note && React.createElement("div", { style: { fontSize: 12, color: MUT, marginTop: 3 } },
                        "\uD83D\uDCDD ",
                        todayS.note)),
                React.createElement("div", { style: { background: tc === null || tc === void 0 ? void 0 : tc.bg, borderRadius: 11, padding: "9px 14px", flexShrink: 0 } }, todayCl ? React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: tc === null || tc === void 0 ? void 0 : tc.col } }, todayCl.clockOut ? "\u2705 ".concat(todayCl.clockIn, "\u2013").concat(todayCl.clockOut) : "\u23F1 Actief \u00B7 ".concat(todayCl.clockIn)) : React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: AMB } }, "\u23F0 Nog niet ingeklokt")))) : React.createElement(EmptyState, { compact: true, title: "Geen taak vandaag", body: "Er staat vandaag nog niets gepland. Zodra planning een taak toevoegt, verschijnt die hier." }),
        React.createElement(Card, { style: { padding: "18px 20px" } },
            React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 12 } }, "Komende taken"),
            upcoming.length ? upcoming.map(function (s) {
                var c = getTC(s.type, customTypes);
                return React.createElement("div", { key: s.id, style: { display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: "1px solid ".concat(BOR) } },
                    React.createElement("div", { style: { width: 8, height: 8, borderRadius: "50%", background: c.col, flexShrink: 0 } }),
                    React.createElement("span", { style: { fontSize: 12, color: SUB, minWidth: 80 } }, fS(s.date)),
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement(Chip, { label: s.type, color: c.col }),
                        s.project && React.createElement("span", { style: { fontSize: 11, color: MUT, marginLeft: 6 } }, s.project)),
                    React.createElement("span", { style: { fontSize: 12, color: MUT } },
                        s.start,
                        "\u2013",
                        s.end));
            }) : React.createElement(EmptyState, { compact: true, title: "Geen komende taken", body: "Je planning is leeg. Nieuwe taken verschijnen hier automatisch zodra ze worden ingepland." })));
}
// ─── PRIKKLOK ─────────────────────────────────────────────────────────────────
function ClockPage(_a) {
    var user = _a.user, allClocks = _a.allClocks, setClocks = _a.setClocks, allShifts = _a.allShifts, customTypes = _a.customTypes, toast = _a.toast;
    var todayCl = allClocks.find(function (c) { return c.userId === user.id && c.date === TODAY; });
    var todaySh = allShifts.find(function (s) { return s.userId === user.id && s.date === TODAY; });
    var isAct = todayCl && !todayCl.clockOut;
    var hist = allClocks.filter(function (c) { return c.userId === user.id; }).slice(-7).reverse();
    var tc = todaySh ? getTC(todaySh.type, customTypes) : null;
    var doIn = function () { var t = new Date().toTimeString().slice(0, 5); setClocks(function (p) { return __spreadArray(__spreadArray([], p, true), [{ id: Date.now(), userId: user.id, venueId: user.primaryVenueId || "v1", date: TODAY, clockIn: t, clockOut: null }], false); }); toast("Ingeklokt!", "Welkom! Ingeklokt om ".concat(t, ".")); };
    var doOut = function () { var t = new Date().toTimeString().slice(0, 5); setClocks(function (p) { return p.map(function (c) { return c.userId === user.id && c.date === TODAY && !c.clockOut ? __assign(__assign({}, c), { clockOut: t }) : c; }); }); toast("Uitgeklokt!", "Tot morgen! Uitgetikt om ".concat(t, ".")); };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Prikklok", sub: "Registreer uw aan- en vertrekstijd" }),
        React.createElement(Card, { style: { padding: "34px 26px", textAlign: "center", marginBottom: 14 } },
            React.createElement(LiveClock, null),
            todaySh && React.createElement("div", { style: { marginTop: 16, display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "center", background: tc === null || tc === void 0 ? void 0 : tc.bg, padding: "10px 18px", borderRadius: 12 } },
                React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: tc === null || tc === void 0 ? void 0 : tc.col } },
                    todaySh.type,
                    todaySh.project ? " \u00B7 ".concat(todaySh.project) : ""),
                React.createElement("span", { style: { fontSize: 11, color: SUB } },
                    todaySh.start,
                    "\u2013",
                    todaySh.end),
                todaySh.note && React.createElement("span", { style: { fontSize: 11, color: MUT } },
                    "\uD83D\uDCDD ",
                    todaySh.note)),
            React.createElement("div", { style: { marginTop: 22, display: "flex", gap: 12, justifyContent: "center" } },
                !todayCl && React.createElement(Btn, { v: "success", lg: true, onClick: doIn }, "\u23F1 Inklokken"),
                isAct && React.createElement(Btn, { v: "danger", lg: true, onClick: doOut }, "\u23F9 Uitklokken"),
                todayCl && !isAct && React.createElement("div", { style: { background: GRNL, borderRadius: 12, padding: "12px 20px", display: "inline-flex", gap: 10, alignItems: "center", border: "1px solid ".concat(GRN, "30") } },
                    React.createElement("span", { style: { fontSize: 20 } }, "\u2705"),
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: GRN } }, "Compleet"),
                        React.createElement("div", { style: { fontSize: 12, color: SUB } },
                            todayCl.clockIn,
                            "\u2192",
                            todayCl.clockOut,
                            " \u00B7 ",
                            hH(todayCl.clockIn, todayCl.clockOut),
                            "u")))),
            isAct && React.createElement("div", { style: { marginTop: 9, fontSize: 12, color: SUB } },
                "Ingeklokt om ",
                React.createElement("strong", null, todayCl.clockIn))),
        React.createElement(Card, { style: { padding: "18px 20px" } },
            React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 12 } }, "Recente registraties"),
            hist.length ? hist.map(function (c) { return React.createElement("div", { key: c.id, style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 10px", background: BG, borderRadius: 8, marginBottom: 6, fontSize: 12 } },
                React.createElement("span", { style: { color: SUB, fontWeight: 500 } }, fD(c.date)),
                React.createElement("span", { style: { fontWeight: 600, color: TXT } },
                    c.clockIn,
                    " \u2192 ",
                    c.clockOut || "–"),
                React.createElement(Chip, { label: c.clockIn && c.clockOut ? hH(c.clockIn, c.clockOut) + "u" : "Actief", color: c.clockOut ? GRN : BLU })); }) : React.createElement(EmptyState, { compact: true, title: "Nog geen registraties", body: "Wanneer je voor het eerst inklokt, komt je geschiedenis hier te staan." })));
}
// ─── TIJDREGISTRATIES ─────────────────────────────────────────────────────────
function ClockingsPage(_a) {
    var user = _a.user, allUsers = _a.allUsers, allClocks = _a.allClocks, venues = _a.venues;
    var _b = useState(null), sel = _b[0], setSel = _b[1];
    var _c = useState("all"), fU = _c[0], setFU = _c[1];
    var myU = scopeU(allUsers, user);
    var myC = scopeC(allClocks, user, allUsers);
    var filtered = fU === "all" ? myC : myC.filter(function (c) { return c.userId === Number(fU); });
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Tijdregistraties", sub: "Overzicht van alle prikklok-data" }),
        myU.length ? React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 10, marginBottom: 18 } }, myU.map(function (u) {
            var tot = allClocks.filter(function (c) { return c.userId === u.id && c.clockOut; }).reduce(function (a, c) { return a + parseFloat(hH(c.clockIn, c.clockOut)); }, 0);
            return React.createElement("div", { key: u.id, onClick: function () { setSel(u); setFU(String(u.id)); }, style: { background: SUR, borderRadius: 12, padding: 13, textAlign: "center", cursor: "pointer", border: "2px solid ".concat((sel === null || sel === void 0 ? void 0 : sel.id) === u.id ? BLU : BOR), transition: "all .15s", boxShadow: SH } },
                React.createElement(Av, { u: u, sz: 32 }),
                React.createElement("div", { style: { fontWeight: 700, fontSize: 12, color: TXT, marginTop: 6 } }, u.name.split(" ")[0]),
                React.createElement("div", { style: { fontWeight: 800, fontSize: 20, color: BLU, marginTop: 2 } }, tot.toFixed(1)),
                React.createElement("div", { style: { fontSize: 10, color: MUT } }, "uren"));
        })) : React.createElement(EmptyState, { compact: true, title: "Nog geen medewerkers", body: "Er zijn nog geen medewerkers beschikbaar om tijdregistraties voor te tonen." }),
        React.createElement(Card, { style: { padding: "18px 20px" } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13, gap: 10, flexWrap: "wrap" } },
                React.createElement("span", { style: { fontWeight: 700, fontSize: 13 } }, "Registraties"),
                React.createElement("select", { value: fU, onChange: function (e) { setFU(e.target.value); setSel(null); }, style: { border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" } },
                    React.createElement("option", { value: "all" }, "Alle medewerkers"),
                    myU.map(function (u) { return React.createElement("option", { key: u.id, value: u.id }, u.name); }))),
            filtered.length ? __spreadArray([], filtered, true).reverse().map(function (c) {
                var u = allUsers.find(function (x) { return x.id === c.userId; });
                var v = venues.find(function (x) { return x.id === c.venueId; });
                return React.createElement("div", { key: c.id, onClick: function () { return u && setSel(u); }, style: { display: "flex", alignItems: "center", gap: 11, padding: "10px 11px", borderRadius: 9, marginBottom: 4, cursor: "pointer", background: c.date === TODAY ? BLUL : "transparent", border: c.date === TODAY ? "1px solid ".concat(BLUB) : "1px solid transparent" }, onMouseEnter: function (e) { return e.currentTarget.style.background = c.date === TODAY ? BLUL : BG; }, onMouseLeave: function (e) { return e.currentTarget.style.background = c.date === TODAY ? BLUL : "transparent"; } },
                    u && React.createElement(Av, { u: u, sz: 26 }),
                    React.createElement("span", { style: { flex: 1, fontWeight: 600, fontSize: 13, color: TXT } }, u === null || u === void 0 ? void 0 : u.name),
                    v && React.createElement(Chip, { label: v.code, color: v.color }),
                    React.createElement("span", { style: { fontSize: 12, color: SUB } }, fD(c.date)),
                    React.createElement("span", { style: { fontWeight: 600, fontSize: 13, minWidth: 110, textAlign: "center" } },
                        c.clockIn,
                        " \u2192 ",
                        c.clockOut || React.createElement("span", { style: { color: BLU } }, "Actief \u25CF")),
                    React.createElement(Chip, { label: c.clockIn && c.clockOut ? hH(c.clockIn, c.clockOut) + "u" : "●", color: c.clockOut ? GRN : BLU }));
            }) : React.createElement(EmptyState, { compact: true, title: "Geen tijdregistraties", body: "Er zijn nog geen prikklokregistraties voor deze selectie." })),
        sel && React.createElement(Modal, { title: "Detail \u2014 ".concat(sel.name), onClose: function () { return setSel(null); } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", background: BG, borderRadius: 11, marginBottom: 17 } },
                React.createElement(Av, { u: sel, sz: 46 }),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 15 } }, sel.name),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } },
                        sel.dept,
                        " \u00B7 ",
                        sel.email))),
            allClocks.filter(function (c) { return c.userId === sel.id; }).reverse().map(function (c) { return React.createElement("div", { key: c.id, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", background: BG, borderRadius: 8, marginBottom: 6, fontSize: 13 } },
                React.createElement("span", { style: { color: SUB } }, fD(c.date)),
                React.createElement("span", { style: { fontWeight: 600 } },
                    c.clockIn,
                    " \u2192 ",
                    c.clockOut || "Actief"),
                React.createElement(Chip, { label: c.clockIn && c.clockOut ? hH(c.clockIn, c.clockOut) + "u" : "●", color: c.clockOut ? GRN : BLU })); }),
            React.createElement("div", { style: { marginTop: 13, padding: "11px 13px", background: BLUL, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid ".concat(BLUB) } },
                React.createElement("span", { style: { fontSize: 13, fontWeight: 600 } }, "Totaal uren"),
                React.createElement("span", { style: { fontWeight: 800, fontSize: 17, color: BLU } },
                    allClocks.filter(function (c) { return c.userId === sel.id && c.clockOut; }).reduce(function (a, c) { return a + parseFloat(hH(c.clockIn, c.clockOut)); }, 0).toFixed(1),
                    " u"))));
}
// ─── PLANNING — vrije taakvelden per tenant ───────────────────────────────────
function PlanningPage(_a) {
    var user = _a.user, allUsers = _a.allUsers, allShifts = _a.allShifts, setShifts = _a.setShifts, venues = _a.venues, customTypes = _a.customTypes, setCustomTypes = _a.setCustomTypes, toast = _a.toast;
    var _b = useState(0), wk = _b[0], setWk = _b[1];
    var _c = useState(null), modal = _c[0], setModal = _c[1];
    var _d = useState({}), form = _d[0], setForm = _d[1];
    var _e = useState("rooster"), typeTab = _e[0], setTypeTab = _e[1];
    var _f = useState(false), typeModal = _f[0], setTypeModal = _f[1];
    var _g = useState({ name: "", color: VCOLS[4], icon: "🔧", desc: "" }), typeForm = _g[0], setTypeForm = _g[1];
    var isAdmin = isAdminRole(user.role);
    var myV = scopeV(venues, user);
    var myU = isAdmin ? scopeU(allUsers, user) : [];
    var viewU = isAdmin ? myU : [user];
    var myS = scopeS(allShifts, user, venues);
    var tenantTypes = customTypes.filter(function (t) { return t.tenantId === user.tenantId; });
    var allTypeNames = __spreadArray(["Dagdienst", "Vroegdienst", "Avonddienst", "Nachtdienst", "Vrij", "Verlof"], tenantTypes.map(function (t) { return t.name; }), true);
    var days = Array.from({ length: 7 }, function (_, i) { var d = new Date(); d.setDate(d.getDate() - d.getDay() + 1 + i + wk * 7); return d.toISOString().split("T")[0]; });
    var DN = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
    var save = function () {
        if (modal === "new")
            setShifts(function (p) { return __spreadArray(__spreadArray([], p, true), [__assign(__assign({}, form), { id: Date.now() })], false); });
        else
            setShifts(function (p) { return p.map(function (s) { return s.id === modal.id ? __assign(__assign({}, s), form) : s; }); });
        setModal(null);
        toast(modal === "new" ? "Taak toegevoegd!" : "Bijgewerkt!", "", "info");
    };
    var personalUpcoming = allShifts.filter(function (s) { return s.userId === user.id && s.date >= TODAY; }).slice(0, 10);
    if (!isAdmin)
        return React.createElement("div", null,
            React.createElement(PageHeader, { title: "Mijn Planning" }),
            personalUpcoming.length ? personalUpcoming.map(function (s) {
                var c = getTC(s.type, customTypes);
                return React.createElement(Card, { key: s.id, style: { padding: "14px 18px", marginBottom: 10, borderLeft: "4px solid ".concat(c.col) } },
                    s.date === TODAY && React.createElement(Chip, { label: "Vandaag", color: BLU }),
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 14, color: TXT, marginTop: s.date === TODAY ? 6 : 0 } }, fS(s.date)),
                    React.createElement("div", { style: { fontSize: 13, color: c.col, fontWeight: 600, marginTop: 3 } },
                        s.type,
                        " \u00B7 ",
                        s.start,
                        "\u2013",
                        s.end,
                        " \u00B7 ",
                        hH(s.start, s.end),
                        "u"),
                    s.project && React.createElement("div", { style: { fontSize: 12, color: BLU, marginTop: 2 } },
                        "\uD83D\uDCC1 ",
                        s.project,
                        s.client ? " \u00B7 ".concat(s.client) : ""),
                    s.note && React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 2 } },
                        "\uD83D\uDCDD ",
                        s.note),
                    s.billable && React.createElement(Chip, { label: "\uD83D\uDCBC Billable", color: PUR }));
            }) : React.createElement(EmptyState, { title: "Geen taken gepland", body: "Je hebt momenteel geen komende taken. Zodra planning iets toevoegt, verschijnt het hier automatisch." }));
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Planning & Taken", sub: "Weekrooster met vrije taakvelden per klant", action: React.createElement("div", { style: { display: "flex", gap: 7 } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setWk(function (w) { return w - 1; }); } }, "\u2190 Vorige"),
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setWk(0); } }, "Vandaag"),
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setWk(function (w) { return w + 1; }); } }, "Volgende \u2192"),
                React.createElement(Btn, { sm: true, onClick: function () { var _a, _b; setForm({ userId: ((_a = viewU[0]) === null || _a === void 0 ? void 0 : _a.id) || 1, venueId: ((_b = myV[0]) === null || _b === void 0 ? void 0 : _b.id) || "v1", date: TODAY, start: "08:00", end: "16:30", type: allTypeNames[0], taskTypeId: "", project: "", client: "", note: "", billable: false }); setModal("new"); } }, "+ Taak")) }),
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" } },
            React.createElement("span", { style: { fontSize: 12, color: SUB, fontWeight: 600 } }, "Taakvelden:"),
            tenantTypes.map(function (t) { return React.createElement("div", { key: t.id, style: { display: "flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: 20, background: t.color + "15", border: "1.5px solid ".concat(t.color, "30"), fontSize: 11, fontWeight: 600, color: t.color } },
                React.createElement("span", null, t.icon),
                React.createElement("span", null, t.name)); }),
            React.createElement(Btn, { sm: true, v: "ghost", onClick: function () { setTypeForm({ name: "", color: VCOLS[4], icon: "🔧", desc: "" }); setTypeModal(true); } }, "+ Taakveld")),
        React.createElement("div", { style: { overflowX: "auto" } },
            React.createElement("table", { style: { width: "100%", borderCollapse: "separate", borderSpacing: "3px 3px", minWidth: 700 } },
                React.createElement("thead", null,
                    React.createElement("tr", null,
                        React.createElement("th", { style: { padding: "9px 11px", textAlign: "left", fontSize: 11, fontWeight: 600, color: SUB, background: SUR, borderRadius: 10, minWidth: 130, border: "1px solid ".concat(BOR) } }, "Persoon"),
                        days.map(function (d, i) { var isT = d === TODAY; return React.createElement("th", { key: d, style: { padding: "8px 5px", textAlign: "center", fontSize: 10, fontWeight: 600, color: isT ? BLU : SUB, background: isT ? BLUL : SUR, borderRadius: 10, minWidth: 90, border: "1px solid ".concat(isT ? BLUB : BOR) } },
                            DN[i],
                            React.createElement("br", null),
                            React.createElement("span", { style: { fontWeight: 800, fontSize: 12, color: isT ? BLU : TXT } }, new Date(d).getDate())); }))),
                React.createElement("tbody", null, viewU.map(function (u) { return React.createElement("tr", { key: u.id },
                    React.createElement("td", { style: { padding: "5px 9px", background: SUR, borderRadius: 10, border: "1px solid ".concat(BOR) } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7 } },
                            React.createElement(Av, { u: u, sz: 24 }),
                            React.createElement("div", null,
                                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: TXT } }, u.name.split(" ")[0]),
                                React.createElement("div", { style: { fontSize: 9, color: MUT } }, u.role === "venue_manager" ? "Werfleider" : u.dept)))),
                    days.map(function (d) {
                        var ds = myS.filter(function (s) { return s.userId === u.id && s.date === d; });
                        return React.createElement("td", { key: d, style: { padding: 2, verticalAlign: "top", background: d === TODAY ? BLUL : "transparent", borderRadius: 6 } },
                            ds.map(function (s) {
                                var c = getTC(s.type, customTypes);
                                return React.createElement("div", { key: s.id, onClick: function () { setForm(__assign({}, s)); setModal(s); }, style: { background: c.bg, border: "1.5px solid ".concat(c.col, "20"), borderRadius: 7, padding: "4px 6px", cursor: "pointer", marginBottom: 2, transition: "all .12s" }, onMouseEnter: function (e) { return e.currentTarget.style.borderColor = c.col; }, onMouseLeave: function (e) { return e.currentTarget.style.borderColor = c.col + "20"; } },
                                    React.createElement("div", { style: { fontSize: 9, fontWeight: 700, color: c.col } }, s.type.slice(0, 8)),
                                    s.project && React.createElement("div", { style: { fontSize: 9, color: MUT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 75 } }, s.project),
                                    React.createElement("div", { style: { fontSize: 9, color: SUB } },
                                        s.start,
                                        "\u2013",
                                        s.end),
                                    s.billable && React.createElement("div", { style: { fontSize: 8, color: PUR, fontWeight: 700 } }, "\uD83D\uDCBC"));
                            }),
                            React.createElement("div", { onClick: function () { var _a; setForm({ userId: u.id, venueId: ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "v1", date: d, start: "08:00", end: "16:30", type: allTypeNames[0], taskTypeId: "", project: "", client: "", note: "", billable: false }); setModal("new"); }, style: { height: 24, borderRadius: 7, border: "1.5px dashed ".concat(BOR), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 12, color: MUT, transition: "all .12s" }, onMouseEnter: function (e) { e.currentTarget.style.borderColor = BLU; e.currentTarget.style.color = BLU; e.currentTarget.style.background = BLUL; }, onMouseLeave: function (e) { e.currentTarget.style.borderColor = BOR; e.currentTarget.style.color = MUT; e.currentTarget.style.background = ""; } }, "+"));
                    })); })))),
        modal && React.createElement(Modal, { title: modal === "new" ? "Taak toevoegen" : "Taak bewerken", wide: true, onClose: function () { return setModal(null); } },
            modal === "new" && React.createElement(Sel, { label: "Medewerker", opts: viewU.map(function (u) { return [u.id, u.name]; }), value: form.userId, onChange: function (e) { return setForm(__assign(__assign({}, form), { userId: Number(e.target.value) })); } }),
            modal === "new" && myV.length > 1 && React.createElement(Sel, { label: "Venue", opts: myV.map(function (v) { return [v.id, v.name]; }), value: form.venueId, onChange: function (e) { return setForm(__assign(__assign({}, form), { venueId: e.target.value })); } }),
            React.createElement(Inp, { label: "Datum", type: "date", value: form.date, onChange: function (e) { return setForm(__assign(__assign({}, form), { date: e.target.value })); } }),
            React.createElement(Sel, { label: "Type / Taakveld", opts: allTypeNames, value: form.type, onChange: function (e) { return setForm(__assign(__assign({}, form), { type: e.target.value })); } }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Inp, { label: "Start", type: "time", value: form.start, onChange: function (e) { return setForm(__assign(__assign({}, form), { start: e.target.value })); } }),
                React.createElement(Inp, { label: "Einde", type: "time", value: form.end, onChange: function (e) { return setForm(__assign(__assign({}, form), { end: e.target.value })); } })),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Inp, { label: "Project / Opdracht", value: form.project || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { project: e.target.value })); }, placeholder: "Bv: Renovatie hal 3" }),
                React.createElement(Inp, { label: "Klant", value: form.client || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { client: e.target.value })); }, placeholder: "Bv: Klant A BV" })),
            React.createElement(Inp, { label: "Notitie / instructies", value: form.note || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { note: e.target.value })); }, placeholder: "Optionele toelichting voor medewerker..." }),
            React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: form.billable ? PURL : BG, borderRadius: 10, marginBottom: 12, cursor: "pointer", border: "1.5px solid ".concat(form.billable ? PUR : BOR) } },
                React.createElement("input", { type: "checkbox", checked: !!form.billable, onChange: function (e) { return setForm(__assign(__assign({}, form), { billable: e.target.checked })); }, style: { width: 14, height: 14, accentColor: PUR } }),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 600, fontSize: 13 } }, "\uD83D\uDCBC Billable aan klant"),
                    React.createElement("div", { style: { fontSize: 11, color: SUB } }, "Uren worden doorgerekend"))),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                modal !== "new" && React.createElement(Btn, { v: "danger", sm: true, onClick: function () { setShifts(function (p) { return p.filter(function (s) { return s.id !== modal.id; }); }); setModal(null); toast("Verwijderd", "", "warn"); } }, "Verwijderen"),
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setModal(null); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, onClick: save }, modal === "new" ? "Toevoegen" : "Opslaan"))),
        typeModal && React.createElement(Modal, { title: "Nieuw taakveld aanmaken", onClose: function () { return setTypeModal(false); } },
            React.createElement("div", { style: { background: BLUL, borderRadius: 10, padding: "11px 14px", marginBottom: 14, fontSize: 12, color: BLU, border: "1px solid ".concat(BLUB) } }, "\uD83D\uDCA1 Taakvelden zijn vrij configureerbaar per bedrijf. Je kiest zelf de naam, kleur en icoon. Ze verschijnen als keuzeopties bij het aanmaken van taken."),
            React.createElement(Inp, { label: "Naam", value: typeForm.name, onChange: function (e) { return setTypeForm(__assign(__assign({}, typeForm), { name: e.target.value })); }, placeholder: "Bv: Schilderwerk, Route Noord, Vergadering..." }),
            React.createElement("div", { style: { marginBottom: 12 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 5, textTransform: "uppercase", letterSpacing: .6 } }, "Kleur"),
                React.createElement("div", { style: { display: "flex", gap: 7 } }, VCOLS.map(function (col) { return React.createElement("div", { key: col, onClick: function () { return setTypeForm(__assign(__assign({}, typeForm), { color: col })); }, style: { width: 26, height: 26, borderRadius: "50%", background: col, cursor: "pointer", border: "3px solid ".concat(typeForm.color === col ? "#000" : "transparent"), transition: "all .12s" } }); }))),
            React.createElement(Sel, { label: "Icoon", opts: [["🔧", "🔧 Gereedschap"], ["⚡", "⚡ Elektra"], ["🧱", "🧱 Bouw"], ["📋", "📋 Administratie"], ["📚", "📚 Opleiding"], ["🚗", "🚗 Transport"], ["🏗", "🏗 Werf"], ["🌿", "🌿 Groen"], ["🧹", "🧹 Schoonmaak"], ["📦", "📦 Logistiek"], ["💊", "💊 Zorg"], ["🍽", "🍽 Catering"]], value: typeForm.icon, onChange: function (e) { return setTypeForm(__assign(__assign({}, typeForm), { icon: e.target.value })); } }),
            React.createElement(Inp, { label: "Beschrijving (optioneel)", value: typeForm.desc, onChange: function (e) { return setTypeForm(__assign(__assign({}, typeForm), { desc: e.target.value })); }, placeholder: "Korte omschrijving van dit taakveld" }),
            typeForm.name && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "9px 13px", background: typeForm.color + "15", borderRadius: 10, marginBottom: 14, border: "1.5px solid ".concat(typeForm.color, "30") } },
                React.createElement("span", { style: { fontSize: 20 } }, typeForm.icon),
                React.createElement("span", { style: { fontWeight: 700, fontSize: 13, color: typeForm.color } }, typeForm.name),
                React.createElement("span", { style: { fontSize: 11, color: MUT } }, "\u2014 Voorbeeld")),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setTypeModal(false); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, disabled: !typeForm.name, onClick: function () { setCustomTypes(function (p) { return __spreadArray(__spreadArray([], p, true), [__assign({ id: "ct" + uid(), tenantId: user.tenantId || "t1" }, typeForm)], false); }); setTypeModal(false); toast("Taakveld aangemaakt!", typeForm.name); } }, "Aanmaken"))));
}
// ─── ONKOSTEN incl. KM-vergoeding en limieten ─────────────────────────────────
function ExpensesPage(_a) {
    var user = _a.user, allUsers = _a.allUsers, allExp = _a.allExp, setExp = _a.setExp, venues = _a.venues, vehicles = _a.vehicles, expLimits = _a.expLimits, toast = _a.toast;
    var _b = useState(null), sel = _b[0], setSel = _b[1];
    var _c = useState(false), modal = _c[0], setModal = _c[1];
    var _d = useState("all"), filter = _d[0], setFilter = _d[1];
    var _e = useState(""), rejectNote = _e[0], setRejectNote = _e[1];
    var _f = useState({ title: "", amount: "", date: TODAY, category: "overig", description: "", isBillable: false, clientName: "", venueId: user.primaryVenueId || "", vehicleId: "", kmCount: 0 }), form = _f[0], setForm = _f[1];
    var fRef = useRef();
    var isAdmin = isAdminRole(user.role);
    var myV = scopeV(venues, user);
    var mine = scopeE(allExp, user, allUsers).filter(function (e) { return isAdmin ? true : e.userId === user.id; });
    var filtered = filter === "all" ? mine : mine.filter(function (e) { return e.status === filter; });
    var totalSub = mine.filter(function (e) { return e.status === "submitted"; }).reduce(function (a, e) { return a + e.amount; }, 0);
    var totalPaid = mine.filter(function (e) { return e.status === "paid"; }).reduce(function (a, e) { return a + e.amount; }, 0);
    var appPct = mine.filter(function (e) { return e.status !== "draft"; }).length ? Math.round((mine.filter(function (e) { return ["approved", "paid"].includes(e.status); }).length / mine.filter(function (e) { return e.status !== "draft"; }).length) * 100) : 0;
    var myVehicles = vehicles.filter(function (v) { return myV.some(function (x) { return x.id === v.venueId; }); });
    var isKm = form.category === "kilometers";
    var kmAmt = isKm ? +(form.kmCount * KM_RATE).toFixed(2) : 0;
    var limit = expLimits[form.category];
    var overLimit = limit && parseFloat(form.amount) > limit;
    var save = function () {
        if (!form.title)
            return;
        var amt = isKm ? kmAmt : parseFloat(form.amount) || 0;
        setExp(function (p) { var _a; return __spreadArray(__spreadArray([], p, true), [__assign(__assign({}, form), { id: "e" + uid(), userId: user.id, amount: amt, status: "submitted", receiptName: ((_a = form.receiptFile) === null || _a === void 0 ? void 0 : _a.name) || "", reviewNote: "", kmCount: form.kmCount || 0, vehicleId: form.vehicleId || null })], false); });
        toast("Onkost ingediend!", form.title);
        setModal(false);
    };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Onkosten", sub: isAdmin ? "Beheer en goedkeuring" : "Mijn onkostennota's", action: React.createElement(Btn, { sm: true, onClick: function () { var _a; setForm({ title: "", amount: "", date: TODAY, category: "overig", description: "", isBillable: false, clientName: "", venueId: user.primaryVenueId || ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "", vehicleId: "", kmCount: 0 }); setModal(true); } }, "+ Indienen") }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 11, marginBottom: 18 } }, [{ l: "Te behandelen", v: "\u20AC".concat(totalSub.toFixed(0)), c: AMB, f: "submitted" }, { l: "Uitbetaald", v: "\u20AC".concat(totalPaid.toFixed(0)), c: GRN, f: "paid" }, { l: "Goedkeuringsgraad", v: "".concat(appPct, "%"), c: BLU, f: "approved" }, { l: "Totaal", v: mine.filter(function (e) { return e.status !== "draft"; }).length, c: SUB, f: "all" }].map(function (s) { return React.createElement("div", { key: s.l, onClick: function () { return setFilter(s.f); }, style: { background: SUR, borderRadius: 12, padding: "15px 16px", border: "1.5px solid ".concat(filter === s.f ? s.c : BOR), cursor: "pointer", transition: "all .15s", boxShadow: filter === s.f ? "0 0 0 3px ".concat(s.c, "15") : SH } },
            React.createElement("div", { style: { fontWeight: 800, fontSize: 20, color: TXT, letterSpacing: -.4 } }, s.v),
            React.createElement("div", { style: { fontSize: 11, color: SUB, marginTop: 3 } }, s.l)); })),
        React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 13, flexWrap: "wrap" } }, [["all", "Alle"], ["submitted", "Ingediend"], ["approved", "Goedgekeurd"], ["rejected", "Afgewezen"], ["paid", "Uitbetaald"]].map(function (_a) {
            var v = _a[0], l = _a[1];
            return React.createElement("button", { key: v, onClick: function () { return setFilter(v); }, style: { padding: "5px 12px", borderRadius: 20, border: "1.5px solid ".concat(filter === v ? (SCOL[v] || NAV_BG) : BOR), background: filter === v ? (SCOL[v] || NAV_BG) + "15" : "transparent", color: filter === v ? (SCOL[v] || NAV_BG) : SUB, fontSize: 11, fontWeight: 600, cursor: "pointer" } }, l);
        })),
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } },
            filtered.length ? filtered.map(function (e) {
                var sub = allUsers.find(function (u) { return u.id === e.userId; });
                var v = venues.find(function (x) { return x.id === e.venueId; });
                var sc = SCOL[e.status] || MUT;
                var lim = expLimits[e.category];
                var over = lim && e.amount > lim;
                return React.createElement(Card, { key: e.id, onClick: function () { return setSel(e); }, style: { padding: "13px 17px", borderLeft: "4px solid ".concat(sc) } },
                    React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 11 } },
                        React.createElement("div", { style: { flex: 1 } },
                            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 } },
                                React.createElement("span", { style: { fontSize: 17 } }, CAT_IC[e.category] || "📋"),
                                React.createElement("span", { style: { fontWeight: 700, fontSize: 14, color: TXT } }, e.title),
                                React.createElement(SChip, { label: EXP_ST[e.status], sk: e.status }),
                                e.isBillable && React.createElement(Chip, { label: "\uD83D\uDCBC Billable", color: PUR }),
                                over && React.createElement(Chip, { label: "\u26A0 Boven limiet (\u20AC".concat(lim, ")"), color: RED }),
                                e.kmCount > 0 && React.createElement(Chip, { label: "\uD83D\uDE97 ".concat(e.kmCount, " km"), color: TEAL })),
                            React.createElement("div", { style: { fontSize: 12, color: SUB } },
                                e.category,
                                " \u00B7 ",
                                fD(e.date),
                                e.receiptName && React.createElement("span", { style: { color: BLU } },
                                    " \u00B7 \uD83D\uDCCE ",
                                    e.receiptName)),
                            e.reviewNote && React.createElement("div", { style: { fontSize: 11, color: RED, marginTop: 3 } },
                                "\u26A0 ",
                                e.reviewNote)),
                        React.createElement("div", { style: { textAlign: "right", flexShrink: 0 } },
                            React.createElement("div", { style: { fontWeight: 800, fontSize: 17, color: over ? RED : TXT, letterSpacing: -.3 } },
                                "\u20AC",
                                e.amount.toFixed(2)),
                            isAdmin && sub && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5, marginTop: 5, justifyContent: "flex-end" } },
                                React.createElement(Av, { u: sub, sz: 18 }),
                                React.createElement("span", { style: { fontSize: 11, color: SUB } }, sub.name.split(" ")[0])),
                            v && React.createElement(Chip, { label: v.code, color: v.color }))));
            }) : React.createElement(EmptyState, { title: filter === "all" ? "Nog geen onkosten" : "Geen onkosten in deze status", body: filter === "all" ? "Wanneer iemand een onkost indient, verschijnt die hier voor opvolging en goedkeuring." : "Deze filter bevat momenteel geen resultaten.", action: React.createElement(Btn, { sm: true, onClick: function () { var _a; setForm({ title: "", amount: "", date: TODAY, category: "overig", description: "", isBillable: false, clientName: "", venueId: user.primaryVenueId || ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "", vehicleId: "", kmCount: 0 }); setModal(true); } }, "+ Onkost indienen") })),
        sel && (function () {
            var sub = allUsers.find(function (u) { return u.id === sel.userId; });
            var v = venues.find(function (x) { return x.id === sel.venueId; });
            var lim = expLimits[sel.category];
            var over = lim && sel.amount > lim;
            return React.createElement(Modal, { title: "".concat(CAT_IC[sel.category] || "📋", " ").concat(sel.title), wide: true, onClose: function () { return setSel(null); } },
                over && React.createElement("div", { style: { background: REDL, border: "1.5px solid ".concat(RED, "30"), borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: RED, fontWeight: 600 } },
                    "\u26A0 Bedrag overschrijdt limiet van \u20AC",
                    lim,
                    " voor categorie \"",
                    sel.category,
                    "\""),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9, marginBottom: 13 } }, [["Bedrag", "\u20AC".concat(sel.amount.toFixed(2))], ["Status", sel.status], ["Datum", fD(sel.date)], ["Categorie", sel.category], ["Venue", (v === null || v === void 0 ? void 0 : v.name) || "—"], ["Billable", sel.isBillable ? "Ja" + (sel.clientName ? " \u00B7 ".concat(sel.clientName) : "") : "Nee"]].map(function (_a) {
                    var k = _a[0], val = _a[1];
                    return React.createElement("div", { key: k, style: { padding: "9px 11px", background: BG, borderRadius: 9 } },
                        React.createElement("div", { style: { fontSize: 10, color: MUT, fontWeight: 600, textTransform: "uppercase", marginBottom: 3 } }, k),
                        React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, k === "Status" ? React.createElement(SChip, { label: EXP_ST[val], sk: val }) : val));
                })),
                sel.kmCount > 0 && React.createElement("div", { style: { padding: "10px 14px", background: TEAL + "15", borderRadius: 9, fontSize: 12, color: TEAL, fontWeight: 600, marginBottom: 10, border: "1px solid ".concat(TEAL, "30") } },
                    "\uD83D\uDE97 ",
                    sel.kmCount,
                    " km \u00D7 \u20AC",
                    KM_RATE,
                    " = \u20AC",
                    (sel.kmCount * KM_RATE).toFixed(2)),
                sub && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", background: BG, borderRadius: 10, marginBottom: 12 } },
                    React.createElement(Av, { u: sub, sz: 36 }),
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, sub.name),
                        React.createElement("div", { style: { fontSize: 11, color: SUB } }, sub.dept))),
                sel.description && React.createElement("div", { style: { marginBottom: 11, padding: "9px 13px", background: BG, borderRadius: 9, fontSize: 13 } }, sel.description),
                sel.receiptName && React.createElement("div", { style: { marginBottom: 11, padding: "9px 13px", background: BLUL, borderRadius: 9, fontSize: 12, color: BLU, border: "1px solid ".concat(BLUB) } },
                    "\uD83D\uDCCE ",
                    sel.receiptName),
                sel.reviewNote && React.createElement("div", { style: { marginBottom: 11, padding: "9px 13px", background: REDL, borderRadius: 9, fontSize: 12, color: RED } },
                    "\u26A0 ",
                    sel.reviewNote),
                isAdmin && sel.status === "submitted" && React.createElement(Inp, { label: "Reden bij afwijzing", value: rejectNote, onChange: function (e) { return setRejectNote(e.target.value); }, placeholder: "Optioneel..." }),
                React.createElement("div", { style: { display: "flex", gap: 7, justifyContent: "flex-end", flexWrap: "wrap" } },
                    isAdmin && sel.status === "submitted" && React.createElement(React.Fragment, null,
                        React.createElement(Btn, { v: "success", sm: true, onClick: function () { setExp(function (p) { return p.map(function (e) { return e.id === sel.id ? __assign(__assign({}, e), { status: "approved" }) : e; }); }); setSel(null); toast("Goedgekeurd!"); } }, "\u2713 Goedkeuren"),
                        React.createElement(Btn, { v: "danger", sm: true, onClick: function () { setExp(function (p) { return p.map(function (e) { return e.id === sel.id ? __assign(__assign({}, e), { status: "rejected", reviewNote: rejectNote || "Geen reden" }) : e; }); }); setSel(null); toast("Geweigerd", "", "err"); } }, "\u2715 Afwijzen")),
                    isAdmin && sel.status === "approved" && React.createElement(Btn, { v: "accent", sm: true, onClick: function () { setExp(function (p) { return p.map(function (e) { return e.id === sel.id ? __assign(__assign({}, e), { status: "paid" }) : e; }); }); setSel(null); toast("Uitbetaald!", "", "info"); } }, "\uD83D\uDCB0 Uitbetaald"),
                    React.createElement(Btn, { v: "subtle", sm: true, onClick: function () { return setSel(null); } }, "Sluiten")));
        }),
        modal && React.createElement(Modal, { title: "Onkost indienen", wide: true, onClose: function () { return setModal(false); } },
            React.createElement(Inp, { label: "Omschrijving *", value: form.title, onChange: function (e) { return setForm(__assign(__assign({}, form), { title: e.target.value })); }, placeholder: "Bv: Brandstof bestelwagen" }),
            React.createElement(Sel, { label: "Categorie", opts: Object.entries(CAT_IC).map(function (_a) {
                    var c = _a[0], ic = _a[1];
                    return [c, "".concat(ic, " ").concat(c.charAt(0).toUpperCase() + c.slice(1))];
                }), value: form.category, onChange: function (e) { return setForm(__assign(__assign({}, form), { category: e.target.value, kmCount: 0, amount: "" })); } }),
            isKm ? (React.createElement("div", null,
                React.createElement(Inp, { label: "Aantal kilometer", type: "number", value: form.kmCount, onChange: function (e) { return setForm(__assign(__assign({}, form), { kmCount: +e.target.value })); }, placeholder: "0" }),
                React.createElement("div", { style: { background: TEAL + "15", border: "1px solid ".concat(TEAL, "30"), borderRadius: 9, padding: "9px 13px", marginBottom: 12, fontSize: 12, color: TEAL, fontWeight: 600 } },
                    "\uD83D\uDE97 ",
                    form.kmCount || 0,
                    " km \u00D7 \u20AC",
                    KM_RATE,
                    " = ",
                    React.createElement("strong", null,
                        "\u20AC",
                        ((form.kmCount || 0) * KM_RATE).toFixed(2)),
                    " \u2014 Belgisch fiscaal tarief 2026"))) : (React.createElement("div", null,
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                    React.createElement(Inp, { label: "Bedrag (\u20AC) *", type: "number", value: form.amount, onChange: function (e) { return setForm(__assign(__assign({}, form), { amount: e.target.value })); }, placeholder: "0.00" }),
                    React.createElement(Inp, { label: "Datum", type: "date", value: form.date, onChange: function (e) { return setForm(__assign(__assign({}, form), { date: e.target.value })); } })),
                overLimit && React.createElement("div", { style: { background: REDL, borderRadius: 9, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: RED, fontWeight: 600 } },
                    "\u26A0 Bedrag overschrijdt de limiet van \u20AC",
                    limit,
                    " voor ",
                    form.category))),
            myVehicles.length > 0 && (form.category === "brandstof" || isKm) && React.createElement(Sel, { label: "Voertuig (optioneel)", opts: __spreadArray([["", "— Geen voertuig —"]], myVehicles.map(function (v) { return [v.id, "".concat(v.plate, " \u00B7 ").concat(v.brand)]; }), true), value: form.vehicleId, onChange: function (e) { return setForm(__assign(__assign({}, form), { vehicleId: e.target.value })); } }),
            myV.length > 1 && React.createElement(Sel, { label: "Venue", opts: myV.map(function (v) { return [v.id, v.name]; }), value: form.venueId, onChange: function (e) { return setForm(__assign(__assign({}, form), { venueId: e.target.value })); } }),
            React.createElement(Inp, { label: "Toelichting", ta: true, rows: 2, value: form.description || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { description: e.target.value })); }, placeholder: "Optioneel..." }),
            React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: form.isBillable ? PURL : BG, borderRadius: 10, marginBottom: 12, cursor: "pointer", border: "1.5px solid ".concat(form.isBillable ? PUR : BOR) } },
                React.createElement("input", { type: "checkbox", checked: !!form.isBillable, onChange: function (e) { return setForm(__assign(__assign({}, form), { isBillable: e.target.checked })); }, style: { width: 14, height: 14, accentColor: PUR } }),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 600, fontSize: 13 } }, "Doorrekenen aan klant"),
                    React.createElement("div", { style: { fontSize: 11, color: SUB } }, "Billable kost"))),
            form.isBillable && React.createElement(Inp, { label: "Klantnaam", value: form.clientName || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { clientName: e.target.value })); } }),
            !isKm && React.createElement("div", { style: { marginBottom: 13 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 5, textTransform: "uppercase", letterSpacing: .6 } }, "Bon uploaden"),
                React.createElement("div", { onClick: function () { var _a; return (_a = fRef.current) === null || _a === void 0 ? void 0 : _a.click(); }, style: { border: "2px dashed #E8E4DC", borderRadius: 11, padding: "14px", textAlign: "center", cursor: "pointer", transition: "all .15s", background: form.receiptFile ? GRNL : BG }, onMouseEnter: function (e) { return e.currentTarget.style.borderColor = BLU; }, onMouseLeave: function (e) { return e.currentTarget.style.borderColor = BOR; } },
                    form.receiptFile ? React.createElement("div", { style: { fontSize: 13, color: GRN, fontWeight: 600 } },
                        "\uD83D\uDCCE ",
                        form.receiptFile.name) : React.createElement("div", null,
                        React.createElement("div", { style: { fontSize: 18, marginBottom: 4 } }, "\uD83E\uDDFE"),
                        React.createElement("div", { style: { fontSize: 12, color: SUB, fontWeight: 600 } }, "Klik om bon te uploaden"),
                        React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 2 } }, "JPG, PNG of PDF")),
                    React.createElement("input", { ref: fRef, type: "file", accept: ".jpg,.jpeg,.png,.pdf", style: { display: "none" }, onChange: function (e) { return setForm(__assign(__assign({}, form), { receiptFile: e.target.files[0] })); } }))),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setModal(false); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, onClick: save, disabled: !form.title || (!isKm && !form.amount) }, "Indienen voor goedkeuring"))));
}
// ─── VENUES ───────────────────────────────────────────────────────────────────
function VenuesPage(_a) {
    var user = _a.user, venues = _a.venues, setVenues = _a.setVenues, allUsers = _a.allUsers, toast = _a.toast;
    var _b = useState(false), modal = _b[0], setModal = _b[1];
    var _c = useState(null), editV = _c[0], setEditV = _c[1];
    var _d = useState({ name: "", code: "", color: VCOLS[0], address: "", active: true, tenantId: user.tenantId || "t1" }), form = _d[0], setForm = _d[1];
    var myV = scopeV(venues, user);
    var save = function () { if (!form.name)
        return; editV ? setVenues(function (p) { return p.map(function (v) { return v.id === editV.id ? __assign(__assign({}, v), form) : v; }); }) : setVenues(function (p) { return __spreadArray(__spreadArray([], p, true), [__assign(__assign({}, form), { id: "v" + uid() })], false); }); toast(editV ? "Venue bijgewerkt!" : "Venue aangemaakt!"); setModal(false); setEditV(null); };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Venues", sub: "".concat(myV.length, " locaties beheerd"), action: React.createElement(Btn, { sm: true, onClick: function () { setEditV(null); setForm({ name: "", code: "", color: VCOLS[0], address: "", active: true, tenantId: user.tenantId || "t1" }); setModal(true); } }, "+ Venue") }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 } }, myV.length ? myV.map(function (v) {
            var vU = allUsers.filter(function (u) { return (u.venueIds || []).includes(v.id); });
            return React.createElement(Card, { key: v.id, onClick: function () { setEditV(v); setForm(__assign({}, v)); setModal(true); }, style: { padding: "18px 20px", borderTop: "3px solid ".concat(v.color) } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 } },
                    React.createElement("div", { style: { width: 40, height: 40, borderRadius: 11, background: v.color + "15", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: v.color } }, v.code),
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 800, fontSize: 15, color: TXT } }, v.name),
                        React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 2 } }, v.address))),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
                    React.createElement("div", { style: { background: BG, borderRadius: 8, padding: "9px 10px", textAlign: "center" } },
                        React.createElement("div", { style: { fontWeight: 800, fontSize: 20, color: v.color } }, vU.length),
                        React.createElement("div", { style: { fontSize: 10, color: MUT } }, "personen")),
                    React.createElement("div", { style: { background: BG, borderRadius: 8, padding: "9px 10px", display: "flex", alignItems: "center", justifyContent: "center" } },
                        React.createElement(Chip, { label: v.active ? "Actief" : "Inactief", color: v.active ? GRN : MUT }))));
        }) : React.createElement(EmptyState, { title: "Nog geen venues", body: "Maak de eerste locatie, werf of vestiging aan zodat planning, medewerkers en stock een duidelijke plek krijgen.", action: React.createElement(Btn, { sm: true, onClick: function () { setEditV(null); setForm({ name: "", code: "", color: VCOLS[0], address: "", active: true, tenantId: user.tenantId || "t1" }); setModal(true); } }, "+ Venue aanmaken") })),
        modal && React.createElement(Modal, { title: editV ? "Venue bewerken" : "Venue toevoegen", onClose: function () { setModal(false); setEditV(null); } },
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 80px", gap: 12 } },
                React.createElement(Inp, { label: "Naam", value: form.name, onChange: function (e) { return setForm(__assign(__assign({}, form), { name: e.target.value })); } }),
                React.createElement(Inp, { label: "Code", value: form.code, onChange: function (e) { return setForm(__assign(__assign({}, form), { code: e.target.value.toUpperCase().slice(0, 3) })); } })),
            React.createElement("div", { style: { marginBottom: 12 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 6, textTransform: "uppercase", letterSpacing: .6 } }, "Kleur"),
                React.createElement("div", { style: { display: "flex", gap: 8 } }, VCOLS.map(function (col) { return React.createElement("div", { key: col, onClick: function () { return setForm(__assign(__assign({}, form), { color: col })); }, style: { width: 26, height: 26, borderRadius: "50%", background: col, cursor: "pointer", border: "3px solid ".concat(form.color === col ? "#000" : "transparent"), transition: "all .12s" } }); }))),
            React.createElement(Inp, { label: "Adres", value: form.address || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { address: e.target.value })); } }),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { setModal(false); setEditV(null); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, onClick: save }, editV ? "Opslaan" : "Aanmaken"))));
}
// ─── MEDEWERKERS — met rollen en module-permissies ────────────────────────────
function EmployeesPage(_a) {
    var user = _a.user, allUsers = _a.allUsers, setUsers = _a.setUsers, venues = _a.venues, toast = _a.toast, customRoles = _a.customRoles, setCustomRoles = _a.setCustomRoles, setAuditLogs = _a.setAuditLogs, adminRolePolicy = _a.adminRolePolicy;
    var _b = useState(null), sel = _b[0], setSel = _b[1];
    var _c = useState(false), modal = _c[0], setModal = _c[1];
    var _d = useState({ name: "", dept: "", email: "", phone: "", role: "employee", primaryVenueId: "", hue: Math.floor(Math.random() * 360), permissions: ROLE_DEFAULTS.employee }), form = _d[0], setForm = _d[1];
    var _e = useState(false), roleModal = _e[0], setRoleModal = _e[1];
    var _f = useState({ name: "", desc: "", permissions: ["messages"], actions: ["view"], scope: "venue", sensitivity: "internal" }), roleForm = _f[0], setRoleForm = _f[1];
    var _g = useState(null), editRole = _g[0], setEditRole = _g[1];
    var myV = scopeV(venues, user);
    var myU = scopeU(allUsers, user);
    var PERM_LABELS = { planning: "📅 Planning", clockings: "⏱ Tijdregistraties", expenses: "💸 Onkosten", workorders: "📋 Werkbonnen", stock: "📦 Stock", vehicles: "🚗 Wagenpark", leaves: "🏖 Verlof", messages: "💬 Berichten", reports: "📊 Rapportages", integrations: "🔗 Integraties", billing: "💳 Billing", employees: "👥 Medewerkers", venues: "🏢 Venues", customers: "🤝 Klanten", settings: "⚙ Instellingen", audit: "🧾 Auditlog" };
    var ACTION_LABELS = { view: "Bekijken", create: "Aanmaken", update: "Wijzigen", delete: "Verwijderen", approve: "Goedkeuren", export: "Exporteren" };
    var SCOPE_LABELS = { own: "Alleen eigen data", team: "Teamdata", venue: "Venue scope", tenant: "Hele tenant", all: "Alle tenants" };
    var SENS_LABELS = { public: "Publiek", internal: "Intern", confidential: "Vertrouwelijk", payroll: "Loon/HR gevoelig", financial: "Financieel gevoelig" };
    var myRoles = (customRoles || []).filter(function (r) { return user.role === "super_admin" ? true : r.tenantId === user.tenantId; });
    var roleName = function (r) { var _a; return ROLE_LABELS[r] || (((_a = myRoles.find(function (x) { return x.id === r; })) === null || _a === void 0 ? void 0 : _a.name) || r); };
    var roleOptions = __spreadArray([["employee", "👤 Medewerker"], ["venue_manager", "🏗 Werfleider / Ploegbaas"], ["tenant_admin", "🔑 Admin"]], myRoles.map(function (r) { return [r.id, "◈ " + r.name]; }), true);
    var canEditEmployees = user.role === "tenant_admin" || user.role === "super_admin" || ((user.actions || []).includes("update") && hasPerm(user, "employees"));
    var canCreateEmployees = user.role === "tenant_admin" || user.role === "super_admin" || ((user.actions || []).includes("create") && hasPerm(user, "employees"));
    var roleDefaults = function (role) {
        if (role === "tenant_admin" || role === "super_admin")
            return role === "tenant_admin" ? (adminRolePolicy || { actions: Object.keys(ACTION_LABELS), scope: "tenant", sensitivity: "financial", permissions: ALL_PERMS }) : { actions: Object.keys(ACTION_LABELS), scope: "all", sensitivity: "financial", permissions: ALL_PERMS };
        if (role === "venue_manager")
            return { actions: ["view", "create", "update", "approve"], scope: "venue", sensitivity: "confidential" };
        var cr = myRoles.find(function (r) { return r.id === role; });
        return { actions: (cr === null || cr === void 0 ? void 0 : cr.actions) || ["view"], scope: (cr === null || cr === void 0 ? void 0 : cr.scope) || "venue", sensitivity: (cr === null || cr === void 0 ? void 0 : cr.sensitivity) || "internal" };
    };
    myU = myU.map(function (u) { return u.role === "tenant_admin" ? __assign(__assign(__assign({}, u), roleDefaults("tenant_admin")), { permissions: ((adminRolePolicy || {}).permissions || ALL_PERMS) }) : u; });
    var auditRightChange = function (target, field, oldValue, newValue) {
        if (!setAuditLogs)
            return;
        setAuditLogs(function (p) { return __spreadArray(__spreadArray([], p || [], true), [{ id: "al_" + uid(), at: TODAY, time: new Date().toTimeString().slice(0, 5), actor: user.name, action: "Rechten gewijzigd", area: "Rechten", detail: "".concat(target.name, " - ").concat(field, ": ").concat(JSON.stringify(oldValue), " -> ").concat(JSON.stringify(newValue)), severity: "warn" }], false).slice(-140); });
    };
    var resetRoleForm = function () {
        setEditRole(null);
        setRoleForm({ name: "", desc: "", permissions: ["messages"], actions: ["view"], scope: "venue", sensitivity: "internal" });
    };
    var openNewRole = function () {
        resetRoleForm();
        setRoleModal(true);
    };
    var openRoleEditor = function (role) {
        if (!role || String(role.id).indexOf("cr_") !== 0)
            return;
        setEditRole(role);
        setRoleForm({ name: role.name || "", desc: role.desc || "", permissions: role.permissions || [], actions: role.actions || ["view"], scope: role.scope || "venue", sensitivity: role.sensitivity || "internal" });
        setRoleModal(true);
    };
    var updateSelected = function (patch) {
        if (!sel)
            return;
        setUsers(function (p) { return p.map(function (u) { return u.id === sel.id ? __assign(__assign({}, u), patch) : u; }); });
        setSel(function (s) { return (__assign(__assign({}, s), patch)); });
    };
    var changeSelectedRole = function (role) {
        var _a;
        if (!sel)
            return;
        var custom = myRoles.find(function (r) { return r.id === role; });
        var meta = roleDefaults(role);
        var permissions = custom ? custom.permissions : role === "tenant_admin" ? ((adminRolePolicy || {}).permissions || ALL_PERMS) : ((_a = ROLE_DEFAULTS[role]) !== null && _a !== void 0 ? _a : []);
        updateSelected(__assign(__assign({}, meta), { role: role, permissions: permissions }));
        auditRightChange(sel, "rol", sel.role, role);
    };
    var saveRole = function () {
        if (!roleForm.name.trim())
            return;
        var payload = __assign(__assign({}, roleForm), { permissions: roleForm.permissions || [], actions: roleForm.actions || ["view"], scope: roleForm.scope || "venue", sensitivity: roleForm.sensitivity || "internal" });
        if (editRole) {
            setCustomRoles(function (p) { return (p || []).map(function (r) { return r.id === editRole.id ? __assign(__assign({}, r), payload) : r; }); });
            setUsers(function (p) { return p.map(function (u) { return u.role === editRole.id ? __assign(__assign({}, u), { permissions: payload.permissions, actions: payload.actions, scope: payload.scope, sensitivity: payload.sensitivity }) : u; }); });
            auditRightChange({ name: payload.name }, "vrije rol", editRole, payload);
            toast("Rol bijgewerkt", payload.name, "info");
        }
        else {
            var id = "cr_" + uid();
            setCustomRoles(function (p) { return __spreadArray(__spreadArray([], p || [], true), [__assign({ id: id, tenantId: user.tenantId || "t1" }, payload)], false); });
            toast("Rol aangemaakt", roleForm.name, "info");
        }
        resetRoleForm();
        setRoleModal(false);
    };
    var deleteRole = function () {
        if (!editRole)
            return;
        setCustomRoles(function (p) { return (p || []).filter(function (r) { return r.id !== editRole.id; }); });
        setUsers(function (p) { return p.map(function (u) { return u.role === editRole.id ? __assign(__assign({}, u), { role: "employee", permissions: ROLE_DEFAULTS.employee, actions: ["view"], scope: "own", sensitivity: "internal" }) : u; }); });
        auditRightChange({ name: editRole.name }, "vrije rol verwijderd", editRole, "employee fallback");
        toast("Rol verwijderd", editRole.name, "warn");
        resetRoleForm();
        setRoleModal(false);
    };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Medewerkers", sub: "".concat(myU.length, " personen · vrije rollen & module-rechten"), action: React.createElement("div", { style: { display: "flex", gap: 8 } },
                canEditEmployees && React.createElement(Btn, { sm: true, v: "ghost", onClick: openNewRole }, "+ Rol maken"),
                canCreateEmployees && React.createElement(Btn, { sm: true, onClick: function () { var _a; setForm(__assign({ name: "", dept: "", email: "", phone: "", role: "employee", primaryVenueId: ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "", hue: Math.floor(Math.random() * 360), permissions: ROLE_DEFAULTS.employee }, roleDefaults("employee"))); setModal(true); } }, "+ Uitnodigen")) }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10, marginBottom: 14 } }, __spreadArray([
            { id: "employee", name: "Medewerker", desc: "Basisrechten voor veldmedewerkers", permissions: ROLE_DEFAULTS.employee },
            { id: "venue_manager", name: "Werfleider", desc: "Team en locatiebeheer", permissions: ROLE_DEFAULTS.venue_manager },
            { id: "tenant_admin", name: "Admin", desc: "Beheerd door Super Admin", permissions: (adminRolePolicy || {}).permissions || ALL_PERMS }
        ], myRoles, true).map(function (r) { var editableRole = canEditEmployees && String(r.id).indexOf("cr_") === 0; var meta = { actions: r.actions || roleDefaults(r.id).actions, scope: r.scope || roleDefaults(r.id).scope, sensitivity: r.sensitivity || roleDefaults(r.id).sensitivity }; return React.createElement(Card, { key: r.id, onClick: editableRole ? function () { return openRoleEditor(r); } : undefined, style: { padding: "12px 14px", cursor: editableRole ? "pointer" : "default" } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 } },
                React.createElement("div", { style: { fontWeight: 800, fontSize: 13, color: TXT } }, r.name),
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                    editableRole && React.createElement("span", { style: { fontSize: 10, color: PUR, fontWeight: 800 } }, "Bewerk"),
                    React.createElement(Chip, { label: "".concat((r.permissions || []).length, " rechten"), color: r.id.indexOf("cr_") === 0 ? PUR : BLU }))),
            React.createElement("div", { style: { fontSize: 11, color: SUB, lineHeight: 1.45 } }, r.desc || "Systeemrol"),
            React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 } },
                React.createElement(Chip, { label: SCOPE_LABELS[meta.scope], color: BLU }),
                React.createElement(Chip, { label: SENS_LABELS[meta.sensitivity], color: AMB }),
                React.createElement(Chip, { label: "".concat((meta.actions || []).length, " acties"), color: GRN })),
            React.createElement("div", { style: { display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 } }, (r.permissions || []).slice(0, 5).map(function (p) { return React.createElement("span", { key: p, style: { fontSize: 9, color: SUB, background: BG, border: "1px solid ".concat(BOR), borderRadius: 10, padding: "1px 6px" } }, p); }))); })),
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } }, myU.length ? myU.map(function (u) {
            var uV = myV.filter(function (v) { return (u.venueIds || []).includes(v.id); });
            return React.createElement(Card, { key: u.id, onClick: function () { return setSel(u); }, style: { padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 } },
                React.createElement(Av, { u: u, sz: 42 }),
                React.createElement("div", { style: { flex: 1 } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                        React.createElement("div", { style: { fontWeight: 700, fontSize: 14, color: TXT } }, u.name),
                        React.createElement(Chip, { label: roleName(u.role), color: u.role.indexOf("cr_") === 0 ? PUR : BLU })),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } },
                        u.dept,
                        " \u00B7 ",
                        u.email),
                    React.createElement("div", { style: { display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" } }, uV.map(function (v) { return React.createElement("span", { key: v.id, style: { fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: v.color + "15", color: v.color } }, v.code); }))),
                React.createElement(Chip, { label: u.active ? "Actief" : "Inactief", color: u.active ? GRN : MUT }));
        }) : React.createElement(EmptyState, { title: "Nog geen medewerkers", body: "Nodig de eerste medewerker uit of importeer medewerkers via onboarding. Daarna kan je rollen, venues en rechten beheren.", action: canCreateEmployees ? React.createElement(Btn, { sm: true, onClick: function () { var _a; setForm(__assign({ name: "", dept: "", email: "", phone: "", role: "employee", primaryVenueId: ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "", hue: Math.floor(Math.random() * 360), permissions: ROLE_DEFAULTS.employee }, roleDefaults("employee"))); setModal(true); } }, "+ Medewerker uitnodigen") : null })),
        sel && React.createElement(Modal, { title: sel.name, wide: true, onClose: function () { return setSel(null); } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", background: BG, borderRadius: 11, marginBottom: 17 } },
                React.createElement(Av, { u: sel, sz: 48 }),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 16 } }, sel.name),
                    React.createElement("div", { style: { display: "flex", gap: 7, marginTop: 4 } },
                        React.createElement(Chip, { label: roleName(sel.role), color: sel.role.indexOf("cr_") === 0 ? PUR : BLU })),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 4 } },
                        sel.dept,
                        " \u00B7 ",
                        sel.email,
                        " \u00B7 ",
                        sel.phone))),
            canEditEmployees && React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 12, padding: 12, border: "1px solid ".concat(BOR), borderRadius: 10, marginBottom: 14, background: SUR } },
                React.createElement(Inp, { label: "Naam", value: sel.name || "", onChange: function (e) { var name = e.target.value; updateSelected({ name: name, ini: name.split(" ").slice(0, 2).map(function (w) { return w[0] || ""; }).join("").toUpperCase() }); } }),
                React.createElement(Inp, { label: "E-mail", type: "email", value: sel.email || "", onChange: function (e) { return updateSelected({ email: e.target.value }); } }),
                React.createElement(Inp, { label: "Telefoon", value: sel.phone || "", onChange: function (e) { return updateSelected({ phone: e.target.value }); } }),
                React.createElement(Inp, { label: "Afdeling", value: sel.dept || "", onChange: function (e) { return updateSelected({ dept: e.target.value }); } }),
                React.createElement(Sel, { label: "Rol", opts: roleOptions, value: sel.role, onChange: function (e) { return changeSelectedRole(e.target.value); } }),
                React.createElement(Sel, { label: "Primaire venue", opts: myV.map(function (v) { return [v.id, v.name]; }), value: sel.primaryVenueId || "", onChange: function (e) { var oldValue = sel.primaryVenueId || ""; var newValue = e.target.value; var venueIds = (sel.venueIds || []).includes(newValue) ? (sel.venueIds || []) : __spreadArray(__spreadArray([], sel.venueIds || [], true), [newValue], false); updateSelected({ primaryVenueId: newValue, venueIds: venueIds }); auditRightChange(sel, "primaire venue", oldValue, newValue); } })),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 12, padding: 12, border: "1px solid ".concat(BOR), borderRadius: 10, marginBottom: 14, background: SUR } },
                React.createElement(Sel, { label: "Venue scope", disabled: !canEditEmployees, opts: Object.entries(SCOPE_LABELS).map(function (_a) { var k = _a[0], v = _a[1]; return [k, v]; }), value: sel.scope || roleDefaults(sel.role).scope, onChange: function (e) { if (!canEditEmployees)
                            return; var oldValue = sel.scope || roleDefaults(sel.role).scope; var newValue = e.target.value; setUsers(function (p) { return p.map(function (u) { return u.id === sel.id ? __assign(__assign({}, u), { scope: newValue }) : u; }); }); setSel(function (s) { return (__assign(__assign({}, s), { scope: newValue })); }); auditRightChange(sel, "venue scope", oldValue, newValue); } }),
                React.createElement(Sel, { label: "Datagevoeligheid", disabled: !canEditEmployees, opts: Object.entries(SENS_LABELS).map(function (_a) { var k = _a[0], v = _a[1]; return [k, v]; }), value: sel.sensitivity || roleDefaults(sel.role).sensitivity, onChange: function (e) { if (!canEditEmployees)
                            return; var oldValue = sel.sensitivity || roleDefaults(sel.role).sensitivity; var newValue = e.target.value; setUsers(function (p) { return p.map(function (u) { return u.id === sel.id ? __assign(__assign({}, u), { sensitivity: newValue }) : u; }); }); setSel(function (s) { return (__assign(__assign({}, s), { sensitivity: newValue })); }); auditRightChange(sel, "datagevoeligheid", oldValue, newValue); } }),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontSize: 11, color: SUB, fontWeight: 700, textTransform: "uppercase", marginBottom: 7 } }, "Actierechten"),
                    React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap" } }, Object.entries(ACTION_LABELS).map(function (_a) {
                        var action = _a[0], label = _a[1];
                        var current = sel.actions || roleDefaults(sel.role).actions;
                        var checked = current.includes(action);
                        return React.createElement("button", { key: action, disabled: !canEditEmployees, onClick: function () { if (!canEditEmployees)
                                    return; var oldValue = current; var newValue = checked ? current.filter(function (x) { return x !== action; }) : __spreadArray(__spreadArray([], current, true), [action], false); setUsers(function (p) { return p.map(function (u) { return u.id === sel.id ? __assign(__assign({}, u), { actions: newValue }) : u; }); }); setSel(function (s) { return (__assign(__assign({}, s), { actions: newValue })); }); auditRightChange(sel, "actierechten", oldValue, newValue); }, style: { border: "1px solid ".concat(checked ? GRN : BOR), background: checked ? GRN + "12" : BG, color: checked ? GRN : SUB, borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 700, cursor: canEditEmployees ? "pointer" : "not-allowed", opacity: canEditEmployees ? 1 : .65 } }, label);
                    })))),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 600, fontSize: 12, color: SUB, textTransform: "uppercase", letterSpacing: .6, marginBottom: 8 } }, "Venues"),
                    myV.map(function (v) {
                        var hasV = (sel.venueIds || []).includes(v.id);
                        return React.createElement("div", { key: v.id, onClick: function () { if (!canEditEmployees)
                                    return; var oldValue = sel.venueIds || []; var ids = hasV ? oldValue.filter(function (x) { return x !== v.id; }) : __spreadArray(__spreadArray([], oldValue, true), [v.id], false); setUsers(function (p) { return p.map(function (u) { return u.id === sel.id ? __assign(__assign({}, u), { venueIds: ids }) : u; }); }); setSel(function (s) { return (__assign(__assign({}, s), { venueIds: ids })); }); auditRightChange(sel, "venues", oldValue, ids); }, style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 9, border: "1.5px solid ".concat(hasV ? v.color : BOR), background: hasV ? v.color + "10" : "transparent", cursor: canEditEmployees ? "pointer" : "not-allowed", opacity: canEditEmployees ? 1 : .65, marginBottom: 6, transition: "all .15s" } },
                            React.createElement("div", { style: { width: 7, height: 7, borderRadius: "50%", background: v.color } }),
                            React.createElement("span", { style: { fontSize: 12, fontWeight: 600, color: hasV ? v.color : SUB, flex: 1 } }, v.name),
                            hasV && React.createElement("span", { style: { fontSize: 11, color: v.color } }, "\u2713"));
                    })),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 600, fontSize: 12, color: SUB, textTransform: "uppercase", letterSpacing: .6, marginBottom: 8 } }, "Module-permissies"),
                    Object.entries(PERM_LABELS).map(function (_a) {
                        var perm = _a[0], label = _a[1];
                        var hasPm = (sel.permissions || []).includes(perm);
                        var isDefault = (ROLE_DEFAULTS[sel.role] || []).includes(perm);
                        return React.createElement("div", { key: perm, onClick: function () { if (!canEditEmployees || sel.role === "tenant_admin" || sel.role === "super_admin")
                                return; var oldValue = sel.permissions || []; var perms = hasPm ? oldValue.filter(function (x) { return x !== perm; }) : __spreadArray(__spreadArray([], oldValue, true), [perm], false); setUsers(function (p) { return p.map(function (u) { return u.id === sel.id ? __assign(__assign({}, u), { permissions: perms }) : u; }); }); setSel(function (s) { return (__assign(__assign({}, s), { permissions: perms })); }); auditRightChange(sel, "modules", oldValue, perms); }, style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 7, marginBottom: 4, cursor: !canEditEmployees || sel.role === "tenant_admin" || sel.role === "super_admin" ? "default" : "pointer", opacity: canEditEmployees ? 1 : .65, background: hasPm ? GRN + "10" : "transparent", border: "1px solid ".concat(hasPm ? GRN + "30" : BOR) } },
                            React.createElement("div", { style: { width: 14, height: 14, borderRadius: 3, background: hasPm ? GRN : BG, border: "1.5px solid ".concat(hasPm ? GRN : BOR), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 } }, hasPm && React.createElement("span", { style: { fontSize: 9, color: "#fff", fontWeight: 700 } }, "\u2713")),
                            React.createElement("span", { style: { fontSize: 11, color: hasPm ? GRN : MUT, fontWeight: hasPm ? 600 : 400 } }, label),
                            isDefault && !hasPm && React.createElement("span", { style: { fontSize: 9, color: MUT } }, "(standaard)"));
                    }),
                    (sel.role === "tenant_admin" || sel.role === "super_admin") && React.createElement("div", { style: { fontSize: 11, color: MUT, padding: "6px 8px", background: BG, borderRadius: 7 } }, sel.role === "tenant_admin" ? "Admin-rechten worden centraal beheerd door de Super Admin." : "Super Admin heeft platformbrede rechten."))),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setSel(null); } }, "Sluiten"),
                canEditEmployees && React.createElement(Btn, { v: sel.active ? "warn" : "success", sm: true, onClick: function () { setUsers(function (p) { return p.map(function (u) { return u.id === sel.id ? __assign(__assign({}, u), { active: !u.active }) : u; }); }); setSel(null); toast(sel.active ? "Gedeactiveerd" : "Geactiveerd"); } }, sel.active ? "Deactiveren" : "Activeren"))),
        roleModal && React.createElement(Modal, { title: editRole ? "Vrije rol bewerken" : "Vrije rol maken", wide: true, onClose: function () { resetRoleForm(); setRoleModal(false); } },
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } },
                React.createElement("div", null,
                    React.createElement(Inp, { label: "Rolnaam", value: roleForm.name, onChange: function (e) { return setRoleForm(__assign(__assign({}, roleForm), { name: e.target.value })); }, placeholder: "Bijv. Planner, Finance, Externe accountant" }),
                    React.createElement(Inp, { label: "Omschrijving", ta: true, rows: 4, value: roleForm.desc, onChange: function (e) { return setRoleForm(__assign(__assign({}, roleForm), { desc: e.target.value })); }, placeholder: "Waarvoor gebruikt men deze rol?" }),
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
                        React.createElement(Sel, { label: "Scope", opts: Object.entries(SCOPE_LABELS).map(function (_a) { var k = _a[0], v = _a[1]; return [k, v]; }), value: roleForm.scope, onChange: function (e) { return setRoleForm(__assign(__assign({}, roleForm), { scope: e.target.value })); } }),
                        React.createElement(Sel, { label: "Datagevoeligheid", opts: Object.entries(SENS_LABELS).map(function (_a) { var k = _a[0], v = _a[1]; return [k, v]; }), value: roleForm.sensitivity, onChange: function (e) { return setRoleForm(__assign(__assign({}, roleForm), { sensitivity: e.target.value })); } })),
                    React.createElement("div", { style: { background: BLUL, border: "1px solid ".concat(BLUB), borderRadius: 8, padding: 12, fontSize: 12, color: SUB, lineHeight: 1.55 } },
                        React.createElement("div", { style: { fontWeight: 800, color: TXT, marginBottom: 6 } }, "Rol-preview"),
                        React.createElement("div", null, "Ziet ", (roleForm.permissions || []).length, " modules, mag ", (roleForm.actions || []).map(function (a) { return ACTION_LABELS[a]; }).join(", ") || "nog niets", "."),
                        React.createElement("div", null, "Bereik: ", SCOPE_LABELS[roleForm.scope], " · data: ", SENS_LABELS[roleForm.sensitivity]))),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 12, color: SUB, textTransform: "uppercase", letterSpacing: .6, marginBottom: 8 } }, "Actierechten"),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 } }, Object.entries(ACTION_LABELS).map(function (_a) {
                        var action = _a[0], label = _a[1];
                        var checked = (roleForm.actions || []).includes(action);
                        return React.createElement("button", { key: action, onClick: function () { var actions = checked ? (roleForm.actions || []).filter(function (x) { return x !== action; }) : __spreadArray(__spreadArray([], roleForm.actions || [], true), [action], false); setRoleForm(__assign(__assign({}, roleForm), { actions: actions })); }, style: { border: "1px solid ".concat(checked ? GRN : BOR), background: checked ? GRN + "12" : BG, color: checked ? GRN : SUB, borderRadius: 8, padding: "7px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer" } }, label);
                    })),
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 12, color: SUB, textTransform: "uppercase", letterSpacing: .6, marginBottom: 8 } }, "Module-rechten"),
                    Object.entries(PERM_LABELS).map(function (_a) {
                        var perm = _a[0], label = _a[1];
                        var checked = (roleForm.permissions || []).includes(perm);
                        return React.createElement("div", { key: perm, onClick: function () { var perms = checked ? (roleForm.permissions || []).filter(function (x) { return x !== perm; }) : __spreadArray(__spreadArray([], roleForm.permissions || [], true), [perm], false); setRoleForm(__assign(__assign({}, roleForm), { permissions: perms })); }, style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, marginBottom: 5, cursor: "pointer", background: checked ? GRN + "10" : SUR, border: "1px solid ".concat(checked ? GRN + "40" : BOR) } },
                            React.createElement("div", { style: { width: 15, height: 15, borderRadius: 4, background: checked ? GRN : BG, border: "1px solid ".concat(checked ? GRN : BOR), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 } }, checked && React.createElement("span", { style: { fontSize: 9, color: "#fff", fontWeight: 800 } }, "\u2713")),
                            React.createElement("span", { style: { fontSize: 12, color: checked ? TXT : SUB, fontWeight: checked ? 700 : 500 } }, label));
                    }))),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 } },
                editRole && React.createElement(Btn, { v: "danger", sm: true, onClick: deleteRole }, "Rol verwijderen"),
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { resetRoleForm(); setRoleModal(false); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, disabled: !roleForm.name.trim(), onClick: saveRole }, editRole ? "Rol bijwerken" : "Rol opslaan"))),
        modal && React.createElement(Modal, { title: "Medewerker uitnodigen", onClose: function () { return setModal(false); } },
            React.createElement(Inp, { label: "Naam", value: form.name, onChange: function (e) { return setForm(__assign(__assign({}, form), { name: e.target.value })); } }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Inp, { label: "Afdeling", value: form.dept, onChange: function (e) { return setForm(__assign(__assign({}, form), { dept: e.target.value })); } }),
                React.createElement(Inp, { label: "Telefoon", value: form.phone, onChange: function (e) { return setForm(__assign(__assign({}, form), { phone: e.target.value })); } })),
            React.createElement(Inp, { label: "E-mail", type: "email", value: form.email, onChange: function (e) { return setForm(__assign(__assign({}, form), { email: e.target.value })); } }),
            React.createElement(Sel, { label: "Rol", opts: roleOptions, value: form.role, onChange: function (e) { var _a; var role = e.target.value; var custom = myRoles.find(function (r) { return r.id === role; }); var meta = roleDefaults(role); setForm(__assign(__assign(__assign({}, form), meta), { role: role, permissions: custom ? custom.permissions : role === "tenant_admin" ? ((adminRolePolicy || {}).permissions || ALL_PERMS) : ((_a = ROLE_DEFAULTS[role]) !== null && _a !== void 0 ? _a : []) })); } }),
            React.createElement(Sel, { label: "Primaire venue", opts: myV.map(function (v) { return [v.id, v.name]; }), value: form.primaryVenueId, onChange: function (e) { return setForm(__assign(__assign({}, form), { primaryVenueId: e.target.value })); } }),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setModal(false); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, onClick: function () { var av = form.name.split(" ").slice(0, 2).map(function (w) { return w[0] || ""; }).join("").toUpperCase(); setUsers(function (p) { return __spreadArray(__spreadArray([], p, true), [__assign(__assign({}, form), { id: Date.now(), ini: av, tenantId: user.tenantId || "t1", venueIds: [form.primaryVenueId], active: true })], false); }); toast("Uitnodiging verstuurd!", form.email); setModal(false); } }, "Uitnodigen"))));
}
// ─── VERLOF ───────────────────────────────────────────────────────────────────
function LeavePage(_a) {
    var user = _a.user, allUsers = _a.allUsers, allLeaves = _a.allLeaves, setLeaves = _a.setLeaves, toast = _a.toast;
    var _b = useState(false), addM = _b[0], setAddM = _b[1];
    var _c = useState(null), detail = _c[0], setDetail = _c[1];
    var _d = useState({ type: "Verlof", from: TODAY, to: TODAY, note: "" }), form = _d[0], setForm = _d[1];
    var isAdmin = isAdminRole(user.role);
    var mine = scopeL(allLeaves, user, allUsers).filter(function (l) { return isAdmin ? true : l.userId === user.id; });
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: isAdmin ? "Verlofbeheer" : "Mijn Verlof", sub: "Aanvragen en overzicht", action: React.createElement(Btn, { sm: true, onClick: function () { return setAddM(true); } }, "+ Aanvragen") }),
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, mine.length ? mine.map(function (l) {
            var emp = allUsers.find(function (u) { return u.id === l.userId; });
            return React.createElement(Card, { key: l.id, onClick: function () { return setDetail(l); }, style: { padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
                React.createElement("div", null,
                    isAdmin && emp && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } },
                        React.createElement(Av, { u: emp, sz: 24 }),
                        React.createElement("span", { style: { fontSize: 12, fontWeight: 600, color: SUB } }, emp.name)),
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 14, color: TXT } }, l.type),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } },
                        fD(l.from),
                        " \u2192 ",
                        fD(l.to)),
                    l.note && React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 3 } }, l.note)),
                React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 } },
                    React.createElement(SChip, { label: l.status, sk: l.status }),
                    isAdmin && l.status === "In behandeling" && React.createElement("div", { style: { display: "flex", gap: 6 }, onClick: function (e) { return e.stopPropagation(); } },
                        React.createElement(Btn, { v: "success", sm: true, onClick: function () { setLeaves(function (p) { return p.map(function (x) { return x.id === l.id ? __assign(__assign({}, x), { status: "Goedgekeurd" }) : x; }); }); toast("Verlof goedgekeurd!"); } }, "\u2713"),
                        React.createElement(Btn, { v: "danger", sm: true, onClick: function () { setLeaves(function (p) { return p.map(function (x) { return x.id === l.id ? __assign(__assign({}, x), { status: "Geweigerd" }) : x; }); }); toast("Verlof geweigerd", "", "err"); } }, "\u2715"))));
        }) : React.createElement(EmptyState, { title: "Nog geen verlofaanvragen", body: isAdmin ? "Wanneer medewerkers verlof aanvragen, verschijnen de aanvragen hier voor goedkeuring." : "Je hebt nog geen verlof aangevraagd. Nieuwe aanvragen verschijnen hier met hun status.", action: React.createElement(Btn, { sm: true, onClick: function () { return setAddM(true); } }, "+ Verlof aanvragen") })),
        addM && React.createElement(Modal, { title: "Verlof aanvragen", onClose: function () { return setAddM(false); } },
            React.createElement(Sel, { label: "Type", opts: ["Verlof", "Ziekte", "Tijdskrediet", "Opleiding"], value: form.type, onChange: function (e) { return setForm(__assign(__assign({}, form), { type: e.target.value })); } }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Inp, { label: "Van", type: "date", value: form.from, onChange: function (e) { return setForm(__assign(__assign({}, form), { from: e.target.value })); } }),
                React.createElement(Inp, { label: "Tot", type: "date", value: form.to, onChange: function (e) { return setForm(__assign(__assign({}, form), { to: e.target.value })); } })),
            React.createElement(Inp, { label: "Opmerking", value: form.note, onChange: function (e) { return setForm(__assign(__assign({}, form), { note: e.target.value })); } }),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setAddM(false); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, onClick: function () { setLeaves(function (p) { return __spreadArray(__spreadArray([], p, true), [__assign(__assign({}, form), { id: Date.now(), userId: user.id, venueId: user.primaryVenueId || "v1", status: "In behandeling" })], false); }); toast("Aangevraagd!", "", "info"); setAddM(false); } }, "Aanvragen"))),
        detail && React.createElement(Modal, { title: "Verlof detail", onClose: function () { return setDetail(null); } },
            (function () { var emp = allUsers.find(function (u) { return u.id === detail.userId; }); return emp && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: BG, borderRadius: 10, marginBottom: 16 } },
                React.createElement(Av, { u: emp, sz: 40 }),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 15 } }, emp.name),
                    React.createElement("div", { style: { fontSize: 12, color: SUB } }, emp.dept))); })(),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, [["Type", detail.type], ["Status", detail.status], ["Van", fD(detail.from)], ["Tot", fD(detail.to)]].map(function (_a) {
                var k = _a[0], v = _a[1];
                return React.createElement("div", { key: k, style: { padding: "10px 12px", background: BG, borderRadius: 9 } },
                    React.createElement("div", { style: { fontSize: 10, color: MUT, fontWeight: 600, textTransform: "uppercase", marginBottom: 3 } }, k),
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, k === "Status" ? React.createElement(SChip, { label: v, sk: v }) : v));
            }))));
}
// ─── BERICHTEN ────────────────────────────────────────────────────────────────
function MessagesPage(_a) {
    var _b;
    var user = _a.user, allUsers = _a.allUsers, allMsgs = _a.allMsgs, setMsgs = _a.setMsgs;
    var _c = useState(""), txt = _c[0], setTxt = _c[1];
    var isAdmin = isAdminRole(user.role);
    var partners = isAdmin ? allUsers.filter(function (u) { return u.tenantId === user.tenantId && u.role === "employee"; }) : allUsers.filter(function (u) { return u.tenantId === user.tenantId && (u.role === "tenant_admin" || u.role === "venue_manager"); });
    var _d = useState(((_b = partners[0]) === null || _b === void 0 ? void 0 : _b.id) || 10), toId = _d[0], setToId = _d[1];
    var mine = __spreadArray([], allMsgs, true).filter(function (m) { return m.from === user.id || m.to === user.id; }).sort(function (a, b) { return a.id - b.id; });
    var send = function () { if (!txt.trim())
        return; setMsgs(function (p) { return __spreadArray(__spreadArray([], p, true), [{ id: Date.now(), from: user.id, to: toId, text: txt, date: TODAY, time: new Date().toTimeString().slice(0, 5), read: false }], false); }); setTxt(""); };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Berichten", sub: "Communiceer met uw team" }),
        React.createElement(Card, { style: { overflow: "hidden" } },
            React.createElement("div", { style: { overflowY: "auto", padding: "15px 18px", display: "flex", flexDirection: "column", gap: 11, minHeight: 280, maxHeight: 400 } }, mine.length ? mine.map(function (m) {
                var isMe = m.from === user.id;
                var s = allUsers.find(function (u) { return u.id === m.from; });
                return React.createElement("div", { key: m.id, style: { display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", gap: 9 } },
                    !isMe && s && React.createElement(Av, { u: s, sz: 28 }),
                    React.createElement("div", { style: { maxWidth: "74%", background: isMe ? NAV_BG : BG, color: isMe ? "#fff" : TXT, padding: "9px 13px", borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px", fontSize: 13, lineHeight: 1.6, border: isMe ? "none" : "1px solid ".concat(BOR) } },
                        !isMe && React.createElement("div", { style: { fontSize: 10, fontWeight: 600, color: MUT, marginBottom: 2 } }, s === null || s === void 0 ? void 0 : s.name),
                        m.text,
                        React.createElement("div", { style: { fontSize: 10, opacity: .5, marginTop: 3 } },
                            m.date,
                            " ",
                            m.time)));
            }) : React.createElement(EmptyState, { title: "Nog geen berichten", body: "Start een gesprek met je team. Nieuwe berichten verschijnen hier chronologisch.", compact: true })),
            React.createElement("div", { style: { borderTop: "1px solid ".concat(BOR), padding: "11px 15px", display: "flex", gap: 8 } },
                (isAdmin || user.role === "venue_manager") && partners.length > 0 && React.createElement("select", { value: toId, onChange: function (e) { return setToId(Number(e.target.value)); }, style: { border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "7px 9px", fontSize: 12, fontFamily: "inherit" } }, partners.map(function (u) { return React.createElement("option", { key: u.id, value: u.id }, u.name); })),
                React.createElement("input", { value: txt, onChange: function (e) { return setTxt(e.target.value); }, onKeyDown: function (e) { return e.key === "Enter" && send(); }, placeholder: "Typ een bericht\u2026", style: { flex: 1, border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "7px 11px", fontSize: 13, fontFamily: "inherit", outline: "none" } }),
                React.createElement(Btn, { onClick: send }, "\u2192"))));
}
// ─── WERKBONNEN — met checklist, materiaalverbruik en billable uren ────────────
function WorkordersPage(_a) {
    var user = _a.user, allUsers = _a.allUsers, allWO = _a.allWO, setWO = _a.setWO, venues = _a.venues, allStock = _a.allStock, setStock = _a.setStock, toast = _a.toast;
    var _b = useState(null), sel = _b[0], setSel = _b[1];
    var _c = useState(false), modal = _c[0], setModal = _c[1];
    var _d = useState(null), editWO = _d[0], setEditWO = _d[1];
    var _e = useState("all"), filter = _e[0], setFilter = _e[1];
    var _f = useState({ title: "", client: "", location: "", desc: "", date: TODAY, status: "Bezig", note: "", billableHours: 0, files: [], checklist: [], materials: [], venueId: user.primaryVenueId || "" }), form = _f[0], setForm = _f[1];
    var _g = useState(""), newCL = _g[0], setNewCL = _g[1];
    var _h = useState(""), addMatId = _h[0], setAddMatId = _h[1];
    var _j = useState(1), addMatQty = _j[0], setAddMatQty = _j[1];
    var fRef = useRef();
    var isAdmin = isAdminRole(user.role);
    var myV = scopeV(venues, user);
    var mine = scopeW(allWO, user, allUsers).filter(function (w) { return isAdmin ? true : w.userId === user.id; });
    var filtered = filter === "all" ? mine : mine.filter(function (w) { return w.status === filter; });
    var STATS = ["Bezig", "In behandeling", "Voltooid", "Geannuleerd"];
    var hf = function (files) { return Array.from(files).forEach(function (f) { var r = new FileReader(); r.onload = function (e) { return setForm(function (prev) { return (__assign(__assign({}, prev), { files: __spreadArray(__spreadArray([], prev.files, true), [{ name: f.name, type: f.type.includes("pdf") ? "pdf" : f.type.includes("image") ? "image" : "file", size: f.size > 1048576 ? (f.size / 1048576).toFixed(1) + " MB" : Math.round(f.size / 1024) + " KB", dataUrl: e.target.result }], false) })); }); }; r.readAsDataURL(f); }); };
    var save = function () { if (!form.title)
        return; if (editWO)
        setWO(function (p) { return p.map(function (w) { return w.id === editWO.id ? __assign(__assign({}, w), form) : w; }); });
    else
        setWO(function (p) { return __spreadArray(__spreadArray([], p, true), [__assign(__assign({}, form), { id: Date.now(), userId: user.id, signed: false, reviewed: false })], false); }); toast(editWO ? "Bijgewerkt!" : "Werkbon aangemaakt!", form.title); setModal(false); setEditWO(null); };
    var myStock = allStock.filter(function (s) { return myV.some(function (v) { return v.id === s.venueId; }); });
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Werkbonnen", sub: "".concat(mine.length, " werkbonnen"), action: React.createElement(Btn, { sm: true, onClick: function () { var _a; setEditWO(null); setForm({ title: "", client: "", location: "", desc: "", date: TODAY, status: "Bezig", note: "", billableHours: 0, files: [], checklist: [], materials: [], venueId: user.primaryVenueId || ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "" }); setNewCL(""); setModal(true); } }, "+ Nieuwe werkbon") }),
        isAdmin && allWO.filter(function (w) { return !w.reviewed && w.files.length > 0; }).length > 0 && React.createElement("div", { style: { background: AMBL, border: "1.5px solid ".concat(AMB), borderRadius: 11, padding: "11px 16px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center" } },
            React.createElement("span", null, "\uD83D\uDCCB"),
            React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: AMB } },
                allWO.filter(function (w) { return !w.reviewed && w.files.length > 0; }).length,
                " werkbon(nen) wachten op nazicht")),
        React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" } }, __spreadArray(["all"], STATS, true).map(function (f) { return React.createElement("button", { key: f, onClick: function () { return setFilter(f); }, style: { padding: "5px 13px", borderRadius: 20, border: "1.5px solid ".concat(filter === f ? (SCOL[f] || NAV_BG) : BOR), background: filter === f ? (SCOL[f] || NAV_BG) + "15" : "transparent", color: filter === f ? (SCOL[f] || NAV_BG) : SUB, fontSize: 11, fontWeight: 600, cursor: "pointer" } }, f === "all" ? "Alle (".concat(mine.length, ")") : f); })),
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, filtered.length ? filtered.map(function (w) {
            var emp = allUsers.find(function (u) { return u.id === w.userId; });
            var sc = SCOL[w.status] || MUT;
            var done = w.checklist.filter(function (c) { return c.done; }).length;
            var total = w.checklist.length;
            return React.createElement(Card, { key: w.id, onClick: function () { return setSel(w); }, style: { padding: "13px 17px", borderLeft: "4px solid ".concat(sc) } },
                React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 } },
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 } },
                            React.createElement("span", { style: { fontWeight: 700, fontSize: 14, color: TXT } }, w.title),
                            React.createElement(SChip, { label: w.status, sk: w.status }),
                            w.signed && React.createElement(Chip, { label: "\u2713 Afgetekend", color: GRN }),
                            isAdmin && !w.reviewed && w.files.length > 0 && React.createElement(Chip, { label: "\uD83D\uDD14 Nazicht", color: AMB }),
                            w.billableHours > 0 && React.createElement(Chip, { label: "\uD83D\uDCBC ".concat(w.billableHours, "u billable"), color: PUR })),
                        (w.client || w.location) && React.createElement("div", { style: { fontSize: 12, color: SUB } },
                            w.client && "\uD83C\uDFE2 ".concat(w.client),
                            w.location && " \u00B7 \uD83D\uDCCD ".concat(w.location)),
                        React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 2 } }, fD(w.date)),
                        total > 0 && React.createElement("div", { style: { marginTop: 6 } },
                            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 10, color: SUB, marginBottom: 3 } },
                                React.createElement("span", null, "\u2713 Checklist"),
                                React.createElement("span", null,
                                    done,
                                    "/",
                                    total)),
                            React.createElement("div", { style: { height: 4, background: BOR, borderRadius: 2, overflow: "hidden" } },
                                React.createElement("div", { style: { width: "".concat(total > 0 ? (done / total) * 100 : 0, "%"), height: "100%", background: done === total ? GRN : BLU, borderRadius: 2, transition: "width .3s" } }))),
                        w.materials.length > 0 && React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 4 } },
                            "\uD83D\uDCE6 ",
                            w.materials.length,
                            " materiaal",
                            w.materials.length > 1 ? "en" : "",
                            " gebruikt")),
                    React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 } },
                        isAdmin && emp && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5 } },
                            React.createElement(Av, { u: emp, sz: 20 }),
                            React.createElement("span", { style: { fontSize: 11, color: SUB } }, emp.name.split(" ")[0])),
                        w.files.length > 0 && React.createElement(Chip, { label: "\uD83D\uDCCE ".concat(w.files.length), color: BLU }))));
        }) : React.createElement(EmptyState, { title: filter === "all" ? "Nog geen werkbonnen" : "Geen werkbonnen in deze status", body: filter === "all" ? "Maak de eerste werkbon aan om uitgevoerde werken, materialen, foto's en uren te bundelen." : "Deze filter bevat momenteel geen werkbonnen.", action: React.createElement(Btn, { sm: true, onClick: function () { var _a; setEditWO(null); setForm({ title: "", client: "", location: "", desc: "", date: TODAY, status: "Bezig", note: "", billableHours: 0, files: [], checklist: [], materials: [], venueId: user.primaryVenueId || ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "" }); setNewCL(""); setModal(true); } }, "+ Werkbon maken") })),
        sel && React.createElement(Modal, { title: sel.title, wide: true, onClose: function () { return setSel(null); } },
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 } }, [["Status", sel.status], ["Datum", fD(sel.date)], ["Klant", sel.client || "—"], ["Locatie", sel.location || "—"]].map(function (_a) {
                var k = _a[0], v = _a[1];
                return React.createElement("div", { key: k, style: { padding: "10px 12px", background: BG, borderRadius: 9 } },
                    React.createElement("div", { style: { fontSize: 10, color: MUT, fontWeight: 600, textTransform: "uppercase", marginBottom: 3 } }, k),
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, k === "Status" ? React.createElement(SChip, { label: v, sk: v }) : v));
            })),
            sel.desc && React.createElement("div", { style: { marginBottom: 12 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 5, textTransform: "uppercase" } }, "Omschrijving"),
                React.createElement("div", { style: { background: BG, padding: "10px 14px", borderRadius: 9, fontSize: 13, lineHeight: 1.7 } }, sel.desc)),
            sel.checklist.length > 0 && React.createElement("div", { style: { marginBottom: 14 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: SUB, textTransform: "uppercase", marginBottom: 8 } },
                    "\u2713 Checklist (",
                    sel.checklist.filter(function (c) { return c.done; }).length,
                    "/",
                    sel.checklist.length,
                    ")"),
                sel.checklist.map(function (cl) { return React.createElement("div", { key: cl.id, onClick: function () { var upd = sel.checklist.map(function (c) { return c.id === cl.id ? __assign(__assign({}, c), { done: !c.done }) : c; }); setWO(function (p) { return p.map(function (w) { return w.id === sel.id ? __assign(__assign({}, w), { checklist: upd }) : w; }); }); setSel(function (s) { return (__assign(__assign({}, s), { checklist: upd })); }); }, style: { display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", background: cl.done ? GRNL : BG, borderRadius: 8, marginBottom: 5, cursor: "pointer", border: "1px solid ".concat(cl.done ? GRN + "30" : BOR) } },
                    React.createElement("div", { style: { width: 16, height: 16, borderRadius: 4, background: cl.done ? GRN : SUR, border: "2px solid ".concat(cl.done ? GRN : BOR), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 } }, cl.done && React.createElement("span", { style: { fontSize: 9, color: "#fff", fontWeight: 700 } }, "\u2713")),
                    React.createElement("span", { style: { fontSize: 13, color: cl.done ? GRN : TXT, textDecoration: cl.done ? "line-through" : "none" } }, cl.label)); })),
            sel.materials.length > 0 && React.createElement("div", { style: { marginBottom: 14 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: SUB, textTransform: "uppercase", marginBottom: 8 } }, "\uD83D\uDCE6 Gebruikte materialen"),
                sel.materials.map(function (m, i) { return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 9, padding: "7px 11px", background: BG, borderRadius: 8, marginBottom: 5, border: "1px solid ".concat(BOR) } },
                    React.createElement("span", { style: { flex: 1, fontSize: 13, fontWeight: 600 } }, m.name),
                    React.createElement("span", { style: { fontSize: 12, color: SUB } },
                        m.qty,
                        " ",
                        m.unit)); })),
            sel.billableHours > 0 && React.createElement("div", { style: { marginBottom: 12, padding: "10px 14px", background: PURL, borderRadius: 9, border: "1px solid ".concat(PUR, "30"), display: "flex", justifyContent: "space-between", alignItems: "center" } },
                React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: PUR } }, "\uD83D\uDCBC Billable uren"),
                React.createElement("span", { style: { fontWeight: 800, fontSize: 16, color: PUR } },
                    sel.billableHours,
                    "u")),
            sel.note && React.createElement("div", { style: { marginBottom: 12 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 5, textTransform: "uppercase" } }, "Bevindingen"),
                React.createElement("div", { style: { background: AMBL, padding: "10px 14px", borderRadius: 9, fontSize: 13 } }, sel.note)),
            React.createElement("div", { style: { marginBottom: 14 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 8, textTransform: "uppercase" } },
                    "Bijlagen (",
                    sel.files.length,
                    ")"),
                sel.files.length === 0 ? React.createElement("div", { style: { padding: 12, background: BG, borderRadius: 9, textAlign: "center", color: MUT, fontSize: 13 } }, "Geen bijlagen") : sel.files.map(function (f, i) { return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: BG, borderRadius: 9, marginBottom: 6, border: "1px solid ".concat(BOR) } },
                    React.createElement("span", { style: { fontSize: 20 } }, f.type === "pdf" ? "📄" : f.type === "image" ? "🖼️" : "📎"),
                    f.dataUrl && f.type === "image" && React.createElement("img", { src: f.dataUrl, alt: "", style: { width: 40, height: 40, objectFit: "cover", borderRadius: 7 } }),
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("div", { style: { fontSize: 13, fontWeight: 600 } }, f.name),
                        React.createElement("div", { style: { fontSize: 11, color: MUT } }, f.size)),
                    f.dataUrl && React.createElement("a", { href: f.dataUrl, download: f.name, style: { fontSize: 18, textDecoration: "none" } }, "\u2B07\uFE0F")); })),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" } },
                isAdmin && !sel.reviewed && sel.files.length > 0 && React.createElement(Btn, { v: "success", sm: true, onClick: function () { setWO(function (p) { return p.map(function (w) { return w.id === sel.id ? __assign(__assign({}, w), { reviewed: true }) : w; }); }); setSel(function (s) { return (__assign(__assign({}, s), { reviewed: true })); }); toast("Nagekeken!", "", "info"); } }, "\u2713 Nagekeken"),
                !sel.signed && (user.id === sel.userId || isAdmin) && React.createElement(Btn, { v: "warn", sm: true, onClick: function () { setWO(function (p) { return p.map(function (w) { return w.id === sel.id ? __assign(__assign({}, w), { signed: true, status: "Voltooid" }) : w; }); }); setSel(function (s) { return (__assign(__assign({}, s), { signed: true, status: "Voltooid" })); }); toast("Afgetekend!"); } }, "\u270D\uFE0F Aftekenen"),
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { setSel(null); setEditWO(sel); setForm(__assign({}, sel)); setNewCL(""); setModal(true); } }, "\u270F\uFE0F Bewerken"),
                isAdmin && React.createElement(Btn, { v: "danger", sm: true, onClick: function () { setWO(function (p) { return p.filter(function (w) { return w.id !== sel.id; }); }); setSel(null); toast("Verwijderd", "", "warn"); } }, "\uD83D\uDDD1\uFE0F"),
                React.createElement(Btn, { v: "subtle", sm: true, onClick: function () { return setSel(null); } }, "Sluiten"))),
        modal && React.createElement(Modal, { title: editWO ? "Werkbon bewerken" : "Nieuwe werkbon", wide: true, onClose: function () { setModal(false); setEditWO(null); } },
            React.createElement(Inp, { label: "Titel *", value: form.title, onChange: function (e) { return setForm(__assign(__assign({}, form), { title: e.target.value })); }, placeholder: "Bv: Onderhoud installatie hal 2" }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Inp, { label: "Klant", value: form.client || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { client: e.target.value })); } }),
                React.createElement(Inp, { label: "Datum", type: "date", value: form.date, onChange: function (e) { return setForm(__assign(__assign({}, form), { date: e.target.value })); } })),
            React.createElement(Inp, { label: "Locatie", value: form.location || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { location: e.target.value })); } }),
            React.createElement(Inp, { label: "Omschrijving", ta: true, value: form.desc || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { desc: e.target.value })); } }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Sel, { label: "Status", opts: STATS, value: form.status, onChange: function (e) { return setForm(__assign(__assign({}, form), { status: e.target.value })); } }),
                React.createElement(Inp, { label: "\uD83D\uDCBC Billable uren", type: "number", value: form.billableHours, onChange: function (e) { return setForm(__assign(__assign({}, form), { billableHours: +e.target.value })); }, placeholder: "0" })),
            React.createElement("div", { style: { marginBottom: 14 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 8, textTransform: "uppercase", letterSpacing: .6 } }, "\u2713 Checklist"),
                form.checklist.map(function (cl, i) { return React.createElement("div", { key: cl.id, style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 5 } },
                    React.createElement("div", { style: { width: 14, height: 14, borderRadius: 3, background: cl.done ? GRN : BG, border: "2px solid ".concat(cl.done ? GRN : BOR), cursor: "pointer", flexShrink: 0 }, onClick: function () { return setForm(function (f) { return (__assign(__assign({}, f), { checklist: f.checklist.map(function (c, j) { return j === i ? __assign(__assign({}, c), { done: !c.done }) : c; }) })); }); } }),
                    React.createElement("span", { style: { flex: 1, fontSize: 13, color: TXT } }, cl.label),
                    React.createElement("button", { onClick: function () { return setForm(function (f) { return (__assign(__assign({}, f), { checklist: f.checklist.filter(function (_, j) { return j !== i; }) })); }); }, style: { background: "none", border: "none", cursor: "pointer", color: MUT, fontSize: 14 } }, "\u2715")); }),
                React.createElement("div", { style: { display: "flex", gap: 7, marginTop: 6 } },
                    React.createElement("input", { value: newCL, onChange: function (e) { return setNewCL(e.target.value); }, onKeyDown: function (e) { return e.key === "Enter" && newCL.trim() && (setForm(function (f) { return (__assign(__assign({}, f), { checklist: __spreadArray(__spreadArray([], f.checklist, true), [{ id: "cl" + uid(), label: newCL.trim(), done: false }], false) })); }), setNewCL("")); }, placeholder: "Voeg checkpunt toe\u2026", style: { flex: 1, border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "6px 11px", fontSize: 12, fontFamily: "inherit", outline: "none" } }),
                    React.createElement(Btn, { sm: true, onClick: function () { return newCL.trim() && (setForm(function (f) { return (__assign(__assign({}, f), { checklist: __spreadArray(__spreadArray([], f.checklist, true), [{ id: "cl" + uid(), label: newCL.trim(), done: false }], false) })); }), setNewCL("")); } }, "+ Voeg toe"))),
            myStock.length > 0 && React.createElement("div", { style: { marginBottom: 14 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 8, textTransform: "uppercase", letterSpacing: .6 } }, "\uD83D\uDCE6 Gebruikte materialen"),
                form.materials.map(function (m, i) { return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: BG, borderRadius: 8, marginBottom: 5, border: "1px solid ".concat(BOR) } },
                    React.createElement("span", { style: { flex: 1, fontSize: 12, fontWeight: 600 } }, m.name),
                    React.createElement("span", { style: { fontSize: 12, color: SUB } },
                        m.qty,
                        " ",
                        m.unit),
                    React.createElement("button", { onClick: function () { return setForm(function (f) { return (__assign(__assign({}, f), { materials: f.materials.filter(function (_, j) { return j !== i; }) })); }); }, style: { background: "none", border: "none", cursor: "pointer", color: MUT, fontSize: 14 } }, "\u2715")); }),
                React.createElement("div", { style: { display: "flex", gap: 7, marginTop: 6 } },
                    React.createElement("select", { value: addMatId, onChange: function (e) { return setAddMatId(e.target.value); }, style: { flex: 2, border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" } },
                        React.createElement("option", { value: "" }, "\u2014 Selecteer artikel \u2014"),
                        myStock.map(function (s) { return React.createElement("option", { key: s.id, value: s.id },
                            s.name,
                            " (stock: ",
                            s.qty,
                            " ",
                            s.unit,
                            ")"); })),
                    React.createElement("input", { type: "number", value: addMatQty, onChange: function (e) { return setAddMatQty(+e.target.value); }, min: 1, style: { width: 60, border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "6px 9px", fontSize: 12, fontFamily: "inherit", outline: "none" } }),
                    React.createElement(Btn, { sm: true, disabled: !addMatId, onClick: function () { var s = myStock.find(function (x) { return x.id === Number(addMatId); }); if (!s)
                            return; setForm(function (f) { return (__assign(__assign({}, f), { materials: __spreadArray(__spreadArray([], f.materials, true), [{ stockId: s.id, name: s.name, qty: addMatQty, unit: s.unit }], false) })); }); setStock(function (p) { return p.map(function (x) { return x.id === s.id ? __assign(__assign({}, x), { qty: Math.max(0, x.qty - addMatQty) }) : x; }); }); setAddMatId(""); setAddMatQty(1); } }, "+ Toevoegen"))),
            React.createElement(Inp, { label: "Bevindingen", ta: true, value: form.note || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { note: e.target.value })); } }),
            React.createElement("div", { style: { marginBottom: 14 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 6, textTransform: "uppercase", letterSpacing: .6 } },
                    "Bijlagen (",
                    form.files.length,
                    ")"),
                React.createElement("div", { onDragOver: function (e) { e.preventDefault(); e.currentTarget.style.borderColor = BLU; }, onDragLeave: function (e) { return e.currentTarget.style.borderColor = BOR; }, onDrop: function (e) { e.preventDefault(); e.currentTarget.style.borderColor = BOR; hf(e.dataTransfer.files); }, onClick: function () { var _a; return (_a = fRef.current) === null || _a === void 0 ? void 0 : _a.click(); }, style: { border: "2px dashed #E8E4DC", borderRadius: 11, padding: "14px", textAlign: "center", cursor: "pointer", transition: "all .15s" } },
                    React.createElement("div", { style: { fontSize: 20, marginBottom: 4 } }, "\uD83D\uDCC1"),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, fontWeight: 600 } }, "Sleep bestanden of klik om te bladeren"),
                    React.createElement("input", { ref: fRef, type: "file", multiple: true, accept: ".pdf,.jpg,.jpeg,.png,.doc,.docx", style: { display: "none" }, onChange: function (e) { return hf(e.target.files); } })),
                form.files.map(function (f, i) { return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 9, padding: "7px 11px", background: BLUL, borderRadius: 8, marginTop: 5, border: "1px solid ".concat(BLUB) } },
                    React.createElement("span", { style: { fontSize: 14 } }, f.type === "image" ? "🖼️" : f.type === "pdf" ? "📄" : "📎"),
                    React.createElement("div", { style: { flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, f.name),
                    React.createElement("span", { style: { fontSize: 11, color: MUT } }, f.size),
                    React.createElement("button", { onClick: function () { return setForm(__assign(__assign({}, form), { files: form.files.filter(function (_, j) { return j !== i; }) })); }, style: { background: REDL, border: "none", borderRadius: 6, padding: "3px 8px", color: RED, cursor: "pointer", fontWeight: 700 } }, "\u2715")); })),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { setModal(false); setEditWO(null); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, onClick: save }, editWO ? "Opslaan" : "Aanmaken"))));
}
// ─── STOCK ────────────────────────────────────────────────────────────────────
function StockPage(_a) {
    var user = _a.user, allStock = _a.allStock, setStock = _a.setStock, venues = _a.venues, toast = _a.toast;
    var _b = useState(null), sel = _b[0], setSel = _b[1];
    var _c = useState(false), modal = _c[0], setModal = _c[1];
    var _d = useState(null), editS = _d[0], setEditS = _d[1];
    var _e = useState({ name: "", sku: "", qty: 0, min: 1, unit: "st", cat: "Overig", loc: "", venueId: "" }), form = _e[0], setForm = _e[1];
    var isAdmin = isAdminRole(user.role);
    var myV = scopeV(venues, user);
    var myStock = allStock.filter(function (s) { return myV.some(function (v) { return v.id === s.venueId; }); });
    var low = myStock.filter(function (s) { return s.qty <= s.min; });
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Stockbeheer", sub: "".concat(myStock.length, " artikelen \u00B7 ").concat(low.length, " onder minimum"), action: isAdmin && React.createElement(Btn, { sm: true, onClick: function () { var _a; setEditS(null); setForm({ name: "", sku: "", qty: 0, min: 1, unit: "st", cat: "Overig", loc: "", venueId: ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "" }); setModal(true); } }, "+ Artikel") }),
        low.length > 0 && React.createElement("div", { style: { background: AMBL, border: "1.5px solid ".concat(AMB), borderRadius: 11, padding: "11px 16px", marginBottom: 14, fontSize: 13, fontWeight: 600, color: AMB } },
            "\u26A0\uFE0F Lage stock: ",
            low.map(function (s) { return s.name; }).join(", ")),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 } }, myStock.length ? myStock.map(function (s) {
            var isLow = s.qty <= s.min;
            return React.createElement(Card, { key: s.id, onClick: function () { return setSel(s); }, style: { padding: "15px 17px", borderLeft: "3px solid ".concat(isLow ? AMB : GRN) } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 7 } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: TXT } }, s.name),
                        React.createElement("div", { style: { fontSize: 10, color: MUT } },
                            s.sku,
                            " \u00B7 ",
                            s.cat)),
                    isLow && React.createElement(Chip, { label: "Laag", color: AMB })),
                React.createElement("div", { style: { fontWeight: 900, fontSize: 28, color: isLow ? AMB : TXT, letterSpacing: -1 } },
                    s.qty,
                    React.createElement("span", { style: { fontSize: 13, fontWeight: 500, color: SUB } },
                        " ",
                        s.unit)),
                React.createElement("div", { style: { fontSize: 11, color: MUT } },
                    "Min: ",
                    s.min,
                    " ",
                    s.unit,
                    " \u00B7 \uD83D\uDCCD ",
                    s.loc),
                React.createElement("div", { style: { height: 3, background: BOR, borderRadius: 2, marginTop: 9, overflow: "hidden" } },
                    React.createElement("div", { style: { width: "".concat(Math.min(100, (s.qty / (s.min * 2)) * 100), "%"), height: "100%", background: isLow ? AMB : GRN, borderRadius: 2 } })));
        }) : React.createElement(EmptyState, { title: "Nog geen stockartikelen", body: "Voeg materialen of voorraadartikelen toe. Daarna kan verbruik op werkbonnen en minimumstock opgevolgd worden.", action: isAdmin && React.createElement(Btn, { sm: true, onClick: function () { var _a; setEditS(null); setForm({ name: "", sku: "", qty: 0, min: 1, unit: "st", cat: "Overig", loc: "", venueId: ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "" }); setModal(true); } }, "+ Artikel toevoegen") })),
        sel && React.createElement(Modal, { title: "\uD83D\uDCE6 ".concat(sel.name), onClose: function () { return setSel(null); } },
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 } }, [["SKU", sel.sku], ["Categorie", sel.cat], ["Locatie", sel.loc], ["Eenheid", sel.unit], ["Voorraad", "".concat(sel.qty, " ").concat(sel.unit)], ["Minimum", "".concat(sel.min, " ").concat(sel.unit)]].map(function (_a) {
                var k = _a[0], v = _a[1];
                return React.createElement("div", { key: k, style: { padding: "10px 12px", background: BG, borderRadius: 9 } },
                    React.createElement("div", { style: { fontSize: 10, color: MUT, fontWeight: 600, textTransform: "uppercase", marginBottom: 3 } }, k),
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, v));
            })),
            isAdmin && React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { setSel(null); setEditS(sel); setForm(__assign({}, sel)); setModal(true); } }, "\u270F\uFE0F Bewerken"),
                React.createElement(Btn, { v: "danger", sm: true, onClick: function () { setStock(function (p) { return p.filter(function (x) { return x.id !== sel.id; }); }); setSel(null); toast("Verwijderd", "", "warn"); } }, "\uD83D\uDDD1\uFE0F"))),
        modal && isAdmin && React.createElement(Modal, { title: editS ? "Artikel bewerken" : "Artikel toevoegen", onClose: function () { return setModal(false); } },
            React.createElement(Inp, { label: "Naam", value: form.name, onChange: function (e) { return setForm(__assign(__assign({}, form), { name: e.target.value })); } }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Inp, { label: "SKU", value: form.sku, onChange: function (e) { return setForm(__assign(__assign({}, form), { sku: e.target.value })); } }),
                React.createElement(Inp, { label: "Categorie", value: form.cat, onChange: function (e) { return setForm(__assign(__assign({}, form), { cat: e.target.value })); } }),
                React.createElement(Inp, { label: "Aantal", type: "number", value: form.qty, onChange: function (e) { return setForm(__assign(__assign({}, form), { qty: +e.target.value })); } }),
                React.createElement(Inp, { label: "Minimum", type: "number", value: form.min, onChange: function (e) { return setForm(__assign(__assign({}, form), { min: +e.target.value })); } }),
                React.createElement(Inp, { label: "Eenheid", value: form.unit, onChange: function (e) { return setForm(__assign(__assign({}, form), { unit: e.target.value })); } }),
                React.createElement(Inp, { label: "Locatie", value: form.loc, onChange: function (e) { return setForm(__assign(__assign({}, form), { loc: e.target.value })); } })),
            React.createElement(Sel, { label: "Venue", opts: myV.map(function (v) { return [v.id, v.name]; }), value: form.venueId, onChange: function (e) { return setForm(__assign(__assign({}, form), { venueId: e.target.value })); } }),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setModal(false); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, onClick: function () { editS ? setStock(function (p) { return p.map(function (x) { return x.id === editS.id ? __assign(__assign({}, x), form) : x; }); }) : setStock(function (p) { return __spreadArray(__spreadArray([], p, true), [__assign(__assign({}, form), { id: Date.now() })], false); }); toast(editS ? "Bijgewerkt!" : "Toegevoegd!"); setModal(false); } }, editS ? "Opslaan" : "Toevoegen"))));
}
// ─── WAGENPARK ────────────────────────────────────────────────────────────────
function VehiclesPage(_a) {
    var user = _a.user, allUsers = _a.allUsers, allVehicles = _a.allVehicles, setVehicles = _a.setVehicles, venues = _a.venues, toast = _a.toast;
    var _b = useState(null), sel = _b[0], setSel = _b[1];
    var _c = useState(false), modal = _c[0], setModal = _c[1];
    var _d = useState(null), editV = _d[0], setEditV = _d[1];
    var _e = useState({ plate: "", brand: "", year: 2024, km: 0, status: "Beschikbaar", assignedTo: null, fuel: "Diesel", nextService: gd(90), notes: "", venueId: "" }), form = _e[0], setForm = _e[1];
    var isAdmin = isAdminRole(user.role);
    var myV = scopeV(venues, user);
    var myVehicles = allVehicles.filter(function (v) { return myV.some(function (ven) { return ven.id === v.venueId; }); });
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Wagenpark", sub: "".concat(myVehicles.length, " voertuigen"), action: isAdmin && React.createElement(Btn, { sm: true, onClick: function () { var _a; setEditV(null); setForm({ plate: "", brand: "", year: 2024, km: 0, status: "Beschikbaar", assignedTo: null, fuel: "Diesel", nextService: gd(90), notes: "", venueId: ((_a = myV[0]) === null || _a === void 0 ? void 0 : _a.id) || "" }); setModal(true); } }, "+ Voertuig") }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(255px,1fr))", gap: 13 } }, myVehicles.map(function (v) {
            var driver = allUsers.find(function (u) { return u.id === v.assignedTo; });
            var days = Math.ceil((new Date(v.nextService) - new Date()) / 86400000);
            return React.createElement(Card, { key: v.id, onClick: function () { return setSel(v); }, style: { padding: "17px 19px" } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 9 } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 800, fontSize: 16, color: TXT, letterSpacing: -.3 } }, v.plate),
                        React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } },
                            v.brand,
                            " \u00B7 ",
                            v.year)),
                    React.createElement(SChip, { label: v.status, sk: v.status })),
                React.createElement("div", { style: { display: "flex", gap: 12, fontSize: 12, color: SUB, marginBottom: 8 } },
                    React.createElement("span", null,
                        "\u26FD ",
                        v.fuel),
                    React.createElement("span", null,
                        "\uD83D\uDCCF ",
                        v.km.toLocaleString("nl-BE"),
                        " km")),
                driver && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8 } },
                    React.createElement(Av, { u: driver, sz: 20 }),
                    React.createElement("span", { style: { fontSize: 11, color: BLU, fontWeight: 600 } }, driver.name)),
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", padding: "7px 9px", background: days <= 14 ? AMBL : BG, borderRadius: 8, fontSize: 11, border: "1px solid ".concat(days <= 14 ? AMB + "30" : BOR) } },
                    React.createElement("span", { style: { color: SUB } }, "\uD83D\uDD27 Service"),
                    React.createElement("span", { style: { fontWeight: 700, color: days <= 14 ? AMB : TXT } }, days <= 0 ? "Vervallen!" : days + " dagen")),
                v.notes && React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 6 } },
                    "\uD83D\uDCDD ",
                    v.notes));
        })),
        sel && React.createElement(Modal, { title: "\uD83D\uDE97 ".concat(sel.plate, " \u2014 ").concat(sel.brand), onClose: function () { return setSel(null); } },
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 } }, [["Bouwjaar", sel.year], ["KM", sel.km.toLocaleString("nl-BE") + " km"], ["Brandstof", sel.fuel], ["Status", sel.status], ["Service", fD(sel.nextService)]].map(function (_a) {
                var k = _a[0], v = _a[1];
                return React.createElement("div", { key: k, style: { padding: "10px 12px", background: BG, borderRadius: 9 } },
                    React.createElement("div", { style: { fontSize: 10, color: MUT, fontWeight: 600, textTransform: "uppercase", marginBottom: 3 } }, k),
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, k === "Status" ? React.createElement(SChip, { label: v, sk: v }) : v));
            })),
            (function () { var d = allUsers.find(function (u) { return u.id === sel.assignedTo; }); return d && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: BLUL, borderRadius: 10, marginBottom: 10, border: "1px solid ".concat(BLUB) } },
                React.createElement(Av, { u: d, sz: 32 }),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, d.name),
                    React.createElement("div", { style: { fontSize: 11, color: SUB } }, "Huidige bestuurder"))); })(),
            sel.notes && React.createElement("div", { style: { padding: "10px 14px", background: AMBL, borderRadius: 9, fontSize: 13, marginBottom: 10 } },
                "\uD83D\uDCDD ",
                sel.notes),
            isAdmin && React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { setSel(null); setEditV(sel); setForm(__assign({}, sel)); setModal(true); } }, "\u270F\uFE0F"),
                React.createElement(Btn, { v: "danger", sm: true, onClick: function () { setVehicles(function (p) { return p.filter(function (v) { return v.id !== sel.id; }); }); setSel(null); toast("Verwijderd", "", "warn"); } }, "\uD83D\uDDD1\uFE0F"))),
        modal && isAdmin && React.createElement(Modal, { title: editV ? "Voertuig bewerken" : "Voertuig toevoegen", onClose: function () { return setModal(false); } },
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Inp, { label: "Nummerplaat", value: form.plate, onChange: function (e) { return setForm(__assign(__assign({}, form), { plate: e.target.value })); } }),
                React.createElement(Inp, { label: "Merk & model", value: form.brand, onChange: function (e) { return setForm(__assign(__assign({}, form), { brand: e.target.value })); } }),
                React.createElement(Inp, { label: "Bouwjaar", type: "number", value: form.year, onChange: function (e) { return setForm(__assign(__assign({}, form), { year: +e.target.value })); } }),
                React.createElement(Inp, { label: "KM stand", type: "number", value: form.km, onChange: function (e) { return setForm(__assign(__assign({}, form), { km: +e.target.value })); } })),
            React.createElement(Sel, { label: "Status", opts: ["Beschikbaar", "In gebruik", "Onderhoud", "Defect"], value: form.status, onChange: function (e) { return setForm(__assign(__assign({}, form), { status: e.target.value })); } }),
            React.createElement(Sel, { label: "Brandstof", opts: ["Diesel", "Benzine", "Elektrisch", "Hybride"], value: form.fuel, onChange: function (e) { return setForm(__assign(__assign({}, form), { fuel: e.target.value })); } }),
            React.createElement(Sel, { label: "Toegewezen aan", opts: __spreadArray([["", "— Niemand —"]], allUsers.filter(function (u) { return myV.some(function (v) { return (u.venueIds || []).includes(v.id); }) && u.role === "employee"; }).map(function (u) { return [u.id, u.name]; }), true), value: form.assignedTo || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { assignedTo: e.target.value ? +e.target.value : null })); } }),
            React.createElement(Sel, { label: "Venue", opts: myV.map(function (v) { return [v.id, v.name]; }), value: form.venueId, onChange: function (e) { return setForm(__assign(__assign({}, form), { venueId: e.target.value })); } }),
            React.createElement(Inp, { label: "Volgende service", type: "date", value: form.nextService, onChange: function (e) { return setForm(__assign(__assign({}, form), { nextService: e.target.value })); } }),
            React.createElement(Inp, { label: "Notities", value: form.notes || "", onChange: function (e) { return setForm(__assign(__assign({}, form), { notes: e.target.value })); } }),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setModal(false); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, onClick: function () { editV ? setVehicles(function (p) { return p.map(function (x) { return x.id === editV.id ? __assign(__assign({}, x), form) : x; }); }) : setVehicles(function (p) { return __spreadArray(__spreadArray([], p, true), [__assign(__assign({}, form), { id: Date.now() })], false); }); toast(editV ? "Bijgewerkt!" : "Toegevoegd!"); setModal(false); } }, editV ? "Opslaan" : "Toevoegen"))));
}
// ─── TENANTS (super admin) ────────────────────────────────────────────────────
function CustomersPage(_a) {
    var user = _a.user, customers = _a.customers, setCustomers = _a.setCustomers, allUsers = _a.allUsers, toast = _a.toast;
    var _b = useState(null), sel = _b[0], setSel = _b[1];
    var _c = useState("all"), filter = _c[0], setFilter = _c[1];
    var tenantUsers = allUsers.filter(function (u) { return user.role === "super_admin" ? true : u.tenantId === user.tenantId; });
    var blank = { name: "", type: "bedrijf", status: "active", vat: "", email: "", phone: "", address: "", contact: "", ownerId: user.id, sector: "", paymentTerms: "30 dagen", note: "", tags: [] };
    var mine = scopeCustomers(customers || [], user).filter(function (c) { return filter === "all" ? true : c.status === filter; });
    var save = function () {
        if (!sel || !sel.name.trim())
            return;
        var next = __assign(__assign({}, sel), { tenantId: sel.tenantId || user.tenantId || "t1", tags: Array.isArray(sel.tags) ? sel.tags : String(sel.tags || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean) });
        setCustomers(function (prev) { return next.id ? prev.map(function (c) { return c.id === next.id ? next : c; }) : __spreadArray(__spreadArray([], prev || [], true), [__assign(__assign({}, next), { id: "cu_" + uid() })], false); });
        toast(next.id ? "Klant bijgewerkt" : "Klant aangemaakt", next.name, "info");
        setSel(null);
    };
    var remove = function () {
        if (!sel || !sel.id)
            return;
        setCustomers(function (prev) { return (prev || []).filter(function (c) { return c.id !== sel.id; }); });
        toast("Klant verwijderd", sel.name, "warn");
        setSel(null);
    };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Klanten", sub: "".concat(mine.length, " klantenfiches binnen deze tenant"), action: React.createElement(Btn, { sm: true, onClick: function () { return setSel(__assign({}, blank)); } }, "+ Klant") }),
        React.createElement("div", { style: { display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap" } }, [["all", "Alle"], ["active", "Actief"], ["prospect", "Prospect"], ["paused", "On hold"]].map(function (_a) {
            var id = _a[0], label = _a[1];
            return React.createElement("button", { key: id, onClick: function () { return setFilter(id); }, style: { border: "1px solid ".concat(filter === id ? BLU : BOR), background: filter === id ? BLUL : SUR, color: filter === id ? BLU : SUB, borderRadius: 8, padding: "7px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer" } }, label);
        })),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 12 } }, mine.length ? mine.map(function (c) {
            var owner = tenantUsers.find(function (u) { return u.id === c.ownerId; });
            return React.createElement(Card, { key: c.id, onClick: function () { return setSel(c); }, style: { padding: "17px 19px", borderLeft: "3px solid ".concat(c.status === "prospect" ? AMB : c.status === "paused" ? MUT : GRN) } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 850, fontSize: 15, color: TXT } }, c.name),
                        React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } }, c.contact || c.email || "Geen contact")),
                    React.createElement(SChip, { label: c.status, sk: c.status })),
                React.createElement("div", { style: { display: "grid", gap: 5, fontSize: 12, color: SUB, marginBottom: 9 } },
                    React.createElement("div", null, "BTW: ", c.vat || "-"),
                    React.createElement("div", null, "Sector: ", c.sector || "-"),
                    React.createElement("div", null, "Betaling: ", c.paymentTerms || "-")),
                owner && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7, marginBottom: 8 } },
                    React.createElement(Av, { u: owner, sz: 22 }),
                    React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: BLU } }, owner.name)),
                React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 } }, (c.tags || []).map(function (tag) { return React.createElement("span", { key: tag, style: { fontSize: 10, color: SUB, background: BG, border: "1px solid ".concat(BOR), borderRadius: 20, padding: "2px 7px" } }, tag); })));
        }) : React.createElement(EmptyState, { title: filter === "all" ? "Nog geen klanten" : "Geen klanten in deze filter", body: filter === "all" ? "Voeg je eerste klantfiche toe zodat werkbonnen, planning en opvolging aan een klant gekoppeld kunnen worden." : "Er zijn momenteel geen klanten met deze status.", action: React.createElement(Btn, { sm: true, onClick: function () { return setSel(__assign({}, blank)); } }, "+ Klant toevoegen") })),
        sel && React.createElement(Modal, { title: sel.id ? "Klantenfiche" : "Nieuwe klant", wide: true, onClose: function () { return setSel(null); } },
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Inp, { label: "Naam", value: sel.name, onChange: function (e) { return setSel(__assign(__assign({}, sel), { name: e.target.value })); } }),
                React.createElement(Sel, { label: "Status", opts: [["active", "Actief"], ["prospect", "Prospect"], ["paused", "On hold"]], value: sel.status, onChange: function (e) { return setSel(__assign(__assign({}, sel), { status: e.target.value })); } }),
                React.createElement(Inp, { label: "Contactpersoon", value: sel.contact || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { contact: e.target.value })); } }),
                React.createElement(Inp, { label: "BTW", value: sel.vat || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { vat: e.target.value })); } }),
                React.createElement(Inp, { label: "E-mail", value: sel.email || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { email: e.target.value })); } }),
                React.createElement(Inp, { label: "Telefoon", value: sel.phone || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { phone: e.target.value })); } }),
                React.createElement(Inp, { label: "Sector", value: sel.sector || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { sector: e.target.value })); } }),
                React.createElement(Inp, { label: "Betalingstermijn", value: sel.paymentTerms || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { paymentTerms: e.target.value })); } })),
            React.createElement(Inp, { label: "Adres", value: sel.address || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { address: e.target.value })); } }),
            React.createElement(Sel, { label: "Account owner", opts: __spreadArray([["", "Geen owner"]], tenantUsers.map(function (u) { return [u.id, u.name]; }), true), value: sel.ownerId || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { ownerId: e.target.value ? Number(e.target.value) : null })); } }),
            React.createElement(Inp, { label: "Tags", value: Array.isArray(sel.tags) ? sel.tags.join(", ") : sel.tags || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { tags: e.target.value })); } }),
            React.createElement(Inp, { label: "Notities", ta: true, rows: 4, value: sel.note || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { note: e.target.value })); } }),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "space-between" } },
                React.createElement("div", null, sel.id && React.createElement(Btn, { v: "danger", sm: true, onClick: remove }, "Verwijderen")),
                React.createElement("div", { style: { display: "flex", gap: 8 } },
                    React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setSel(null); } }, "Annuleren"),
                    React.createElement(Btn, { sm: true, onClick: save, disabled: !sel.name.trim() }, "Opslaan")))));
}
function TenantsPage(_a) {
    var tenants = _a.tenants, setTenants = _a.setTenants, toast = _a.toast;
    var _b = useState(null), sel = _b[0], setSel = _b[1];
    var _c = useState("overview"), tenantTab = _c[0], setTenantTab = _c[1];
    var PLANC = { starter: MUT, business: BLU, enterprise: GRN };
    var lookupKbo = function () {
        var vat = String(((sel.invoiceProfile || {}).vat || sel.vat || "")).toUpperCase().replace(/[^A-Z0-9]/g, "");
        var nr = vat.replace(/^BE/, "");
        if (!nr || nr.length < 9) {
            if (toast)
                toast("BTW nummer ontbreekt", "Geef eerst een geldig Belgisch BTW nummer in.", "warn");
            return;
        }
        var demo = {
            "0123456789": { name: "Demo Bouwgroep NV", street: "Kerkstraat 12", postalCode: "9000", city: "Gent" },
            "0477472701": { name: "WorkFlow Pro BV", street: "Slachthuisstraat 28", postalCode: "9000", city: "Gent" },
            "0897225572": { name: "ABMS Consultancy BV", street: "Stationsstraat 44", postalCode: "2800", city: "Mechelen" }
        };
        var hit = demo[nr] || { name: sel.name || "KBO onderneming " + nr, street: "Nog te verifieren via KBO API", postalCode: "", city: "", country: "Belgie" };
        setSel(__assign(__assign({}, sel), { name: hit.name, vat: "BE" + nr, invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { vat: "BE" + nr, companyNumber: nr, street: hit.street || "", postalCode: hit.postalCode || "", city: hit.city || "", country: hit.country || "Belgie", kboSyncedAt: TODAY }) }));
        if (toast)
            toast("KBO gegevens opgehaald", hit.name, "info");
    };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "SaaS klanten", sub: "".concat(tenants.length, " platform-klantenfiches"), action: React.createElement(Btn, { sm: true, onClick: function () { setTenantTab("overview"); return setSel({ id: null, name: "", plan: "business", billingEmail: "", venues: 1, users: 0, mrr: 0, status: "trial", accountOwner: "", lifecycle: "trial", churnRisk: "medium", successNote: "", supportTickets: 0, contactPerson: { name: "", role: "", email: "", phone: "" }, invoiceProfile: { vat: "", companyNumber: "", street: "", postalCode: "", city: "", country: "Belgie", invoiceEmail: "", peppolId: "", paymentTerms: "30 dagen", language: "nl", invoiceReference: "", purchaseOrderRequired: false }, accountManagement: { salesResponsible: "", accountManager: "", customerSuccess: "", source: "", salesStage: "active_customer", lastContact: "", nextReview: "", note: "" } }); } }, "+ Nieuwe klant") }),
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } }, tenants.map(function (t) { return React.createElement(Card, { key: t.id, onClick: function () { setTenantTab("overview"); return setSel(t); }, style: { padding: "16px 20px", display: "flex", alignItems: "center", gap: 13 } },
            React.createElement("div", { style: { width: 42, height: 42, borderRadius: 12, background: PLANC[t.plan] + "15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 } }, t.status === "suspended" ? "⊘" : t.plan === "enterprise" ? "🏆" : t.plan === "business" ? "⭐" : "🌱"),
            React.createElement("div", { style: { flex: 1 } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: 14, color: TXT } }, t.name),
                React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } },
                    t.billingEmail,
                    " \u00B7 ",
                    t.users,
                    " users \u00B7 ",
                    t.venues,
                    " venues")),
            React.createElement("div", { style: { textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 } },
                React.createElement("span", { style: { fontWeight: 800, fontSize: 16, color: GRN } },
                    "\u20AC",
                    t.mrr,
                    React.createElement("span", { style: { fontSize: 11, fontWeight: 400, color: MUT } }, "/mnd")),
                React.createElement("div", { style: { display: "flex", gap: 6 } },
                    React.createElement(Chip, { label: t.plan, color: PLANC[t.plan] }),
                    React.createElement(SChip, { label: t.status, sk: t.status })))); })),
        sel && React.createElement(Modal, { title: sel.id ? "SaaS klantenfiche" : "Nieuwe SaaS klant", wide: true, onClose: function () { return setSel(null); } },
            React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 14, borderBottom: "1px solid ".concat(BOR), paddingBottom: 10, flexWrap: "wrap" } }, [["overview", "Overzicht & facturatie"], ["contact", "Contact"], ["account", "Account manager"], ["success", "Success"]].map(function (_a) {
                var id = _a[0], label = _a[1];
                return React.createElement("button", { key: id, onClick: function () { return setTenantTab(id); }, style: { border: "1px solid ".concat(tenantTab === id ? BLU : BOR), background: tenantTab === id ? BLUL : SUR, color: tenantTab === id ? BLU : SUB, borderRadius: 8, padding: "7px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer" } }, label);
            })),
            tenantTab === "overview" && React.createElement("div", null,
            React.createElement(Card, { style: { padding: 12, marginBottom: 14, boxShadow: "none", background: BG } },
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 170px", gap: 10, alignItems: "end" } },
                    React.createElement(Inp, { label: "BTW nummer", value: (sel.invoiceProfile || {}).vat || sel.vat || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { vat: e.target.value }) })); }, placeholder: "BE0123456789" }),
                    React.createElement(Btn, { sm: true, v: "ghost", onClick: lookupKbo, full: true }, "KBO ophalen")),
                React.createElement("div", { style: { fontSize: 11, color: SUB, marginTop: -4 } }, "Start hier: na KBO-ophaling worden bedrijfsnaam, ondernemingsnummer en adres automatisch ingevuld.")),
            React.createElement(Inp, { label: "Bedrijfsnaam", value: sel.name, onChange: function (e) { return setSel(__assign(__assign({}, sel), { name: e.target.value })); } }),
            React.createElement(Inp, { label: "Billing e-mail", type: "email", value: sel.billingEmail, onChange: function (e) { return setSel(__assign(__assign({}, sel), { billingEmail: e.target.value })); } }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                React.createElement(Sel, { label: "Plan", opts: [["starter", "Starter — €9/user"], ["business", "Business — €18/user"], ["enterprise", "Enterprise — €29/user"]], value: sel.plan, onChange: function (e) { return setSel(__assign(__assign({}, sel), { plan: e.target.value })); } }),
                React.createElement(Sel, { label: "Status", opts: ["active", "trial", "suspended", "cancelled"], value: sel.status, onChange: function (e) { return setSel(__assign(__assign({}, sel), { status: e.target.value })); } })),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 } },
                React.createElement(Inp, { label: "Account owner", value: sel.accountOwner || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { accountOwner: e.target.value })); } }),
                React.createElement(Sel, { label: "Lifecycle", opts: ["trial", "active", "renewal", "at_risk", "churned"], value: sel.lifecycle || sel.status || "active", onChange: function (e) { return setSel(__assign(__assign({}, sel), { lifecycle: e.target.value })); } }),
                React.createElement(Sel, { label: "Churn risk", opts: ["low", "medium", "high"], value: sel.churnRisk || "medium", onChange: function (e) { return setSel(__assign(__assign({}, sel), { churnRisk: e.target.value })); } }),
                React.createElement(Inp, { label: "MRR", type: "number", value: sel.mrr || 0, onChange: function (e) { return setSel(__assign(__assign({}, sel), { mrr: Number(e.target.value || 0) })); } }),
                React.createElement(Inp, { label: "Support tickets", type: "number", value: sel.supportTickets || 0, onChange: function (e) { return setSel(__assign(__assign({}, sel), { supportTickets: Number(e.target.value || 0) })); } }),
                React.createElement(Inp, { label: "Renewal datum", type: "date", value: sel.renewalAt || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { renewalAt: e.target.value })); } })),
            React.createElement(Inp, { label: "Customer success notitie", ta: true, rows: 3, value: sel.successNote || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { successNote: e.target.value })); } }),
            React.createElement("div", { style: { background: BLUL, border: "1px solid ".concat(BLUB), borderRadius: 8, padding: 12, marginTop: 12, marginBottom: 12, fontSize: 12, color: SUB, lineHeight: 1.55 } },
                React.createElement("strong", { style: { color: TXT } }, "Planlimieten: "),
                "users ",
                (PLAN_LIMITS[sel.plan] || PLAN_LIMITS.business).users,
                " · venues ",
                (PLAN_LIMITS[sel.plan] || PLAN_LIMITS.business).venues === 999 ? "onbeperkt" : (PLAN_LIMITS[sel.plan] || PLAN_LIMITS.business).venues,
                " · vrije rollen ",
                (PLAN_LIMITS[sel.plan] || PLAN_LIMITS.business).customRoles === 999 ? "onbeperkt" : (PLAN_LIMITS[sel.plan] || PLAN_LIMITS.business).customRoles,
                " · audit ",
                (PLAN_LIMITS[sel.plan] || PLAN_LIMITS.business).auditDays,
                " dagen")),
            tenantTab === "overview" && React.createElement("div", null,
                React.createElement("div", { style: { fontWeight: 900, fontSize: 14, color: TXT, margin: "4px 0 12px", paddingTop: 4, borderTop: "1px solid ".concat(BOR) } }, "Factuurgegevens"),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                    React.createElement(Inp, { label: "Juridische naam", value: sel.name || "", disabled: true, title: "Wordt automatisch overgenomen van de hoofdbenaming." }),
                    React.createElement(Inp, { label: "Ondernemingsnummer", value: (sel.invoiceProfile || {}).companyNumber || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { companyNumber: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Facturatie e-mail", type: "email", value: (sel.invoiceProfile || {}).invoiceEmail || sel.billingEmail || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { billingEmail: e.target.value, invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { invoiceEmail: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Straat en nummer", value: (sel.invoiceProfile || {}).street || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { street: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Postcode", value: (sel.invoiceProfile || {}).postalCode || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { postalCode: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Gemeente", value: (sel.invoiceProfile || {}).city || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { city: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Land", value: (sel.invoiceProfile || {}).country || "Belgie", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { country: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Peppol ID", value: (sel.invoiceProfile || {}).peppolId || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { peppolId: e.target.value }) })); }, placeholder: "BE:VAT:..." }),
                    React.createElement(Inp, { label: "Factuurreferentie", value: (sel.invoiceProfile || {}).invoiceReference || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { invoiceReference: e.target.value }) })); } }),
                    React.createElement(Sel, { label: "Betalingstermijn", opts: ["14 dagen", "30 dagen", "45 dagen", "60 dagen", "Jaarcontract vooraf"], value: (sel.invoiceProfile || {}).paymentTerms || "30 dagen", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { paymentTerms: e.target.value }) })); } }),
                    React.createElement(Sel, { label: "Factuurtaal", opts: [["nl", "Nederlands"], ["fr", "Frans"], ["en", "Engels"]], value: (sel.invoiceProfile || {}).language || "nl", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { language: e.target.value }) })); } })),
                React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 9, fontSize: 12, fontWeight: 800, color: TXT, marginBottom: 12 } },
                    React.createElement("input", { type: "checkbox", checked: !!(sel.invoiceProfile || {}).purchaseOrderRequired, onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { purchaseOrderRequired: e.target.checked }) })); }, style: { width: 17, height: 17, accentColor: BLU } }),
                    "PO-nummer verplicht voor facturen"),
                React.createElement(Inp, { label: "Facturatienotities", ta: true, rows: 3, value: (sel.invoiceProfile || {}).note || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { invoiceProfile: __assign(__assign({}, sel.invoiceProfile || {}), { note: e.target.value }) })); } })),
            tenantTab === "contact" && React.createElement("div", null,
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                    React.createElement(Inp, { label: "Contactpersoon", value: (sel.contactPerson || {}).name || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { contactPerson: __assign(__assign({}, sel.contactPerson || {}), { name: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Functie", value: (sel.contactPerson || {}).role || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { contactPerson: __assign(__assign({}, sel.contactPerson || {}), { role: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "E-mail", type: "email", value: (sel.contactPerson || {}).email || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { contactPerson: __assign(__assign({}, sel.contactPerson || {}), { email: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Telefoon", value: (sel.contactPerson || {}).phone || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { contactPerson: __assign(__assign({}, sel.contactPerson || {}), { phone: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Facturatie e-mail", type: "email", value: sel.billingEmail || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { billingEmail: e.target.value })); } })),
                React.createElement(Inp, { label: "Contactnotities", ta: true, rows: 3, value: (sel.contactPerson || {}).note || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { contactPerson: __assign(__assign({}, sel.contactPerson || {}), { note: e.target.value }) })); } })),
            tenantTab === "account" && React.createElement("div", null,
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
                    React.createElement(Inp, { label: "Sales responsible", value: (sel.accountManagement || {}).salesResponsible || sel.accountOwner || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { accountOwner: e.target.value, accountManagement: __assign(__assign({}, sel.accountManagement || {}), { salesResponsible: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Account manager", value: (sel.accountManagement || {}).accountManager || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { accountManagement: __assign(__assign({}, sel.accountManagement || {}), { accountManager: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Customer success manager", value: (sel.accountManagement || {}).customerSuccess || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { accountManagement: __assign(__assign({}, sel.accountManagement || {}), { customerSuccess: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Lead/source", value: (sel.accountManagement || {}).source || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { accountManagement: __assign(__assign({}, sel.accountManagement || {}), { source: e.target.value }) })); } }),
                    React.createElement(Sel, { label: "Commerciele fase", opts: [["prospect", "Prospect"], ["trial", "Trial"], ["active_customer", "Actieve klant"], ["expansion", "Upsell/expansion"], ["at_risk", "Risico"], ["churned", "Churned"]], value: (sel.accountManagement || {}).salesStage || "active_customer", onChange: function (e) { return setSel(__assign(__assign({}, sel), { accountManagement: __assign(__assign({}, sel.accountManagement || {}), { salesStage: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Laatste commercieel contact", type: "date", value: (sel.accountManagement || {}).lastContact || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { accountManagement: __assign(__assign({}, sel.accountManagement || {}), { lastContact: e.target.value }) })); } }),
                    React.createElement(Inp, { label: "Volgende review", type: "date", value: (sel.accountManagement || {}).nextReview || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { accountManagement: __assign(__assign({}, sel.accountManagement || {}), { nextReview: e.target.value }) })); } })),
                React.createElement(Inp, { label: "Account manager notities", ta: true, rows: 4, value: (sel.accountManagement || {}).note || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { accountManagement: __assign(__assign({}, sel.accountManagement || {}), { note: e.target.value }) })); } })),
            tenantTab === "success" && React.createElement(Inp, { label: "Customer success notitie", ta: true, rows: 5, value: sel.successNote || "", onChange: function (e) { return setSel(__assign(__assign({}, sel), { successNote: e.target.value })); } }),
            React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 } },
                sel.id && React.createElement(Btn, { v: "danger", sm: true, onClick: function () { setTenants(function (p) { return p.filter(function (t) { return t.id !== sel.id; }); }); setSel(null); } }, "Verwijderen"),
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setSel(null); } }, "Annuleren"),
                React.createElement(Btn, { sm: true, onClick: function () { sel.id ? setTenants(function (p) { return p.map(function (t) { return t.id === sel.id ? __assign(__assign({}, t), sel) : t; }); }) : setTenants(function (p) { return __spreadArray(__spreadArray([], p, true), [__assign(__assign({}, sel), { id: "t" + uid() })], false); }); setSel(null); } }, "Opslaan"))));
}
// ─── RAPPORTAGES — met datumfilter ────────────────────────────────────────────
function PlatformOwnerPage(_a) {
    var platformConfig = _a.platformConfig, setPlatformConfig = _a.setPlatformConfig, tenants = _a.tenants, setTenants = _a.setTenants, allUsers = _a.allUsers, setUser = _a.setUser, setPage = _a.setPage, toast = _a.toast, setAuditLogs = _a.setAuditLogs;
    var cfg = platformConfig || PLATFORM_CONFIG_INIT;
    var setCfg = function (patch) { return setPlatformConfig(function (p) { return __assign(__assign({}, (p || PLATFORM_CONFIG_INIT)), patch); }); };
    var objPatch = function (obj, key, value) { var _a; return __assign(__assign({}, obj), (_a = {}, _a[key] = value, _a)); };
    var updBilling = function (key, value) { return setCfg({ billing: objPatch(cfg.billing || {}, key, value) }); };
    var updStripe = function (key, value) { return setCfg({ stripe: objPatch(cfg.stripe || {}, key, value) }); };
    var updSupport = function (key, value) { return setCfg({ support: objPatch(cfg.support || {}, key, value) }); };
    var updFlag = function (key, value) { return setCfg({ featureFlags: objPatch(cfg.featureFlags || {}, key, value) }); };
    var updAdminRole = function (patch) {
        var current = getTenantAdminPolicy(cfg);
        setCfg({ rolePolicies: __assign(__assign({}, cfg.rolePolicies || {}), { tenant_admin: __assign(__assign({}, current), patch) }) });
        if (setAuditLogs)
            setAuditLogs(function (p) { return __spreadArray(__spreadArray([], p || [], true), [{ id: "al_" + uid(), at: TODAY, time: new Date().toTimeString().slice(0, 5), actor: "Super Admin", action: "Admin rechten gewijzigd", area: "Rechten", detail: "Admin-rol: " + JSON.stringify(current) + " -> " + JSON.stringify(__assign(__assign({}, current), patch)), severity: "warn" }], false).slice(-140); });
    };
    var updPlan = function (id, patch) { return setCfg({ plans: (cfg.plans || []).map(function (p) { return p.id === id ? __assign(__assign({}, p), patch) : p; }) }); };
    var updModule = function (id, patch) { return setCfg({ modules: (cfg.modules || []).map(function (m) { return m.id === id ? __assign(__assign({}, m), patch) : m; }) }); };
    var supportAllowed = function (support) { return !!(support && support.enabled && (support.autoRenew || !support.expiresAt || support.expiresAt >= TODAY)); };
    var ToggleLine = function (_a) {
        var label = _a.label, checked = _a.checked, onChange = _a.onChange, sub = _a.sub;
        return React.createElement("label", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid ".concat(BOR), cursor: "pointer" } },
            React.createElement("span", null,
                React.createElement("span", { style: { display: "block", fontWeight: 700, fontSize: 13, color: TXT } }, label),
                sub && React.createElement("span", { style: { display: "block", fontSize: 11, color: SUB, marginTop: 2 } }, sub)),
            React.createElement("input", { type: "checkbox", checked: !!checked, onChange: function (e) { return onChange(e.target.checked); }, style: { width: 18, height: 18, accentColor: BLU } }));
    };
    var supportLogin = function (tenant) {
        var support = tenant.supportAccess || {};
        var allowed = supportAllowed(support);
        if (!allowed) {
            toast("Geen toestemming", "Deze klant moet supporttoegang eerst inschakelen.", "warn");
            return;
        }
        var target = allUsers.find(function (u) { return u.tenantId === tenant.id && u.role === "tenant_admin"; }) || allUsers.find(function (u) { return u.tenantId === tenant.id; });
        if (!target) {
            toast("Geen klantaccount gevonden", "Maak eerst een admin-gebruiker aan voor deze tenant.", "err");
            return;
        }
        setUser(__assign(__assign({}, target), { supportSession: true, supportTenantName: tenant.name, supportStartedAt: new Date().toISOString(), originalUserId: 99 }));
        setPage("dashboard");
        toast("Support sessie gestart", "Je kijkt nu mee in ".concat(tenant.name), "info");
    };
    var extendSupport = function (tenant) {
        setTenants(function (prev) { return prev.map(function (t) { return t.id === tenant.id ? __assign(__assign({}, t), { supportAccess: __assign(__assign({}, (t.supportAccess || {})), { enabled: true, autoRenew: false, grantedBy: "Super Admin", grantedAt: TODAY, expiresAt: gd(Number((cfg.support || {}).defaultConsentDays || 7)), reason: "Manueel verlengd na klantcontact" }) }) : t; }); });
        toast("Supporttoegang bijgewerkt", tenant.name, "info");
    };
    var SectionTitle = function (_a) {
        var title = _a.title, sub = _a.sub, icon = _a.icon, right = _a.right;
        return React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 } },
            React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "flex-start" } },
                React.createElement("div", { style: { width: 34, height: 34, borderRadius: 8, background: BLUL, color: BLU, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 14, border: "1px solid ".concat(BLUB), flexShrink: 0 } }, icon),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 850, fontSize: 15, color: TXT } }, title),
                    sub && React.createElement("div", { style: { fontSize: 12, color: SUB, lineHeight: 1.45, marginTop: 2 } }, sub))),
            right);
    };
    var miniInputStyle = { marginBottom: 0 };
    var PERM_LABELS = { onboarding: "Onboarding", alerts: "Actiecentrum", planning: "Planning", clockings: "Tijdregistraties", expenses: "Onkosten", workorders: "Werkbonnen", stock: "Stock", vehicles: "Wagenpark", leaves: "Verlof", messages: "Berichten", reports: "Rapportages", datahub: "Datahub", integrations: "Integraties", billing: "Billing", employees: "Medewerkers", venues: "Venues", customers: "Klanten", settings: "Instellingen", audit: "Auditlog" };
    var ACTION_LABELS = { view: "Bekijken", create: "Aanmaken", update: "Wijzigen", delete: "Verwijderen", approve: "Goedkeuren", export: "Exporteren" };
    var SCOPE_LABELS = { tenant: "Hele tenant", venue: "Venue scope", team: "Teamdata" };
    var SENS_LABELS = { internal: "Intern", confidential: "Vertrouwelijk", financial: "Financieel gevoelig" };
    var adminRole = getTenantAdminPolicy(cfg);
    var PLAN_ITEMS = [
        ["clockings", "Prikklok & tijdregistratie"],
        ["planning", "Weekplanning"],
        ["leaves", "Verlofbeheer"],
        ["messages", "Team berichten"],
        ["customers", "Klantenbeheer"],
        ["workorders", "Werkbonnen"],
        ["vehicles", "Wagenpark beheer"],
        ["stock", "Stockbeheer"],
        ["integrations", "Integraties"],
        ["reports", "Rapportages"],
        ["datahub", "Datahub export"],
        ["billing", "Billing"],
        ["audit", "Audit logging"],
        ["security", "Security/GDPR"],
        ["support", "Support"],
    ];
    var togglePlanFeature = function (plan, label) {
        var current = plan.features || [];
        var next = current.indexOf(label) >= 0 ? current.filter(function (f) { return f !== label; }) : __spreadArray(__spreadArray([], current, true), [label], false);
        var bundleLabels = PLAN_ITEMS.map(function (item) { return item[1]; });
        var nextNotIncluded = bundleLabels.filter(function (item) { return next.indexOf(item) < 0; });
        updPlan(plan.id, { features: next, notIncluded: nextNotIncluded });
    };
    var activePlans = (cfg.plans || []).filter(function (p) { return p.active !== false; }).length;
    var activeModules = (cfg.modules || []).filter(function (m) { return m.active !== false; }).length;
    var allowedSupport = tenants.filter(function (t) { return supportAllowed(t.supportAccess || {}); }).length;
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Platform beheer", sub: "Beheer commerciële instellingen, billing en supporttoegang zonder code.", action: React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                React.createElement(Chip, { label: ((cfg.stripe || {}).mode || "test").toUpperCase(), color: (cfg.stripe || {}).mode === "live" ? GRN : AMB }),
                React.createElement(Chip, { label: activePlans + " actieve plannen", color: BLU }),
                React.createElement(Chip, { label: allowedSupport + " supporttoegang", color: allowedSupport ? GRN : MUT })) }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 18 } },
            React.createElement(KPI, { icon: "P", label: "Actieve plannen", value: activePlans, color: BLU }),
            React.createElement(KPI, { icon: "M", label: "Modules live", value: activeModules, color: PUR }),
            React.createElement(KPI, { icon: "%", label: "BTW", value: ((cfg.billing || {}).vatRate || 0) + "%", color: TEAL }),
            React.createElement(KPI, { icon: "S", label: "Support open", value: allowedSupport, color: allowedSupport ? GRN : MUT })),
        React.createElement(Card, { style: { padding: "20px 22px", marginBottom: 14 } },
            React.createElement(SectionTitle, { icon: "R", title: "Admin rechten", sub: "Globale tenant-admin rol. Klanten kunnen vrije rollen beheren, maar deze Admin-rechten worden alleen hier bepaald.", right: React.createElement(Chip, { label: "Super Admin only", color: PUR }) }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(280px,.8fr)", gap: 16 } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 12, color: SUB, textTransform: "uppercase", letterSpacing: .6, marginBottom: 8 } }, "Moduletoegang"),
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 } }, Object.entries(PERM_LABELS).map(function (_a) {
                        var perm = _a[0], label = _a[1];
                        var checked = (adminRole.permissions || []).includes(perm);
                        return React.createElement("button", { key: perm, onClick: function () { var old = adminRole.permissions || []; var next = checked ? old.filter(function (x) { return x !== perm; }) : __spreadArray(__spreadArray([], old, true), [perm], false); updAdminRole({ permissions: next }); }, style: { textAlign: "left", border: "1px solid ".concat(checked ? BLU : BOR), background: checked ? BLUL : BG, color: checked ? TXT : SUB, borderRadius: 8, padding: "9px 10px", fontSize: 12, fontWeight: 750, cursor: "pointer" } }, checked ? "✓ " : "", label);
                    }))),
                React.createElement("div", null,
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
                        React.createElement(Sel, { label: "Scope", opts: Object.entries(SCOPE_LABELS).map(function (_a) { var k = _a[0], v = _a[1]; return [k, v]; }), value: adminRole.scope || "tenant", onChange: function (e) { return updAdminRole({ scope: e.target.value }); } }),
                        React.createElement(Sel, { label: "Datagevoeligheid", opts: Object.entries(SENS_LABELS).map(function (_a) { var k = _a[0], v = _a[1]; return [k, v]; }), value: adminRole.sensitivity || "financial", onChange: function (e) { return updAdminRole({ sensitivity: e.target.value }); } })),
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 12, color: SUB, textTransform: "uppercase", letterSpacing: .6, marginBottom: 8 } }, "Actierechten"),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 } }, Object.entries(ACTION_LABELS).map(function (_a) {
                        var action = _a[0], label = _a[1];
                        var checked = (adminRole.actions || []).includes(action);
                        return React.createElement("button", { key: action, onClick: function () { var old = adminRole.actions || []; var next = checked ? old.filter(function (x) { return x !== action; }) : __spreadArray(__spreadArray([], old, true), [action], false); updAdminRole({ actions: next }); }, style: { border: "1px solid ".concat(checked ? GRN : BOR), background: checked ? GRN + "12" : BG, color: checked ? GRN : SUB, borderRadius: 8, padding: "7px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer" } }, label);
                    })),
                    React.createElement("div", { style: { background: BG, border: "1px solid ".concat(BOR), borderRadius: 8, padding: 12, fontSize: 12, color: SUB, lineHeight: 1.5 } },
                        React.createElement("strong", { style: { color: TXT } }, "Effect: "),
                        "Admin ziet ", (adminRole.permissions || []).length, " modules en mag ", (adminRole.actions || []).map(function (a) { return ACTION_LABELS[a]; }).join(", ") || "geen acties", ".")))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(320px,.7fr)", gap: 14, marginBottom: 14 } },
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement(SectionTitle, { icon: "€", title: "Prijzen en bundels", sub: "Pas prijzen, trials en inbegrepen onderdelen aan. Billing gebruikt deze waarden direct.", right: React.createElement(Chip, { label: "Live pricing", color: GRN }) }),
                React.createElement("div", { style: { display: "grid", gap: 12 } }, (cfg.plans || []).map(function (p) { return React.createElement("div", { key: p.id, style: { padding: 12, border: "1px solid ".concat(p.active !== false ? p.color + "35" : BOR), borderRadius: 8, background: p.active !== false ? p.color + "08" : BG } },
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "42px minmax(180px,1fr) 110px 96px 72px", gap: 10, alignItems: "center" } },
                        React.createElement("div", { style: { width: 34, height: 34, borderRadius: 8, background: p.color + "18", color: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 } }, p.name.slice(0, 1)),
                        React.createElement(Inp, { label: p.name, value: p.tagline || "", onChange: function (e) { return updPlan(p.id, { tagline: e.target.value }); }, style: miniInputStyle }),
                        React.createElement(Inp, { label: "EUR/user", type: "number", value: p.pricePerUser, onChange: function (e) { return updPlan(p.id, { pricePerUser: Number(e.target.value || 0) }); }, style: miniInputStyle }),
                        React.createElement(Inp, { label: "Trial", type: "number", value: p.trialDays || 0, onChange: function (e) { return updPlan(p.id, { trialDays: Number(e.target.value || 0) }); }, style: miniInputStyle }),
                        React.createElement("label", { style: { justifySelf: "end", fontSize: 11, color: p.active !== false ? GRN : MUT, fontWeight: 800, display: "flex", gap: 7, alignItems: "center" } },
                            React.createElement("input", { type: "checkbox", checked: p.active !== false, onChange: function (e) { return updPlan(p.id, { active: e.target.checked }); }, style: { accentColor: BLU } }),
                            p.active !== false ? "Aan" : "Uit")),
                    React.createElement("div", { style: { marginTop: 10, paddingTop: 10, borderTop: "1px solid ".concat(BOR) } },
                        React.createElement("div", { style: { fontSize: 11, fontWeight: 900, color: TXT, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0 } }, "Onderdelen in bundel"),
                        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } }, PLAN_ITEMS.map(function (item) {
                            var label = item[1];
                            var included = (p.features || []).indexOf(label) >= 0;
                            return React.createElement("button", { key: item[0], type: "button", onClick: function () { return togglePlanFeature(p, label); }, style: { border: "1px solid ".concat(included ? p.color + "55" : BOR), background: included ? p.color + "12" : "#fff", color: included ? TXT : SUB, borderRadius: 8, padding: "7px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer" } }, included ? "✓ " : "+ ", label);
                        })))); }))),
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement(SectionTitle, { icon: "B", title: "Billing beleid", sub: "Globale facturatie-instellingen voor alle tenants." }),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
                    React.createElement(Inp, { label: "BTW %", type: "number", value: (cfg.billing || {}).vatRate, onChange: function (e) { return updBilling("vatRate", Number(e.target.value || 0)); } }),
                    React.createElement(Inp, { label: "Jaarkorting %", type: "number", value: (cfg.billing || {}).yearlyDiscount, onChange: function (e) { return updBilling("yearlyDiscount", Number(e.target.value || 0)); } }),
                    React.createElement(Inp, { label: "Trial standaard", type: "number", value: (cfg.billing || {}).defaultTrialDays, onChange: function (e) { return updBilling("defaultTrialDays", Number(e.target.value || 0)); } }),
                    React.createElement(Inp, { label: "Factuurprefix", value: (cfg.billing || {}).invoicePrefix, onChange: function (e) { return updBilling("invoicePrefix", e.target.value); } })),
                React.createElement(Inp, { label: "Dunning dagen", value: (cfg.billing || {}).dunningDays || "", onChange: function (e) { return updBilling("dunningDays", e.target.value); } }),
                React.createElement(ToggleLine, { label: "Pro rata verrekening", checked: (cfg.billing || {}).proration, onChange: function (v) { return updBilling("proration", v); }, sub: "Bij planwijzigingen midden in een periode." }))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 } },
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement(SectionTitle, { icon: "M", title: "Extra modules", sub: "Beheer add-ons die klanten bovenop hun plan kunnen activeren." }),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 10 } }, (cfg.modules || []).map(function (m) { return React.createElement("div", { key: m.id, style: { border: "1px solid ".concat(m.active !== false ? m.color + "35" : BOR), background: m.active !== false ? m.color + "08" : BG, borderRadius: 8, padding: 12 } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                            React.createElement("div", { style: { width: 30, height: 30, borderRadius: 8, background: m.color + "18", color: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 } }, m.icon),
                            React.createElement("div", { style: { fontWeight: 800, fontSize: 13, color: TXT } }, m.name)),
                        React.createElement("label", { style: { fontSize: 11, color: m.active !== false ? GRN : MUT, fontWeight: 800, display: "flex", gap: 6, alignItems: "center" } },
                            React.createElement("input", { type: "checkbox", checked: m.active !== false, onChange: function (e) { return updModule(m.id, { active: e.target.checked }); }, style: { accentColor: BLU } }),
                            m.active !== false ? "Aan" : "Uit")),
                    React.createElement(Inp, { label: "Omschrijving", value: m.desc || "", onChange: function (e) { return updModule(m.id, { desc: e.target.value }); }, style: miniInputStyle }),
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "92px 1fr", gap: 8, alignItems: "end" } },
                        React.createElement(Inp, { label: "Prijs", type: "number", value: m.price, onChange: function (e) { return updModule(m.id, { price: Number(e.target.value || 0) }); }, style: miniInputStyle }),
                        React.createElement("div", { style: { fontSize: 11, color: SUB, paddingBottom: 10 } }, "per ", m.per))); }))),
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement(SectionTitle, { icon: "S", title: "Stripe configuratie", sub: "Beheer test/live status en webhookconfiguratie.", right: React.createElement(Chip, { label: ((cfg.stripe || {}).secretKeyConfigured ? "Secret ok" : "Secret mist"), color: (cfg.stripe || {}).secretKeyConfigured ? GRN : AMB }) }),
                React.createElement("div", { style: { background: AMBL, border: "1px solid #FDE68A", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#92400E", marginBottom: 14, lineHeight: 1.45 } }, "Demo bewaart enkel status en placeholders. Productie moet secrets server-side versleuteld bewaren."),
                React.createElement(Sel, { label: "Mode", opts: [["test", "Test mode"], ["live", "Live mode"]], value: (cfg.stripe || {}).mode, onChange: function (e) { return updStripe("mode", e.target.value); } }),
                React.createElement(Inp, { label: "Publishable key", value: (cfg.stripe || {}).publishableKey || "", onChange: function (e) { return updStripe("publishableKey", e.target.value); } }),
                React.createElement(Inp, { label: "Webhook URL", value: (cfg.stripe || {}).webhookUrl || "", onChange: function (e) { return updStripe("webhookUrl", e.target.value); } }),
                React.createElement(ToggleLine, { label: "Secret key ingesteld", checked: (cfg.stripe || {}).secretKeyConfigured, onChange: function (v) { return updStripe("secretKeyConfigured", v); } }),
                React.createElement(ToggleLine, { label: "Webhook secret ingesteld", checked: (cfg.stripe || {}).webhookSecretConfigured, onChange: function (v) { return updStripe("webhookSecretConfigured", v); } }),
                React.createElement(ToggleLine, { label: "Customer portal actief", checked: (cfg.stripe || {}).customerPortal, onChange: function (v) { return updStripe("customerPortal", v); } }))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } },
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement(SectionTitle, { icon: "F", title: "Feature flags", sub: "Zet platformfuncties gecontroleerd aan of uit." }),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 8 } }, Object.keys(cfg.featureFlags || {}).map(function (key) { return React.createElement("div", { key: key, style: { border: "1px solid ".concat(cfg.featureFlags[key] ? BLUB : BOR), background: cfg.featureFlags[key] ? BLUL : BG, borderRadius: 8, padding: "10px 12px" } },
                    React.createElement(ToggleLine, { label: key, checked: cfg.featureFlags[key], onChange: function (v) { return updFlag(key, v); } })); }))),
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement(SectionTitle, { icon: "A", title: "Support toegang", sub: "Alleen klanten met actieve toestemming kunnen worden overgenomen." }),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
                    React.createElement(Inp, { label: "Max sessie minuten", type: "number", value: (cfg.support || {}).maxSessionMinutes, onChange: function (e) { return updSupport("maxSessionMinutes", Number(e.target.value || 0)); } }),
                    React.createElement(Inp, { label: "Toestemming dagen", type: "number", value: (cfg.support || {}).defaultConsentDays, onChange: function (e) { return updSupport("defaultConsentDays", Number(e.target.value || 0)); } })),
                React.createElement(ToggleLine, { label: "Klanttoestemming verplicht", checked: (cfg.support || {}).requireTenantConsent, onChange: function (v) { return updSupport("requireTenantConsent", v); } }),
                tenants.map(function (t) {
                    var support = t.supportAccess || {};
                    var allowed = supportAllowed(support);
                    return React.createElement("div", { key: t.id, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 12px", border: "1px solid ".concat(allowed ? GRN + "33" : BOR), borderRadius: 8, background: allowed ? GRNL : BG, marginTop: 8 } },
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: TXT } }, t.name),
                            React.createElement("div", { style: { fontSize: 11, color: allowed ? GRN : MUT } }, allowed ? support.autoRenew ? "Doorlopende supporttoegang actief" : "Toegestaan tot ".concat(fD(support.expiresAt)) : "Geen actieve toestemming")),
                        React.createElement("div", { style: { display: "flex", gap: 6 } },
                            React.createElement(Btn, { sm: true, v: "ghost", onClick: function () { return extendSupport(t); } }, "Verleng"),
                            React.createElement(Btn, { sm: true, v: allowed ? "accent" : "subtle", disabled: !allowed, onClick: function () { return supportLogin(t); } }, "Login als klant")));
                }))));
}
function RapportPage(_a) {
    var user = _a.user, allUsers = _a.allUsers, allShifts = _a.allShifts, allClocks = _a.allClocks, allExp = _a.allExp, allWO = _a.allWO, allLeaves = _a.allLeaves, venues = _a.venues, customTypes = _a.customTypes;
    var _b = useState("all"), vid = _b[0], setVid = _b[1];
    var _c = useState(gd(-30)), dateFrom = _c[0], setDateFrom = _c[1];
    var _d = useState(TODAY), dateTo = _d[0], setDateTo = _d[1];
    var myV = scopeV(venues, user);
    var myU = scopeU(allUsers, user);
    var inRange = function (d) { return d >= dateFrom && d <= dateTo; };
    var fCl = scopeC(allClocks, user, allUsers).filter(function (c) { return vid === "all" ? true : c.venueId === vid; }).filter(function (c) { return inRange(c.date); });
    var fEx = scopeE(allExp, user, allUsers).filter(function (e) { return vid === "all" ? true : e.venueId === vid; }).filter(function (e) { return inRange(e.date); });
    var fWO = scopeW(allWO, user, allUsers).filter(function (w) { return vid === "all" ? true : w.venueId === vid; }).filter(function (w) { return inRange(w.date); });
    var fLv = scopeL(allLeaves, user, allUsers);
    var totH = fCl.filter(function (c) { return c.clockOut; }).reduce(function (a, c) { return a + parseFloat(hH(c.clockIn, c.clockOut)); }, 0);
    var totE = fEx.filter(function (e) { return ["approved", "paid"].includes(e.status); }).reduce(function (a, e) { return a + e.amount; }, 0);
    var totKm = fEx.filter(function (e) { return e.category === "kilometers" && ["approved", "paid"].includes(e.status); }).reduce(function (a, e) { return a + (e.kmCount || 0); }, 0);
    var billH = fWO.reduce(function (a, w) { return a + (w.billableHours || 0); }, 0);
    var appPct = fEx.filter(function (e) { return e.status !== "draft"; }).length ? Math.round((fEx.filter(function (e) { return ["approved", "paid"].includes(e.status); }).length / Math.max(fEx.filter(function (e) { return e.status !== "draft"; }).length, 1)) * 100) : 0;
    var last7 = Array.from({ length: 7 }, function (_, i) { return gd(-(6 - i)); });
    var dayH = last7.map(function (d) { return ({ d: fS(d), h: fCl.filter(function (c) { return c.date === d && c.clockOut; }).reduce(function (a, c) { return a + parseFloat(hH(c.clockIn, c.clockOut)); }, 0) }); });
    var maxDH = Math.max.apply(Math, __spreadArray(__spreadArray([], dayH.map(function (d) { return d.h; }), false), [1], false));
    var uHrs = myU.map(function (u) { return ({ name: u.name.split(" ")[0], h: fCl.filter(function (c) { return c.userId === u.id && c.clockOut; }).reduce(function (a, c) { return a + parseFloat(hH(c.clockIn, c.clockOut)); }, 0) }); }).sort(function (a, b) { return b.h - a.h; });
    var maxUH = Math.max.apply(Math, __spreadArray(__spreadArray([], uHrs.map(function (u) { return u.h; }), false), [1], false));
    var expCat = Object.keys(CAT_IC).map(function (cat) { return ({ cat: cat, tot: fEx.filter(function (e) { return e.category === cat && ["approved", "paid"].includes(e.status); }).reduce(function (a, e) { return a + e.amount; }, 0) }); }).filter(function (x) { return x.tot > 0; }).sort(function (a, b) { return b.tot - a.tot; }).slice(0, 7);
    var maxEC = Math.max.apply(Math, __spreadArray(__spreadArray([], expCat.map(function (e) { return e.tot; }), false), [1], false));
    var ECOLS = [BLU, GRN, AMB, PUR, TEAL, RED, "#B45309"];
    var taskTypes = __spreadArray([], new Set(fEx.filter(function (e) { return e.category !== "overig"; }).map(function (e) { return e.category; }).concat(customTypes.filter(function (t) { return t.tenantId === user.tenantId; }).map(function (t) { return t.name; }))), true);
    var taskCounts = customTypes.filter(function (t) { return t.tenantId === user.tenantId; }).map(function (t) { return ({ name: t.name, n: allShifts.filter(function (s) { return s.type === t.name && inRange(s.date); }).length, color: t.color }); }).filter(function (x) { return x.n > 0; });
    var maxTC = Math.max.apply(Math, __spreadArray(__spreadArray([], taskCounts.map(function (x) { return x.n; }), false), [1], false));
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Rapportages", sub: "Overzicht en analyse van uw personeelsdata", action: React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
                myV.length > 1 && React.createElement("select", { value: vid, onChange: function (e) { return setVid(e.target.value); }, style: { border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "6px 11px", fontSize: 12, fontFamily: "inherit", background: SUR } },
                    React.createElement("option", { value: "all" }, "Alle venues"),
                    myV.map(function (v) { return React.createElement("option", { key: v.id, value: v.id }, v.name); })),
                React.createElement("input", { type: "date", value: dateFrom, onChange: function (e) { return setDateFrom(e.target.value); }, style: { border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "6px 11px", fontSize: 12, fontFamily: "inherit" } }),
                React.createElement("span", { style: { fontSize: 12, color: SUB } }, "\u2192"),
                React.createElement("input", { type: "date", value: dateTo, onChange: function (e) { return setDateTo(e.target.value); }, style: { border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "6px 11px", fontSize: 12, fontFamily: "inherit" } }),
                React.createElement(Btn, { sm: true, v: "ghost", onClick: function () { setDateFrom(gd(-30)); setDateTo(TODAY); } }, "Reset")) }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", gap: 12, marginBottom: 22 } },
            React.createElement(KPI, { icon: "\u23F1", label: "Totaal uren", value: totH.toFixed(0) + "u", color: BLU }),
            React.createElement(KPI, { icon: "\uD83D\uDCB8", label: "Goedgekeurde onk.", value: "€" + totE.toFixed(0), color: AMB }),
            React.createElement(KPI, { icon: "\u2705", label: "Goedkeuringsgraad", value: appPct + "%", color: GRN }),
            React.createElement(KPI, { icon: "\uD83D\uDCCB", label: "Werkbonnen", value: fWO.length, color: PUR }),
            React.createElement(KPI, { icon: "\uD83D\uDCBC", label: "Billable uren", value: billH.toFixed(1) + "u", color: TEAL }),
            React.createElement(KPI, { icon: "\uD83D\uDE97", label: "KM vergoeding", value: totKm + " km", color: "#B45309" })),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 } },
            React.createElement("div", { style: { background: SUR, borderRadius: 14, padding: "18px 20px", border: "1px solid ".concat(BOR), boxShadow: SH } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 14 } }, "\u23F1 Uren afgelopen 7 dagen"),
                React.createElement("div", { style: { display: "flex", alignItems: "flex-end", gap: 6, height: 120 } }, dayH.map(function (d, i) { return React.createElement("div", { key: i, style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 } },
                    React.createElement("div", { style: { fontSize: 9, color: SUB, fontWeight: 600, minHeight: 12 } }, d.h > 0 ? d.h.toFixed(0) : ""),
                    React.createElement("div", { style: { width: "100%", background: d.h > 0 ? BLU : BOR, borderRadius: "3px 3px 0 0", height: "".concat(Math.max((d.h / maxDH) * 90, d.h > 0 ? 4 : 2), "px"), transition: "height .3s" } }),
                    React.createElement("div", { style: { fontSize: 9, color: MUT, textAlign: "center" } }, d.d.split(" ")[0])); }))),
            React.createElement("div", { style: { background: SUR, borderRadius: 14, padding: "18px 20px", border: "1px solid ".concat(BOR), boxShadow: SH } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 14 } }, "\uD83D\uDC65 Uren per medewerker"),
                uHrs.map(function (u, i) { return React.createElement("div", { key: i, style: { marginBottom: 8 } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 3 } },
                        React.createElement("span", { style: { fontSize: 12, color: TXT, fontWeight: 500 } }, u.name),
                        React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: BLU } },
                            u.h.toFixed(1),
                            "u")),
                    React.createElement("div", { style: { height: 6, background: BOR, borderRadius: 3, overflow: "hidden" } },
                        React.createElement("div", { style: { width: "".concat((u.h / maxUH) * 100, "%"), height: "100%", background: BLU, borderRadius: 3 } }))); }))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 } },
            React.createElement("div", { style: { background: SUR, borderRadius: 14, padding: "18px 20px", border: "1px solid ".concat(BOR), boxShadow: SH } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 14 } }, "\uD83D\uDCB8 Onkosten per categorie"),
                expCat.length === 0 ? React.createElement("div", { style: { textAlign: "center", padding: "20px", color: MUT, fontSize: 13 } }, "Geen data in periode") : expCat.map(function (e, i) { return React.createElement("div", { key: i, style: { marginBottom: 8 } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 3 } },
                        React.createElement("span", { style: { fontSize: 12, color: TXT, fontWeight: 500 } },
                            CAT_IC[e.cat],
                            " ",
                            e.cat),
                        React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: ECOLS[i % 7] } },
                            "\u20AC",
                            e.tot.toFixed(0))),
                    React.createElement("div", { style: { height: 6, background: BOR, borderRadius: 3, overflow: "hidden" } },
                        React.createElement("div", { style: { width: "".concat((e.tot / maxEC) * 100, "%"), height: "100%", background: ECOLS[i % 7], borderRadius: 3 } }))); })),
            React.createElement("div", { style: { background: SUR, borderRadius: 14, padding: "18px 20px", border: "1px solid ".concat(BOR), boxShadow: SH } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 14 } }, "\uD83D\uDD27 Taakvelden in periode"),
                taskCounts.length === 0 ? React.createElement("div", { style: { textAlign: "center", padding: "20px", color: MUT, fontSize: 13 } }, "Geen taakvelden gepland") : taskCounts.map(function (t, i) { return React.createElement("div", { key: i, style: { marginBottom: 8 } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 3 } },
                        React.createElement("span", { style: { fontSize: 12, color: TXT, fontWeight: 500 } }, t.name),
                        React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: t.color } },
                            t.n,
                            "\u00D7")),
                    React.createElement("div", { style: { height: 6, background: BOR, borderRadius: 3, overflow: "hidden" } },
                        React.createElement("div", { style: { width: "".concat((t.n / maxTC) * 100, "%"), height: "100%", background: t.color, borderRadius: 3 } }))); }))),
        React.createElement("div", { style: { background: SUR, borderRadius: 14, padding: "18px 20px", border: "1px solid ".concat(BOR), boxShadow: SH, marginBottom: 14 } },
            React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 14 } },
                "\uD83D\uDC65 Medewerkers detail \u2014 ",
                fD(dateFrom),
                " t/m ",
                fD(dateTo)),
            React.createElement("div", { style: { overflowX: "auto" } },
                React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
                    React.createElement("thead", null,
                        React.createElement("tr", { style: { background: BG } }, ["Medewerker", "Rol", "Uren", "Onkosten", "Km", "Werkbonnen", "Billable u"].map(function (h) { return React.createElement("th", { key: h, style: { padding: "8px 12px", textAlign: "left", fontWeight: 600, color: SUB, fontSize: 11, textTransform: "uppercase", letterSpacing: .5, borderBottom: "1px solid ".concat(BOR) } }, h); }))),
                    React.createElement("tbody", null, myU.map(function (u) {
                        var uH = fCl.filter(function (c) { return c.userId === u.id && c.clockOut; }).reduce(function (a, c) { return a + parseFloat(hH(c.clockIn, c.clockOut)); }, 0);
                        var uE = fEx.filter(function (e) { return e.userId === u.id && ["approved", "paid"].includes(e.status); }).reduce(function (a, e) { return a + e.amount; }, 0);
                        var uKm = fEx.filter(function (e) { return e.userId === u.id && e.category === "kilometers"; }).reduce(function (a, e) { return a + (e.kmCount || 0); }, 0);
                        var uW = fWO.filter(function (w) { return w.userId === u.id; }).length;
                        var uBH = fWO.filter(function (w) { return w.userId === u.id; }).reduce(function (a, w) { return a + (w.billableHours || 0); }, 0);
                        return React.createElement("tr", { key: u.id, style: { borderBottom: "1px solid ".concat(BOR) }, onMouseEnter: function (e) { return e.currentTarget.style.background = BG; }, onMouseLeave: function (e) { return e.currentTarget.style.background = ""; } },
                            React.createElement("td", { style: { padding: "10px 12px" } },
                                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                                    React.createElement(Av, { u: u, sz: 26 }),
                                    React.createElement("span", { style: { fontWeight: 600, fontSize: 13, color: TXT } }, u.name))),
                            React.createElement("td", { style: { padding: "10px 12px" } },
                                React.createElement(RoleBadge, { role: u.role })),
                            React.createElement("td", { style: { padding: "10px 12px", fontWeight: 700, color: BLU } },
                                uH.toFixed(1),
                                "u"),
                            React.createElement("td", { style: { padding: "10px 12px", fontWeight: 700, color: AMB } },
                                "\u20AC",
                                uE.toFixed(2)),
                            React.createElement("td", { style: { padding: "10px 12px", color: SUB } }, uKm > 0 ? uKm + " km" : "—"),
                            React.createElement("td", { style: { padding: "10px 12px", color: SUB } }, uW),
                            React.createElement("td", { style: { padding: "10px 12px", fontWeight: 700, color: uBH > 0 ? PUR : MUT } }, uBH > 0 ? uBH + "u" : "—"));
                    }))))));
}
// ─── INSTELLINGEN — onkostlimieten configureren ────────────────────────────────
function AlertsPage(_a) {
    var user = _a.user, allUsers = _a.allUsers, allExp = _a.allExp, allLeaves = _a.allLeaves, allWO = _a.allWO, allStock = _a.allStock, allVehicles = _a.allVehicles, tenants = _a.tenants, venues = _a.venues, go = _a.go;
    var myV = scopeV(venues, user);
    var myU = scopeU(allUsers, user);
    var myTenant = tenants.find(function (t) { return t.id === user.tenantId; });
    var myExp = scopeE(allExp, user, allUsers);
    var myLeaves = scopeL(allLeaves, user, allUsers);
    var myWO = scopeW(allWO, user, allUsers);
    var myStock = (allStock || []).filter(function (s) { return myV.some(function (v) { return v.id === s.venueId; }); });
    var myVehicles = (allVehicles || []).filter(function (v) { return myV.some(function (venue) { return venue.id === v.venueId; }); });
    var items = [
        { id: "exp", title: "Onkosten wachten op goedkeuring", value: myExp.filter(function (e) { return e.status === "submitted"; }).length, area: "Finance", go: "expenses", color: AMB },
        { id: "leave", title: "Verlofaanvragen in behandeling", value: myLeaves.filter(function (l) { return l.status === "In behandeling"; }).length, area: "HR", go: "leaves", color: PUR },
        { id: "stock", title: "Stock onder minimum", value: myStock.filter(function (s) { return s.qty <= s.min; }).length, area: "Operations", go: "stock", color: RED },
        { id: "veh", title: "Voertuigen met service binnen 14 dagen", value: myVehicles.filter(function (v) { return v.nextService && v.nextService <= gd(14); }).length, area: "Wagenpark", go: "vehicles", color: TEAL },
        { id: "wo", title: "Werkbonnen met bijlagen te reviewen", value: myWO.filter(function (w) { return !w.reviewed && w.files.length > 0; }).length, area: "Werkbonnen", go: "workorders", color: BLU },
        { id: "support", title: "Doorlopende supporttoegang actief", value: (myTenant && myTenant.supportAccess && myTenant.supportAccess.autoRenew) ? 1 : 0, area: "Security", go: "settings", color: GRN },
    ].filter(function (x) { return x.value > 0; });
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Actiecentrum", sub: "Signalen die opvolging vragen voordat ze supporttickets worden." }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 18 } },
            React.createElement(KPI, { icon: "!", label: "Open acties", value: items.length, color: items.length ? RED : GRN }),
            React.createElement(KPI, { icon: "F", label: "Finance", value: items.filter(function (i) { return i.area === "Finance"; }).reduce(function (a, i) { return a + i.value; }, 0), color: AMB }),
            React.createElement(KPI, { icon: "O", label: "Operations", value: items.filter(function (i) { return ["Operations", "Wagenpark", "Werkbonnen"].includes(i.area); }).reduce(function (a, i) { return a + i.value; }, 0), color: BLU }),
            React.createElement(KPI, { icon: "T", label: "Team", value: myU.length, color: PUR })),
        items.length === 0 ? React.createElement(Card, { style: { padding: "24px 26px", textAlign: "center" } },
            React.createElement("div", { style: { fontWeight: 850, fontSize: 18, color: GRN, marginBottom: 4 } }, "Alles onder controle"),
            React.createElement("div", { style: { fontSize: 13, color: SUB } }, "Er zijn geen dringende product- of operationele signalen.")) : React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 } }, items.map(function (it) { return React.createElement(Card, { key: it.id, onClick: function () { return go(it.go); }, style: { padding: "16px 18px", borderLeft: "4px solid ".concat(it.color) } },
            React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontSize: 11, fontWeight: 800, color: it.color, textTransform: "uppercase", marginBottom: 4 } }, it.area),
                    React.createElement("div", { style: { fontWeight: 850, fontSize: 14, color: TXT } }, it.title),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 5 } }, "Klik om dit direct op te volgen.")),
                React.createElement("div", { style: { minWidth: 42, height: 42, borderRadius: 8, background: it.color + "12", color: it.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 20 } }, it.value))); })));
}
function OnboardingPage(_a) {
    var user = _a.user, tenants = _a.tenants, setTenants = _a.setTenants, allUsers = _a.allUsers, setUsers = _a.setUsers, venues = _a.venues, setShifts = _a.setShifts, toast = _a.toast, go = _a.go;
    if (user.role === "super_admin") {
        var toggleTenantStep = function (tenantId, step) { return setTenants(function (prev) { return prev.map(function (t) { var _a; return t.id === tenantId ? __assign(__assign({}, t), { onboarding: __assign(__assign({}, (t.onboarding || {})), (_a = {}, _a[step] = !((t.onboarding || {})[step]), _a)) }) : t; }); }); };
        var tenantProgress = tenants.map(function (t) {
            var done = t.onboarding || {};
            var keys = ["company", "venues", "employees", "roles", "planning", "billing", "integrations"];
            var pct = Math.round((keys.filter(function (k) { return done[k]; }).length / keys.length) * 100);
            var tenantUsers = allUsers.filter(function (u) { return u.tenantId === t.id; }).length;
            var tenantVenues = venues.filter(function (v) { return v.tenantId === t.id; }).length;
            return { tenant: t, pct: pct, users: tenantUsers, venues: tenantVenues };
        }).sort(function (a, b) { return a.pct - b.pct; });
        return React.createElement("div", null,
            React.createElement(PageHeader, { title: "Tenant onboarding", sub: "Super Admin workflow voor klantactivatie, setup en go-live opvolging.", action: React.createElement(Chip, { label: "Super Admin only", color: PUR }) }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 18 } },
                React.createElement(KPI, { icon: "T", label: "Tenants", value: tenants.length, color: BLU }),
                React.createElement(KPI, { icon: "%", label: "Gemiddeld klaar", value: Math.round(tenantProgress.reduce(function (a, x) { return a + x.pct; }, 0) / Math.max(tenantProgress.length, 1)) + "%", color: TEAL }),
                React.createElement(KPI, { icon: "!", label: "Onder 50%", value: tenantProgress.filter(function (x) { return x.pct < 50; }).length, color: RED }),
                React.createElement(KPI, { icon: "✓", label: "Go-live klaar", value: tenantProgress.filter(function (x) { return x.pct === 100; }).length, color: GRN })),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 } }, tenantProgress.map(function (x) { return React.createElement(Card, { key: x.tenant.id, style: { padding: "18px 20px", borderLeft: "4px solid ".concat(x.pct === 100 ? GRN : x.pct < 50 ? RED : BLU) } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 850, fontSize: 15, color: TXT } }, x.tenant.name),
                        React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 3 } }, x.users, " users · ", x.venues, " venues · ", x.tenant.plan)),
                    React.createElement(Chip, { label: x.pct + "%", color: x.pct === 100 ? GRN : x.pct < 50 ? RED : BLU })),
                React.createElement("div", { style: { height: 8, background: BOR, borderRadius: 99, overflow: "hidden", marginBottom: 10 } },
                    React.createElement("div", { style: { width: x.pct + "%", height: "100%", background: x.pct === 100 ? GRN : x.pct < 50 ? RED : BLU } })),
                React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, ["company", "venues", "employees", "roles", "planning", "billing", "integrations"].map(function (k) { var checked = (x.tenant.onboarding || {})[k]; return React.createElement("button", { key: k, onClick: function () { toggleTenantStep(x.tenant.id, k); toast("Onboarding bijgewerkt", x.tenant.name + " - " + k, "info"); }, style: { fontSize: 10, fontWeight: 800, color: checked ? GRN : MUT, background: checked ? GRNL : BG, border: "1px solid ".concat(checked ? GRN + "33" : BOR), borderRadius: 20, padding: "3px 8px", cursor: "pointer" } }, checked ? "✓ " : "", k); }))); })));
    }
    var tenant = tenants.find(function (t) { return t.id === user.tenantId; }) || {};
    var done = tenant.onboarding || {};
    var _b = useState(""), bulk = _b[0], setBulk = _b[1];
    var _c = useState({ name: tenant.name || "", billingEmail: tenant.billingEmail || "", vat: tenant.vat || "", sector: tenant.sector || "Bouw & techniek" }), company = _c[0], setCompany = _c[1];
    var primaryVenue = venues.find(function (v) { return v.tenantId === user.tenantId; });
    var firstWorker = allUsers.find(function (u) { return u.tenantId === user.tenantId && u.role !== "tenant_admin"; }) || {};
    var _d = useState({ date: TODAY, start: "08:00", end: "16:30", type: "Dagdienst", project: "Eerste klantopdracht", client: "Demo klant", userId: firstWorker.id || "", venueId: (primaryVenue === null || primaryVenue === void 0 ? void 0 : primaryVenue.id) || "" }), firstShift = _d[0], setFirstShift = _d[1];
    var steps = [
        { id: "company", title: "Bedrijfsgegevens bevestigd", go: "settings" },
        { id: "venues", title: "Venues of werven aangemaakt", go: "venues" },
        { id: "employees", title: "Medewerkers geimporteerd", go: "employees" },
        { id: "roles", title: "Rollen en rechten nagekeken", go: "employees" },
        { id: "planning", title: "Eerste planning aangemaakt", go: "planning" },
        { id: "billing", title: "Billing en betaalmethode getest", go: "billing" },
        { id: "integrations", title: "Integraties in testmodus gekoppeld", go: "integrations" },
    ];
    var pct = Math.round((steps.filter(function (s) { return done[s.id]; }).length / steps.length) * 100);
    var toggle = function (id) { return setTenants(function (prev) { return prev.map(function (t) { var _a; return t.id === user.tenantId ? __assign(__assign({}, t), { onboarding: __assign(__assign({}, (t.onboarding || {})), (_a = {}, _a[id] = !((t.onboarding || {})[id]), _a)) }) : t; }); }); };
    var mark = function (id) { return setTenants(function (prev) { return prev.map(function (t) { var _a; return t.id === user.tenantId ? __assign(__assign({}, t), { onboarding: __assign(__assign({}, (t.onboarding || {})), (_a = {}, _a[id] = true, _a)) }) : t; }); }); };
    var previewRows = bulk.split(/\r?\n/).map(function (r) { return r.trim(); }).filter(Boolean).map(function (row) { var parts = row.split(",").map(function (x) { return x.trim(); }); return { name: parts[0] || "Nieuwe medewerker", email: parts[1] || "", role: parts[2] || "employee" }; });
    var saveCompany = function () {
        setTenants(function (prev) { return prev.map(function (t) { return t.id === user.tenantId ? __assign(__assign({}, t), { name: company.name, billingEmail: company.billingEmail, vat: company.vat, sector: company.sector, onboarding: __assign(__assign({}, (t.onboarding || {})), { company: true }) }) : t; }); });
        toast("Bedrijf ingesteld", company.name, "info");
    };
    var importPeople = function () {
        var rows = bulk.split(/\r?\n/).map(function (r) { return r.trim(); }).filter(Boolean);
        if (!rows.length)
            return;
        var created = previewRows.map(function (row, i) {
            var name = row.name || "Nieuwe medewerker";
            var email = row.email || "medewerker".concat(Date.now()).concat(i, "@example.be");
            var role = row.role || "employee";
            return { id: Date.now() + i, name: name, ini: name.split(" ").slice(0, 2).map(function (w) { return w[0] || ""; }).join("").toUpperCase(), email: email, phone: "", dept: "Nieuw", role: role, hue: Math.floor(Math.random() * 360), tenantId: user.tenantId, venueIds: primaryVenue ? [primaryVenue.id] : [], primaryVenueId: primaryVenue === null || primaryVenue === void 0 ? void 0 : primaryVenue.id, active: true, permissions: ROLE_DEFAULTS[role] || ROLE_DEFAULTS.employee };
        });
        setUsers(function (prev) { return __spreadArray(__spreadArray([], prev, true), created, false); });
        setBulk("");
        toast("Import verwerkt", "".concat(created.length, " medewerkers toegevoegd"), "info");
        setTenants(function (prev) { return prev.map(function (t) { return t.id === user.tenantId ? __assign(__assign({}, t), { onboarding: __assign(__assign({}, (t.onboarding || {})), { employees: true }) }) : t; }); });
    };
    var createFirstPlanning = function () {
        if (!setShifts || !firstShift.userId || !firstShift.venueId)
            return toast("Planning niet compleet", "Kies medewerker en venue.", "warn");
        setShifts(function (prev) { return __spreadArray(__spreadArray([], prev, true), [__assign(__assign({}, firstShift), { id: Date.now(), userId: Number(firstShift.userId), taskTypeId: "", note: "Aangemaakt via onboarding", billable: true })], false); });
        mark("planning");
        toast("Eerste planning aangemaakt", firstShift.project, "info");
    };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Onboarding", sub: "Breng een nieuwe tenant gecontroleerd naar go-live.", action: React.createElement(Chip, { label: pct + "% klaar", color: pct === 100 ? GRN : BLU }) }),
        React.createElement(Card, { style: { padding: 18, marginBottom: 14 } },
            React.createElement("div", { style: { height: 9, background: BOR, borderRadius: 99, overflow: "hidden", marginBottom: 14 } },
                React.createElement("div", { style: { width: pct + "%", height: "100%", background: pct === 100 ? GRN : BLU } })),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 } }, steps.map(function (s, i) { return React.createElement("div", { key: s.id, style: { border: "1px solid ".concat(done[s.id] ? GRN + "55" : BOR), background: done[s.id] ? GRNL : SUR, borderRadius: 8, padding: 12 } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 800, fontSize: 13, color: TXT } }, i + 1, ". ", s.title),
                        React.createElement("button", { onClick: function () { return go(s.go); }, style: { marginTop: 5, border: "none", background: "transparent", color: BLU, fontSize: 11, fontWeight: 800, cursor: "pointer", padding: 0 } }, "Open module")),
                    React.createElement("input", { type: "checkbox", checked: !!done[s.id], onChange: function () { return toggle(s.id); }, style: { width: 18, height: 18, accentColor: GRN } }))); }))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 } },
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 4 } }, "Wizard: bedrijf instellen"),
                React.createElement("div", { style: { fontSize: 12, color: SUB, marginBottom: 12 } }, "Leg tenantnaam, facturatie en sector vast voordat je gebruikers importeert."),
                React.createElement(Inp, { label: "Bedrijfsnaam", value: company.name, onChange: function (e) { return setCompany(__assign(__assign({}, company), { name: e.target.value })); } }),
                React.createElement(Inp, { label: "Billing e-mail", value: company.billingEmail, onChange: function (e) { return setCompany(__assign(__assign({}, company), { billingEmail: e.target.value })); } }),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
                    React.createElement(Inp, { label: "BTW nummer", value: company.vat, onChange: function (e) { return setCompany(__assign(__assign({}, company), { vat: e.target.value })); } }),
                    React.createElement(Sel, { label: "Sector", opts: ["Bouw & techniek", "Logistiek", "Schoonmaak", "Installatie", "Andere"], value: company.sector, onChange: function (e) { return setCompany(__assign(__assign({}, company), { sector: e.target.value })); } })),
                React.createElement(Btn, { onClick: saveCompany, disabled: !company.name || !company.billingEmail }, "Bedrijf opslaan")),
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 4 } }, "Excel/CSV preview"),
                React.createElement("div", { style: { fontSize: 12, color: SUB, marginBottom: 12 } }, "Plak regels als: Naam, email, rol. Controleer de preview voor import."),
                React.createElement(Inp, { ta: true, rows: 7, value: bulk, onChange: function (e) { return setBulk(e.target.value); }, placeholder: "Sofie Peeters, sofie@bedrijf.be, employee\nTom Janssens, tom@bedrijf.be, venue_manager" }),
                previewRows.length > 0 && React.createElement("div", { style: { border: "1px solid ".concat(BOR), borderRadius: 8, overflow: "hidden", marginBottom: 12 } }, previewRows.slice(0, 5).map(function (r, i) { return React.createElement("div", { key: i, style: { display: "grid", gridTemplateColumns: "1fr 1.2fr 95px", gap: 8, padding: "7px 10px", borderBottom: "1px solid ".concat(BOR), fontSize: 11, alignItems: "center" } },
                    React.createElement("span", { style: { fontWeight: 700, color: TXT } }, r.name),
                    React.createElement("span", { style: { color: SUB } }, r.email || "email ontbreekt"),
                    React.createElement(Chip, { label: r.role, color: BLU })); })),
                React.createElement(Btn, { onClick: importPeople, disabled: !bulk.trim() }, "Importeren")),
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 4 } }, "Eerste planning aanmaken"),
                React.createElement("div", { style: { fontSize: 12, color: SUB, marginBottom: 12 } }, "Maak direct een eerste taak zodat de klant de kernflow ziet."),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
                    React.createElement(Sel, { label: "Medewerker", opts: allUsers.filter(function (u) { return u.tenantId === user.tenantId && u.role !== "tenant_admin"; }).map(function (u) { return [u.id, u.name]; }), value: firstShift.userId, onChange: function (e) { return setFirstShift(__assign(__assign({}, firstShift), { userId: e.target.value })); } }),
                    React.createElement(Sel, { label: "Venue", opts: venues.filter(function (v) { return v.tenantId === user.tenantId; }).map(function (v) { return [v.id, v.name]; }), value: firstShift.venueId, onChange: function (e) { return setFirstShift(__assign(__assign({}, firstShift), { venueId: e.target.value })); } }),
                    React.createElement(Inp, { label: "Datum", type: "date", value: firstShift.date, onChange: function (e) { return setFirstShift(__assign(__assign({}, firstShift), { date: e.target.value })); } }),
                    React.createElement(Inp, { label: "Start", type: "time", value: firstShift.start, onChange: function (e) { return setFirstShift(__assign(__assign({}, firstShift), { start: e.target.value })); } }),
                    React.createElement(Inp, { label: "Einde", type: "time", value: firstShift.end, onChange: function (e) { return setFirstShift(__assign(__assign({}, firstShift), { end: e.target.value })); } }),
                    React.createElement(Inp, { label: "Project", value: firstShift.project, onChange: function (e) { return setFirstShift(__assign(__assign({}, firstShift), { project: e.target.value })); } })),
                React.createElement(Btn, { onClick: createFirstPlanning }, "Planning aanmaken")),
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 4 } }, "Integraties koppelen"),
                [["Sociaal secretariaat", "Acerta, Liantis, SD Worx of Securex in testmodus."], ["ERP/boekhouding", "Robaws of boekhoudkoppeling met veldmapping."], ["Webhook logs", "Controleer retry en foutmeldingen voor go-live."], ["Data export", "Controleer CSV export voor boekhouding."]].map(function (x) { return React.createElement("div", { key: x[0], style: { padding: "10px 0", borderBottom: "1px solid ".concat(BOR) } },
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 13, color: TXT } }, x[0]),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } }, x[1])); })),
                React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 12 } },
                    React.createElement(Btn, { v: "ghost", onClick: function () { return go("integrations"); } }, "Open integraties"),
                    React.createElement(Btn, { onClick: function () { mark("integrations"); toast("Integraties gemarkeerd", "Testkoppelingen klaar voor go-live.", "info"); } }, "Klaarzetten"))));
}
function GoldenPathPage(_a) {
    var user = _a.user, tenants = _a.tenants, setTenants = _a.setTenants, allUsers = _a.allUsers, setUsers = _a.setUsers, venues = _a.venues, setVenues = _a.setVenues, allShifts = _a.allShifts, setShifts = _a.setShifts, allWO = _a.allWO, setWO = _a.setWO, allClocks = _a.allClocks, setClocks = _a.setClocks, go = _a.go, toast = _a.toast;
    var isSA = user.role === "super_admin";
    var _b = useState(isSA ? ((tenants[0] || {}).id) : user.tenantId), selectedTenantId = _b[0], setSelectedTenantId = _b[1];
    var tenant = tenants.find(function (t) { return t.id === selectedTenantId; }) || tenants[0] || {};
    var tenantUsers = allUsers.filter(function (u) { return u.tenantId === tenant.id && u.role !== "tenant_admin"; });
    var tenantVenues = venues.filter(function (v) { return v.tenantId === tenant.id; });
    var tenantUserIds = allUsers.filter(function (u) { return u.tenantId === tenant.id; }).map(function (u) { return u.id; });
    var tenantShifts = allShifts.filter(function (s) { return tenantUserIds.includes(s.userId); });
    var tenantWO = allWO.filter(function (w) { return tenantUserIds.includes(w.userId); });
    var tenantClocks = allClocks.filter(function (c) { return tenantUserIds.includes(c.userId); });
    var invoiceProfile = tenant.invoiceProfile || {};
    var billingOps = tenant.billingOps || {};
    var firstVenue = tenantVenues[0];
    var firstEmployee = tenantUsers[0];
    var updateTenant = function (patch) { return setTenants(function (prev) { return prev.map(function (t) { return t.id === tenant.id ? __assign(__assign({}, t), patch) : t; }); }); };
    var ensureVenue = function () {
        if (firstVenue)
            return firstVenue;
        var venue = { id: "v" + uid(), tenantId: tenant.id, name: "Eerste werf", code: "EW", color: VCOLS[0], address: "Nog aan te vullen", active: true };
        setVenues(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), [venue], false); });
        updateTenant({ venues: (tenant.venues || 0) + 1, onboarding: __assign(__assign({}, tenant.onboarding || {}), { venues: true }) });
        return venue;
    };
    var createEmployees = function () {
        if (tenantUsers.length)
            return go("employees");
        var venue = ensureVenue();
        var base = Date.now();
        var created = ["Eerste medewerker", "Tweede medewerker"].map(function (name, i) { return ({ id: base + i, name: name, ini: name.split(" ").map(function (x) { return x[0]; }).join(""), email: "medewerker".concat(i + 1, "@").concat((tenant.name || "klant").toLowerCase().replace(/[^a-z0-9]/g, ""), ".be"), phone: "", dept: "Operations", role: "employee", hue: 180 + i * 35, tenantId: tenant.id, venueIds: [venue.id], primaryVenueId: venue.id, active: true, permissions: ROLE_DEFAULTS.employee }); });
        setUsers(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), created, false); });
        updateTenant({ users: (tenant.users || 0) + created.length, onboarding: __assign(__assign({}, tenant.onboarding || {}), { employees: true }) });
        toast("Medewerkers toegevoegd", "2 demo-medewerkers aangemaakt.", "info");
    };
    var createPlanning = function () {
        var venue = ensureVenue();
        var employee = firstEmployee;
        if (!employee) {
            createEmployees();
            return toast("Medewerker nodig", "Medewerkers zijn aangemaakt. Klik daarna opnieuw op planning.", "warn");
        }
        setShifts(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), [{ id: Date.now(), userId: employee.id, venueId: venue.id, date: TODAY, start: "08:00", end: "16:30", type: "Dagdienst", taskTypeId: "", project: "Eerste klantopdracht", client: "Demo klant", note: "Aangemaakt vanuit golden path", billable: true }], false); });
        updateTenant({ onboarding: __assign(__assign({}, tenant.onboarding || {}), { planning: true }) });
        toast("Eerste planning aangemaakt", employee.name + " staat ingepland.", "info");
    };
    var createWorkorder = function () {
        var venue = ensureVenue();
        var employee = firstEmployee;
        if (!employee) {
            createEmployees();
            return toast("Medewerker nodig", "Medewerkers zijn aangemaakt. Maak daarna de werkbon.", "warn");
        }
        setWO(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), [{ id: Date.now(), userId: employee.id, venueId: venue.id, date: TODAY, title: "Eerste werkbon", client: "Demo klant", location: venue.address || venue.name, status: "Bezig", desc: "Eerste werkbon vanuit golden path.", note: "", billableHours: 0, checklist: [{ id: "cl" + uid(), label: "Werk controleren", done: false }, { id: "cl" + uid(), label: "Klant laten tekenen", done: false }], materials: [], files: [], signed: false, reviewed: false }], false); });
        toast("Eerste werkbon aangemaakt", "Open werkbonnen om details aan te vullen.", "info");
    };
    var createTime = function () {
        var venue = ensureVenue();
        var employee = firstEmployee;
        if (!employee) {
            createEmployees();
            return toast("Medewerker nodig", "Medewerkers zijn aangemaakt. Maak daarna tijdregistratie.", "warn");
        }
        setClocks(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), [{ id: Date.now(), userId: employee.id, venueId: venue.id, date: TODAY, clockIn: "08:00", clockOut: "16:30" }], false); });
        toast("Tijdregistratie toegevoegd", "8,5 uur geregistreerd voor de eerste medewerker.", "info");
    };
    var createInvoice = function () {
        var gross = Math.max(tenant.mrr || 1, 1) * 12;
        var inv = { id: "INV-" + new Date().getFullYear() + "-" + uid().toUpperCase(), at: TODAY, dueDate: gd(14), line: "Eerste jaarlicentie WorkFlow Pro", gross: gross, discountPct: Number(billingOps.discountPct || 0), net: gross, status: "draft", peppolStatus: (billingOps.peppolEnabled || invoiceProfile.peppolId) ? "ready" : "missing_peppol", note: "Aangemaakt vanuit golden path" };
        updateTenant({ billingOps: __assign(__assign({}, billingOps), { invoiceHistory: __spreadArray(__spreadArray([], billingOps.invoiceHistory || [], true), [inv], false) }), onboarding: __assign(__assign({}, tenant.onboarding || {}), { billing: true }) });
        toast("Factuur aangemaakt", inv.id, "info");
    };
    var onboardingPct = Math.round((["company", "venues", "employees", "roles", "planning", "billing", "integrations"].filter(function (k) { return (tenant.onboarding || {})[k]; }).length / 7) * 100);
    var steps = [
        { id: "tenant", title: "Nieuwe klant", body: "Klantfiche bestaat en is selecteerbaar.", done: !!tenant.id, action: "Open klanten", onClick: function () { return go("tenants"); } },
        { id: "kbo", title: "KBO opgehaald", body: "BTW, ondernemingsnummer en facturatieadres staan klaar.", done: !!(invoiceProfile.vat && invoiceProfile.companyNumber && (invoiceProfile.street || invoiceProfile.city)), action: "Klantfiche openen", onClick: function () { return go("tenants"); } },
        { id: "onboarding", title: "Onboarding checklist", body: onboardingPct + "% van de checklist klaar.", done: onboardingPct >= 70, action: "Open onboarding", onClick: function () { return go("onboarding"); } },
        { id: "employees", title: "Medewerkers import", body: tenantUsers.length + " medewerkers in deze tenant.", done: tenantUsers.length > 0, action: tenantUsers.length ? "Open medewerkers" : "Demo import", onClick: tenantUsers.length ? function () { return go("employees"); } : createEmployees },
        { id: "planning", title: "Eerste planning", body: tenantShifts.length + " planningregels aanwezig.", done: tenantShifts.length > 0, action: tenantShifts.length ? "Open planning" : "Planning maken", onClick: tenantShifts.length ? function () { return go("planning"); } : createPlanning },
        { id: "workorder", title: "Eerste werkbon", body: tenantWO.length + " werkbonnen aanwezig.", done: tenantWO.length > 0, action: tenantWO.length ? "Open werkbonnen" : "Werkbon maken", onClick: tenantWO.length ? function () { return go("workorders"); } : createWorkorder },
        { id: "time", title: "Tijdregistratie", body: tenantClocks.length + " klokregistraties aanwezig.", done: tenantClocks.some(function (c) { return !!c.clockOut; }), action: tenantClocks.some(function (c) { return !!c.clockOut; }) ? "Open uren" : "Tijd toevoegen", onClick: tenantClocks.some(function (c) { return !!c.clockOut; }) ? function () { return go("clockings"); } : createTime },
        { id: "invoice", title: "Factuur", body: ((billingOps.invoiceHistory || []).length) + " facturen in billing operations.", done: (billingOps.invoiceHistory || []).length > 0, action: (billingOps.invoiceHistory || []).length ? "Open billing" : "Factuur maken", onClick: (billingOps.invoiceHistory || []).length ? function () { return go("billing"); } : createInvoice },
    ];
    var pct = Math.round((steps.filter(function (s) { return s.done; }).length / steps.length) * 100);
    var tracks = [
        { title: "Backend foundation", status: "Architectuur vastgelegd", items: ["Auth/MFA", "tenant isolation", "server-side permissions", "PostgreSQL/Supabase", "encrypted secrets"], color: RED },
        { title: "Billing productie", status: "Flow voorbereid", items: ["Stripe SetupIntent", "PaymentMethods", "invoices", "failed payment", "Peppol provider", "enterprise contractstatus"], color: AMB },
        { title: "Mobiele veldflow", status: "Volgende slice", items: ["Vandaag-scherm", "taken", "werkbon openen", "foto upload", "handtekening", "offline/PWA"], color: BLU },
        { title: "UX saneren", status: "Doorlopend", items: ["minder losse modules", "detailpagina's", "validatie", "save-feedback", "foutmeldingen"], color: PUR },
    ];
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Golden path", sub: "Van nieuwe klant naar eerste factuur: de verkoopbare SaaS-flow in een cockpit.", action: React.createElement(Chip, { label: pct + "% klaar", color: pct === 100 ? GRN : pct >= 60 ? AMB : RED }) }),
        React.createElement(Card, { style: { padding: "18px 20px", marginBottom: 14, background: NAV_BG, color: "#fff" } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontSize: 11, fontWeight: 900, color: "#93C5FD", textTransform: "uppercase", marginBottom: 5 } }, "Geselecteerde klant"),
                    React.createElement("div", { style: { fontWeight: 900, fontSize: 22 } }, tenant.name || "Geen tenant"),
                    React.createElement("div", { style: { fontSize: 12, color: "rgba(255,255,255,.65)", marginTop: 4 } }, "KBO -> onboarding -> planning -> werkbon -> uren -> factuur")),
                isSA && React.createElement("select", { value: tenant.id, onChange: function (e) { return setSelectedTenantId(e.target.value); }, style: { minWidth: 240, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.08)", color: "#fff", borderRadius: 8, padding: "9px 11px", fontFamily: "inherit" } }, tenants.map(function (t) { return React.createElement("option", { key: t.id, value: t.id, style: { color: TXT } }, t.name); }))),
            React.createElement("div", { style: { height: 8, background: "rgba(255,255,255,.12)", borderRadius: 99, overflow: "hidden", marginTop: 16 } },
                React.createElement("div", { style: { width: pct + "%", height: "100%", background: pct === 100 ? GRN : BLU } }))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12, marginBottom: 18 } }, steps.map(function (s, i) { return React.createElement(Card, { key: s.id, style: { padding: "16px 18px", borderLeft: "4px solid ".concat(s.done ? GRN : AMB) } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 9 } },
                React.createElement("div", { style: { width: 28, height: 28, borderRadius: 8, background: s.done ? GRNL : AMBL, color: s.done ? GRN : AMB, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 } }, s.done ? "✓" : i + 1),
                React.createElement(Chip, { label: s.done ? "klaar" : "nodig", color: s.done ? GRN : AMB })),
            React.createElement("div", { style: { fontWeight: 900, fontSize: 15, color: TXT, marginBottom: 4 } }, s.title),
            React.createElement("div", { style: { fontSize: 12, color: SUB, minHeight: 36, lineHeight: 1.45, marginBottom: 12 } }, s.body),
            React.createElement(Btn, { sm: true, v: s.done ? "ghost" : "pri", full: true, onClick: s.onClick }, s.action)); })),
        React.createElement(PageHeader, { title: "Go-live werksporen", sub: "De resterende product owner stappen na de golden path." }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 } }, tracks.map(function (t) { return React.createElement(Card, { key: t.title, style: { padding: "17px 18px", borderTop: "3px solid ".concat(t.color) } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 } },
                React.createElement("div", { style: { fontWeight: 900, fontSize: 15, color: TXT } }, t.title),
                React.createElement(Chip, { label: t.status, color: t.color })),
            React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, t.items.map(function (x) { return React.createElement("span", { key: x, style: { fontSize: 10, color: SUB, background: BG, border: "1px solid ".concat(BOR), borderRadius: 20, padding: "2px 7px" } }, x); }))); })));
}
function DataHubPage(_a) {
    var user = _a.user, allUsers = _a.allUsers, setUsers = _a.setUsers, venues = _a.venues, setVenues = _a.setVenues, allExp = _a.allExp, allWO = _a.allWO, allStock = _a.allStock, setStock = _a.setStock, customers = _a.customers, setCustomers = _a.setCustomers, vehicles = _a.vehicles, setVehicles = _a.setVehicles, tenants = _a.tenants, toast = _a.toast;
    var _b = useState("employees"), importType = _b[0], setImportType = _b[1];
    var _c = useState(""), importText = _c[0], setImportText = _c[1];
    var myV = scopeV(venues, user);
    var isPlatformDatahub = user.role === "super_admin" && !user.supportSession;
    var defaultVenueId = (myV[0] || {}).id || user.primaryVenueId || "v1";
    var parseCsv = function (text) {
        var lines = text.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (!lines.length)
            return [];
        var sep = lines[0].indexOf(";") >= 0 ? ";" : ",";
        var headers = lines[0].split(sep).map(function (h) { return h.trim().toLowerCase(); });
        return lines.slice(1).map(function (line) {
            var cells = line.split(sep).map(function (c) { return c.trim(); });
            return headers.reduce(function (row, h, i) {
                row[h] = cells[i] || "";
                return row;
            }, {});
        });
    };
    var importRows = parseCsv(importText);
    var IMPORTS = {
        employees: { label: "Medewerkers", hint: "name,email,role,dept,phone", sample: "name,email,role,dept,phone\nSofie Peeters,sofie@bedrijf.be,employee,Operations,+32470111222" },
        customers: { label: "Klanten", hint: "name,contact,email,vat,status,sector", sample: "name,contact,email,vat,status,sector\nACME BV,Jan Janssens,jan@acme.be,BE0123456789,active,Bouw" },
        venues: { label: "Venues", hint: "name,code,address,active", sample: "name,code,address,active\nWerf Antwerpen,WA,Kaai 12 Antwerpen,true" },
        stock: { label: "Stock", hint: "name,sku,qty,min,unit,cat,loc,venueCode", sample: "name,sku,qty,min,unit,cat,loc,venueCode\nSchroeven,SC-001,120,25,st,Verbruik,Rek A,HK" },
        vehicles: { label: "Voertuigen", hint: "plate,brand,year,km,status,fuel,venueCode", sample: "plate,brand,year,km,status,fuel,venueCode\n1-XYZ-999,Ford Transit,2024,12500,Beschikbaar,Diesel,HK" },
    };
    var importPreview = importRows.slice(0, 5);
    var venueByCode = function (code) { return myV.find(function (v) { return String(v.code || "").toLowerCase() === String(code || "").toLowerCase(); }); };
    var runImport = function () {
        if (isPlatformDatahub)
            return toast("Import geblokkeerd", "Klantdata importeer je vanuit tenantcontext of supportsessie.", "warn");
        if (!importRows.length)
            return toast("Geen importdata", "Plak eerst CSV-data met een headerregel.", "warn");
        if (importType === "employees" && setUsers)
            setUsers(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), importRows.map(function (r, i) {
                var name = r.name || r.naam || "Nieuwe medewerker";
                return { id: Date.now() + i, name: name, ini: name.split(" ").slice(0, 2).map(function (w) { return w[0] || ""; }).join("").toUpperCase(), email: r.email || "", phone: r.phone || r.telefoon || "", dept: r.dept || r.afdeling || "Nieuw", role: r.role || "employee", hue: Math.floor(Math.random() * 360), tenantId: user.tenantId || "t1", venueIds: [defaultVenueId], primaryVenueId: defaultVenueId, active: true, permissions: ROLE_DEFAULTS[r.role] || ROLE_DEFAULTS.employee };
            }), false); });
        if (importType === "customers" && setCustomers)
            setCustomers(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), importRows.map(function (r) { return { id: "cu_" + uid(), tenantId: user.tenantId || "t1", name: r.name || r.naam || "Nieuwe klant", type: "bedrijf", status: r.status || "active", vat: r.vat || r.btw || "", email: r.email || "", phone: r.phone || "", address: r.address || r.adres || "", contact: r.contact || "", ownerId: user.id, sector: r.sector || "", paymentTerms: r.paymentterms || r.betaling || "30 dagen", note: r.note || "", tags: [] }; }), false); });
        if (importType === "venues" && setVenues)
            setVenues(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), importRows.map(function (r, i) { return { id: "v" + uid(), tenantId: user.tenantId || "t1", name: r.name || r.naam || "Nieuwe venue", code: (r.code || ("V" + (i + 1))).toUpperCase().slice(0, 3), color: VCOLS[i % VCOLS.length], address: r.address || r.adres || "", active: String(r.active || "true").toLowerCase() !== "false" }; }), false); });
        if (importType === "stock" && setStock)
            setStock(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), importRows.map(function (r, i) { var v = venueByCode(r.venuecode || r.venue || r.code); return { id: Date.now() + i, venueId: (v === null || v === void 0 ? void 0 : v.id) || defaultVenueId, name: r.name || r.naam || "Artikel", sku: r.sku || "", qty: Number(r.qty || r.aantal || 0), min: Number(r.min || 0), unit: r.unit || "st", cat: r.cat || r.categorie || "Overig", loc: r.loc || r.locatie || "" }; }), false); });
        if (importType === "vehicles" && setVehicles)
            setVehicles(function (prev) { return __spreadArray(__spreadArray([], prev || [], true), importRows.map(function (r, i) { var v = venueByCode(r.venuecode || r.venue || r.code); return { id: Date.now() + i, venueId: (v === null || v === void 0 ? void 0 : v.id) || defaultVenueId, plate: r.plate || r.kenteken || r.nummerplaat || "", brand: r.brand || r.merk || "", year: Number(r.year || r.jaar || new Date().getFullYear()), km: Number(r.km || 0), status: r.status || "Beschikbaar", assignedTo: null, nextService: r.nextservice || r.service || gd(90), fuel: r.fuel || r.brandstof || "", notes: r.notes || r.notities || "" }; }), false); });
        toast("Import verwerkt", "".concat(importRows.length, " rijen toegevoegd aan ").concat(IMPORTS[importType].label), "info");
        setImportText("");
    };
    var rowsToCsv = function (rows) { if (!rows.length)
        return ""; var keys = Object.keys(rows[0]); return __spreadArray([keys.join(",")], rows.map(function (r) { return keys.map(function (k) { return '"'.concat(String(r[k] == null ? "" : r[k]).replace(/"/g, '""'), '"'); }).join(","); }), true).join("\n"); };
    var downloadCsv = function (name, rows) {
        var blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        toast("Export klaar", name, "info");
    };
    var tenantRows = (tenants || []).map(function (t) { return ({ tenant: t.name, plan: t.plan, status: t.status, users: t.users, venues: t.venues, mrr: t.mrr, billingStatus: t.billingStatus, lifecycle: t.lifecycle, churnRisk: t.churnRisk, accountOwner: t.accountOwner }); });
    var supportRows = (tenants || []).map(function (t) { var s = t.supportAccess || {}; return ({ tenant: t.name, supportEnabled: !!s.enabled, autoRenew: !!s.autoRenew, grantedBy: s.grantedBy || "", grantedAt: s.grantedAt || "", expiresAt: s.expiresAt || "", reason: s.reason || "" }); });
    var platformExports = [
        { title: "Tenants", desc: "Platformmetadata zonder medewerkersdetails.", rows: tenantRows, lawful: "Platformbeheer" },
        { title: "Supporttoegang", desc: "Consentstatus per tenant voor support governance.", rows: supportRows, lawful: "Toestemming / audit" },
    ];
    var tenantExports = [
        { title: "Medewerkers", desc: "Voor HR, payroll en onboarding.", rows: scopeU(allUsers, user).map(function (u) { return ({ name: u.name, email: u.email, role: u.role, dept: u.dept, active: u.active }); }) },
        { title: "Venues", desc: "Locaties en werven.", rows: myV.map(function (v) { return ({ name: v.name, code: v.code, address: v.address, active: v.active }); }) },
        { title: "Klanten", desc: "CRM klantenfiches.", rows: scopeCustomers(customers || [], user).map(function (c) { return ({ name: c.name, contact: c.contact, email: c.email, vat: c.vat, status: c.status, sector: c.sector }); }) },
        { title: "Onkosten", desc: "Finance export.", rows: scopeE(allExp, user, allUsers).map(function (e) { return ({ title: e.title, amount: e.amount, date: e.date, category: e.category, status: e.status }); }) },
        { title: "Werkbonnen", desc: "Operationele output.", rows: scopeW(allWO, user, allUsers).map(function (w) { return ({ title: w.title, client: w.client, date: w.date, status: w.status, billableHours: w.billableHours }); }) },
        { title: "Stock", desc: "Voorraadcontrole.", rows: (allStock || []).filter(function (s) { return myV.some(function (v) { return v.id === s.venueId; }); }).map(function (s) { return ({ name: s.name, sku: s.sku, qty: s.qty, min: s.min, unit: s.unit }); }) },
    ];
    var exports = isPlatformDatahub ? platformExports : tenantExports;
    var blockedExports = ["Medewerkers", "Onkosten", "Werkbonnen", "Klanten"];
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Datahub", sub: isPlatformDatahub ? "Platformexports zonder klant-persoonsdata. Klantdata exporteer je enkel vanuit de tenantcontext." : "Import/export voorbereiding voor onboarding, finance en operations." }),
        isPlatformDatahub && React.createElement(Card, { style: { padding: "16px 18px", marginBottom: 14, background: "#FFF8E8", borderColor: AMB + "55" } },
            React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "flex-start" } },
                React.createElement("div", { style: { width: 32, height: 32, borderRadius: 8, background: AMB + "18", color: AMB, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, flexShrink: 0 } }, "G"),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 900, fontSize: 14, color: TXT, marginBottom: 3 } }, "GDPR guardrail actief"),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, lineHeight: 1.45 } }, "Als SaaS-eigenaar zie je hier alleen tenant- en supportmetadata. Medewerkers, onkosten en werkbonnen blijven binnen de klanttenant. Voor support moet de klant eerst toegang geven en werk je vanuit een supportsessie met auditspoor.")))),
        !isPlatformDatahub && React.createElement(Card, { style: { padding: "20px 22px", marginBottom: 16 } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 14 } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 900, fontSize: 16, color: TXT } }, "Data importeren"),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 3 } }, "Plak CSV-data, controleer de preview en importeer pas daarna.")),
                React.createElement(Chip, { label: importRows.length + " preview rijen", color: importRows.length ? BLU : MUT })),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "220px 1fr", gap: 14 } },
                React.createElement("div", null,
                    React.createElement(Sel, { label: "Importtype", value: importType, onChange: function (e) { setImportType(e.target.value); setImportText(IMPORTS[e.target.value].sample); }, opts: Object.keys(IMPORTS).map(function (k) { return [k, IMPORTS[k].label]; }) }),
                    React.createElement("div", { style: { fontSize: 11, color: SUB, lineHeight: 1.45, marginTop: 8 } },
                        "Kolommen: ",
                        React.createElement("strong", null, IMPORTS[importType].hint)),
                    React.createElement(Btn, { v: "ghost", sm: true, full: true, style: { marginTop: 10 }, onClick: function () { return setImportText(IMPORTS[importType].sample); } }, "Voorbeeld laden")),
                React.createElement("div", null,
                    React.createElement(Inp, { ta: true, rows: 6, value: importText, onChange: function (e) { return setImportText(e.target.value); }, placeholder: IMPORTS[importType].sample }),
                    importPreview.length > 0 ? React.createElement("div", { style: { border: "1px solid ".concat(BOR), borderRadius: 8, overflow: "hidden", marginBottom: 12 } }, importPreview.map(function (row, i) { return React.createElement("div", { key: i, style: { display: "grid", gridTemplateColumns: "32px 1fr", gap: 8, padding: "7px 10px", borderBottom: "1px solid ".concat(BOR), fontSize: 11, alignItems: "center" } },
                        React.createElement("span", { style: { width: 22, height: 22, borderRadius: 8, background: BLUL, color: BLU, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 } }, i + 1),
                        React.createElement("span", { style: { color: SUB, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, Object.keys(row).map(function (k) { return "".concat(k, ": ").concat(row[k]); }).join(" · "))); })) : React.createElement(EmptyState, { compact: true, title: "Nog geen importpreview", body: "Plak CSV met een headerregel of laad een voorbeeld." }),
                    React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
                        React.createElement(Btn, { v: "ghost", onClick: function () { return setImportText(""); } }, "Leegmaken"),
                        React.createElement(Btn, { onClick: runImport, disabled: !importRows.length }, "Importeren"))))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12 } }, exports.map(function (ex) { return React.createElement(Card, { key: ex.title, style: { padding: "18px 20px" } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 10 } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 850, fontSize: 15, color: TXT } }, ex.title),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 3 } }, ex.desc)),
                React.createElement(Chip, { label: ex.rows.length + " rijen", color: ex.rows.length ? BLU : MUT })),
            ex.lawful && React.createElement("div", { style: { fontSize: 11, color: SUB, marginBottom: 10 } }, "Doel: ", ex.lawful),
            React.createElement(Btn, { v: "ghost", full: true, onClick: function () { return downloadCsv("workflowpro-".concat(ex.title.toLowerCase(), ".csv"), ex.rows); }, disabled: !ex.rows.length }, "CSV exporteren")); }),
            isPlatformDatahub && blockedExports.map(function (title) { return React.createElement(Card, { key: title, style: { padding: "18px 20px", background: "#F8FBFF", opacity: .86 } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 10 } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 850, fontSize: 15, color: TXT } }, title),
                        React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 3 } }, "Geblokkeerd op platformniveau wegens persoonsgegevens.")),
                    React.createElement(Chip, { label: "Privacy lock", color: AMB })),
                React.createElement(Btn, { v: "subtle", full: true, disabled: true }, "Alleen via tenant / supportsessie")); })));
}
function ReadinessPage(_a) {
    var tenants = _a.tenants;
    var areas = [
        { title: "Onboarding", score: 45, priority: "P0", owner: "Product", color: BLU, done: ["Checklist per tenant", "Snelle medewerkersimport"], todo: ["wizard bedrijf instellen", "Excel/CSV preview", "eerste planning aanmaken", "integraties koppelen"] },
        { title: "Rollen en rechten", score: 78, priority: "P0", owner: "Product + Security", color: PUR, done: ["Vrije rollen", "modulepermissies", "rechten per actie", "venue scope", "data sensitivity", "rol-preview", "oude/nieuwe waarde audit"], todo: ["server-side afdwingen", "wat-ziet-deze-rol simulatie", "approval policies per module"] },
        { title: "Super admin", score: 55, priority: "P0", owner: "Founder", color: TEAL, done: ["platform beheer", "support login met toestemming", "tenant onboarding overzicht"], todo: ["impersonation reden verplicht", "tenant health score", "account owner", "custom pricing", "integratie statuspagina"] },
        { title: "Billing", score: 30, priority: "P0", owner: "Engineering", color: RED, done: ["pricing configuratie", "Stripe UI demo"], todo: ["echte checkout", "invoices", "failed payment", "seat-based billing", "BTW-validatie", "coupon/discount"] },
        { title: "Integraties", score: 35, priority: "P1", owner: "Engineering", color: AMB, done: ["Robaws demo", "test/sync simulatie"], todo: ["integratiecentrum", "sync logs", "retry", "field mapping", "sandbox per integratie", "tenant API keys"] },
        { title: "Data import/export", score: 40, priority: "P1", owner: "Product", color: BLU, done: ["CSV exports", "snelle medewerker import"], todo: ["stock import", "voertuigen import", "klanten/projecten import", "PDF exports", "GDPR export"] },
        { title: "Rapportage", score: 45, priority: "P1", owner: "Product", color: TEAL, done: ["operationele rapporten"], todo: ["marge/billable", "overuren", "werfproductiviteit", "trends", "management PDF"] },
        { title: "Mobiel", score: 25, priority: "P0", owner: "UX", color: RED, done: ["basis responsive app"], todo: ["mobile-first vandaag flow", "offline werkbonnen", "foto compressie", "handtekening", "PWA", "push"] },
        { title: "Notificaties", score: 35, priority: "P1", owner: "Engineering", color: AMB, done: ["Actiecentrum"], todo: ["workflow engine", "reminders", "approval notifications", "payment failed", "integratie mislukt"] },
        { title: "Security/compliance", score: 25, priority: "P0", owner: "Security", color: RED, done: ["support consent model", "auditlog demo"], todo: ["echte auth/MFA", "server-side tenant isolation", "encrypted credentials", "DPA", "GDPR delete/export", "server-side rechten"] },
        { title: "UX consistentie", score: 55, priority: "P2", owner: "Design", color: PUR, done: ["2026 visual refresh", "cards/tokens"], todo: ["empty states", "loading states", "confirm dialogs", "global search", "help/tooltips"] },
        { title: "Positionering", score: 70, priority: "P1", owner: "Founder", color: GRN, done: ["kernpijlers benoemd"], todo: ["website copy", "ICP aanscherpen", "demo script", "pricing packaging"] },
    ];
    var avg = Math.round(areas.reduce(function (a, x) { return a + x.score; }, 0) / areas.length);
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Go-live readiness", sub: "Product owner cockpit voor wat nog mist richting verkoopbare SaaS.", action: React.createElement(Chip, { label: avg + "% volwassen", color: avg > 70 ? GRN : avg > 45 ? AMB : RED }) }),
        React.createElement(Card, { style: { padding: "20px 22px", marginBottom: 14, background: NAV_BG, color: "#fff" } },
            React.createElement("div", { style: { fontSize: 11, fontWeight: 800, color: "#93C5FD", textTransform: "uppercase", marginBottom: 5 } }, "Productpositionering"),
            React.createElement("div", { style: { fontWeight: 900, fontSize: 22, lineHeight: 1.25 } }, "WorkFlow Pro: personeelsplanning, werkbonnen en kostencontrole voor Belgische KMO's met mensen op de baan."),
            React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 } }, ["Planning", "Tijdregistratie", "Werkbonnen", "Onkosten", "Rollen/rechten", "Integraties", "Billing"].map(function (x) { return React.createElement("span", { key: x, style: { background: "rgba(255,255,255,.09)", border: "1px solid rgba(255,255,255,.14)", color: "#E5E7EB", borderRadius: 20, padding: "4px 10px", fontSize: 12, fontWeight: 700 } }, x); }))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 } }, areas.map(function (a) { return React.createElement(Card, { key: a.title, style: { padding: "17px 18px", borderTop: "3px solid ".concat(a.color) } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 850, fontSize: 15, color: TXT } }, a.title),
                    React.createElement("div", { style: { fontSize: 11, color: SUB, marginTop: 2 } }, a.owner)),
                React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "flex-start" } },
                    React.createElement(Chip, { label: a.priority, color: a.priority === "P0" ? RED : a.priority === "P1" ? AMB : MUT }),
                    React.createElement(Chip, { label: a.score + "%", color: a.color }))),
            React.createElement("div", { style: { height: 7, background: BOR, borderRadius: 99, overflow: "hidden", marginBottom: 12 } },
                React.createElement("div", { style: { width: a.score + "%", height: "100%", background: a.color } })),
            React.createElement("div", { style: { fontSize: 11, fontWeight: 800, color: GRN, marginBottom: 5 } }, "Al aanwezig"),
            React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 } }, a.done.map(function (x) { return React.createElement("span", { key: x, style: { fontSize: 10, color: GRN, background: GRNL, border: "1px solid ".concat(GRN, "33"), borderRadius: 20, padding: "2px 7px" } }, x); })),
            React.createElement("div", { style: { fontSize: 11, fontWeight: 800, color: SUB, marginBottom: 5 } }, "Nog nodig"),
            React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap" } }, a.todo.map(function (x) { return React.createElement("span", { key: x, style: { fontSize: 10, color: SUB, background: BG, border: "1px solid ".concat(BOR), borderRadius: 20, padding: "2px 7px" } }, x); }))); })));
}
function LifecyclePage(_a) {
    var tenants = _a.tenants, go = _a.go;
    var health = function (t) {
        var score = 100;
        if (t.status === "trial")
            score -= 15;
        if (t.status === "suspended")
            score -= 35;
        if (t.billingStatus === "payment_failed")
            score -= 35;
        if (t.churnRisk === "medium")
            score -= 15;
        if (t.churnRisk === "high")
            score -= 30;
        if (t.lastActiveAt && t.lastActiveAt < gd(-14))
            score -= 20;
        if (t.trialEndsAt && t.status === "trial" && t.trialEndsAt <= gd(5))
            score -= 15;
        return Math.max(0, Math.min(100, score));
    };
    var colorFor = function (score) { return score >= 75 ? GRN : score >= 50 ? AMB : RED; };
    var rows = tenants.map(function (t) { return __assign(__assign({}, t), { health: health(t) }); }).sort(function (a, b) { return a.health - b.health; });
    var atRisk = rows.filter(function (t) { return t.health < 55; });
    var paymentFailed = rows.filter(function (t) { return t.billingStatus === "payment_failed"; });
    var trialEnding = rows.filter(function (t) { return t.status === "trial" && t.trialEndsAt <= gd(7); });
    var openTickets = rows.reduce(function (a, t) { return a + (t.supportTickets || 0); }, 0);
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "SaaS lifecycle", sub: "Van trial naar actieve klant, renewal en expansion. Dit is de dagelijkse customer-success cockpit." }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 18 } },
            React.createElement(KPI, { icon: "H", label: "Gem. health", value: Math.round(rows.reduce(function (a, t) { return a + t.health; }, 0) / Math.max(rows.length, 1)) + "%", color: TEAL }),
            React.createElement(KPI, { icon: "!", label: "At risk", value: atRisk.length, color: atRisk.length ? RED : GRN }),
            React.createElement(KPI, { icon: "P", label: "Payment failed", value: paymentFailed.length, color: paymentFailed.length ? RED : GRN }),
            React.createElement(KPI, { icon: "T", label: "Trial eindigt", value: trialEnding.length, color: trialEnding.length ? AMB : GRN }),
            React.createElement(KPI, { icon: "S", label: "Support tickets", value: openTickets, color: openTickets ? BLU : MUT })),
        React.createElement(Card, { style: { padding: 0, overflow: "hidden", marginBottom: 14 } },
            React.createElement("div", { style: { padding: "14px 18px", borderBottom: "1px solid ".concat(BOR), display: "flex", justifyContent: "space-between", alignItems: "center" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15 } }, "Tenant health"),
                React.createElement(Btn, { sm: true, v: "ghost", onClick: function () { return go("tenants"); } }, "Tenantbeheer")),
            rows.map(function (t) { var c = colorFor(t.health); return React.createElement("div", { key: t.id, style: { display: "grid", gridTemplateColumns: "1.2fr 90px 90px 100px 100px 1fr", gap: 12, alignItems: "center", padding: "13px 18px", borderBottom: "1px solid ".concat(BOR) } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 13, color: TXT } }, t.name),
                    React.createElement("div", { style: { fontSize: 11, color: SUB, marginTop: 2 } }, "Owner ", t.accountOwner || "-", " · ", t.successNote || "Geen notitie")),
                React.createElement("div", null,
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7 } },
                        React.createElement("div", { style: { width: 42, height: 7, borderRadius: 99, background: BOR, overflow: "hidden" } },
                            React.createElement("div", { style: { width: t.health + "%", height: "100%", background: c } })),
                        React.createElement("span", { style: { fontWeight: 850, fontSize: 12, color: c } }, t.health, "%"))),
                React.createElement(Chip, { label: t.lifecycle || t.status, color: t.lifecycle === "at_risk" ? RED : t.lifecycle === "trial" ? AMB : t.lifecycle === "renewal" ? PUR : BLU }),
                React.createElement(Chip, { label: t.billingStatus || "unknown", color: t.billingStatus === "payment_failed" ? RED : t.billingStatus === "paid" ? GRN : AMB }),
                React.createElement("div", { style: { fontSize: 11, color: SUB } },
                    "Actief: ",
                    t.lastActiveAt ? fD(t.lastActiveAt) : "-",
                    React.createElement("br", null),
                    "Renewal: ",
                    t.renewalAt ? fD(t.renewalAt) : "-"),
                React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
                    t.supportTickets > 0 && React.createElement(Chip, { label: t.supportTickets + " tickets", color: BLU }),
                    t.churnRisk === "high" && React.createElement(Chip, { label: "Churn risk", color: RED }),
                    t.status === "trial" && React.createElement(Chip, { label: "Trial tot " + fD(t.trialEndsAt), color: AMB }))); })),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 } },
            React.createElement(Card, { style: { padding: "18px 20px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 8 } }, "Customer success playbooks"),
                [["Trial eindigt binnen 7 dagen", "Plan demo-call + betaalmethode checken."], ["Payment failed", "Stuur betaalmail, bel account owner, zet grace period."], ["Inactief 14 dagen", "Succesmail + guided onboarding voorstellen."], ["Renewal binnen 45 dagen", "Waarde bewijzen met usage en ROI."]].map(function (x) { return React.createElement("div", { key: x[0], style: { padding: "9px 0", borderBottom: "1px solid ".concat(BOR) } },
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 13, color: TXT } }, x[0]),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } }, x[1])); })),
            React.createElement(Card, { style: { padding: "18px 20px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 8 } }, "Sales/demo mode checklist"),
                ["Reset demo-data", "Demo script: planning naar werkbon naar onkost", "ROI calculator voor zaakvoerder", "Sample scenario per sector", "Mobiele field-flow tonen in 5 minuten"].map(function (x) { return React.createElement("div", { key: x, style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid ".concat(BOR), fontSize: 12, color: SUB } },
                    React.createElement("span", { style: { width: 18, height: 18, borderRadius: "50%", background: BG, border: "1px solid ".concat(BOR), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: MUT } }, "□"),
                    x); }))));
}
function SettingsPage(_a) {
    var user = _a.user, expLimits = _a.expLimits, setExpLimits = _a.setExpLimits, toast = _a.toast, tenant = _a.tenant, setTenants = _a.setTenants, platformConfig = _a.platformConfig;
    var _b = useState(__assign({}, expLimits)), form = _b[0], setForm = _b[1];
    var support = (tenant === null || tenant === void 0 ? void 0 : tenant.supportAccess) || { enabled: false };
    var supportDays = Number(((platformConfig === null || platformConfig === void 0 ? void 0 : platformConfig.support) || {}).defaultConsentDays || 7);
    var toggleSupport = function (enabled) {
        if (!tenant || !setTenants)
            return;
        var nextSupport = enabled ? { enabled: true, autoRenew: !!support.autoRenew, grantedBy: user.name, grantedAt: TODAY, expiresAt: support.autoRenew ? null : gd(supportDays), reason: support.autoRenew ? "Klant gaf doorlopende supporttoegang vrij" : "Klant gaf supporttoegang vrij" } : { enabled: false, autoRenew: false, revokedBy: user.name, revokedAt: TODAY };
        setTenants(function (prev) { return prev.map(function (t) { return t.id === tenant.id ? __assign(__assign({}, t), { supportAccess: nextSupport }) : t; }); });
        toast(enabled ? "Supporttoegang ingeschakeld" : "Supporttoegang ingetrokken", enabled ? "WorkFlow Pro support kan tijdelijk meekijken." : "Support kan niet meer inloggen op uw tenant.", "info");
    };
    var toggleSupportAutoRenew = function (autoRenew) {
        if (!tenant || !setTenants)
            return;
        var nextSupport = autoRenew ? { enabled: true, autoRenew: true, grantedBy: user.name, grantedAt: TODAY, expiresAt: null, reason: "Klant gaf doorlopende supporttoegang vrij" } : __assign(__assign({}, support), { autoRenew: false, expiresAt: support.enabled ? gd(supportDays) : support.expiresAt, reason: "Doorlopende supporttoegang uitgeschakeld" });
        setTenants(function (prev) { return prev.map(function (t) { return t.id === tenant.id ? __assign(__assign({}, t), { supportAccess: nextSupport }) : t; }); });
        toast(autoRenew ? "Doorlopende supporttoegang actief" : "Doorlopende supporttoegang uit", autoRenew ? "Support blijft toegestaan tot u dit weer uitzet." : "Support valt terug op tijdelijke toestemming.", "info");
    };
    var LIMIT_CATS = ["maaltijden", "hotel", "representatie", "brandstof", "kantoormateriaal"];
    var GO_LIVE = [
        ["Rollen & rechten", "Maak minimaal 2 vrije rollen aan voor kantoor en veld."],
        ["Billing", "Kies plan, trialstatus en betaalmethode in testmode."],
        ["Data import", "Importeer medewerkers, venues, klanten/projecten en voertuigen."],
        ["Integraties", "Koppel sociaal secretariaat, boekhouding of ERP in staging."],
        ["Audit & compliance", "Controleer auditlog, DPA en exportbeleid."]
    ];
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Instellingen", sub: "Configureer uw WorkFlow Pro omgeving" }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } },
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 4 } }, "\uD83D\uDCB8 Onkostlimieten per categorie"),
                React.createElement("div", { style: { fontSize: 12, color: SUB, marginBottom: 16 } }, "Onkosten boven dit bedrag worden automatisch gemarkeerd. Laat leeg voor geen limiet."),
                LIMIT_CATS.map(function (cat) { return React.createElement("div", { key: cat, style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 } },
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: TXT } },
                            CAT_IC[cat],
                            " ",
                            cat.charAt(0).toUpperCase() + cat.slice(1)),
                        React.createElement("div", { style: { fontSize: 11, color: MUT } }, "Max bedrag per claim")),
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5 } },
                        React.createElement("span", { style: { fontSize: 13, color: SUB } }, "\u20AC"),
                        React.createElement("input", { type: "number", value: form[cat] || "", onChange: function (e) { return setForm(function (f) {
                                var _a;
                                return (__assign(__assign({}, f), (_a = {}, _a[cat] = e.target.value ? +e.target.value : undefined, _a)));
                            }); }, placeholder: "geen", style: { width: 80, border: "1.5px solid ".concat(BOR), borderRadius: 8, padding: "6px 9px", fontSize: 13, fontFamily: "inherit", outline: "none", textAlign: "right" } }))); }),
                React.createElement(Btn, { sm: true, onClick: function () { setExpLimits(form); toast("Limieten opgeslagen!", "", "info"); } }, "Opslaan")),
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 4 } }, "\uD83D\uDE97 Kilometervergoeding"),
                React.createElement("div", { style: { fontSize: 12, color: SUB, marginBottom: 16 } }, "Het Belgisch fiscaal tarief wordt automatisch toegepast bij kilometeronkosten."),
                React.createElement("div", { style: { background: BLUL, borderRadius: 10, padding: "14px 16px", border: "1px solid ".concat(BLUB) } },
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 24, color: BLU, letterSpacing: -.5 } },
                        "\u20AC",
                        KM_RATE),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 3 } }, "per kilometer \u00B7 Belgisch fiscaal tarief 2026"),
                    React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 8 } }, "Dit tarief wordt jaarlijks aangepast door de FOD Financi\u00EBn. In productie kan dit worden geconfigureerd via de instellingen."))),
            tenant && React.createElement(Card, { style: { padding: "20px 22px", gridColumn: "1 / -1" } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center" } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 800, fontSize: 15, marginBottom: 4 } }, "Supporttoegang"),
                        React.createElement("div", { style: { fontSize: 12, color: SUB, lineHeight: 1.45 } }, support.enabled ? support.autoRenew ? "WorkFlow Pro support heeft doorlopend toegang tot u dit weer uitzet. Elke sessie hoort in productie gelogd te worden." : "WorkFlow Pro support mag tijdelijk meekijken tot ".concat(fD(support.expiresAt), ". Elke sessie hoort in productie gelogd te worden.") : "Zet dit alleen aan wanneer u support vraagt. Zonder toestemming kan de SaaS eigenaar niet inloggen op uw tenant.")),
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } },
                        support.enabled && React.createElement(Chip, { label: support.autoRenew ? "Altijd actief" : "Actief", color: GRN }),
                        React.createElement(Btn, { v: support.enabled ? "danger" : "accent", onClick: function () { return toggleSupport(!support.enabled); } }, support.enabled ? "Toegang intrekken" : "Support toestaan")))),
            tenant && React.createElement(Card, { style: { padding: "18px 22px", gridColumn: "1 / -1", background: support.autoRenew ? GRNL : SUR, borderColor: support.autoRenew ? GRN + "55" : BOR } },
                React.createElement("label", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, cursor: "pointer" } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 800, fontSize: 14, color: TXT, marginBottom: 3 } }, "Altijd supporttoegang toestaan"),
                        React.createElement("div", { style: { fontSize: 12, color: SUB, lineHeight: 1.45 } }, "Auto-renew houdt supporttoegang actief zonder vervaldatum. U kan dit op elk moment zelf weer uitschakelen.")),
                    React.createElement("input", { type: "checkbox", checked: !!support.autoRenew, onChange: function (e) { return toggleSupportAutoRenew(e.target.checked); }, style: { width: 20, height: 20, accentColor: GRN, flexShrink: 0 } }))),
            React.createElement(Card, { style: { padding: "20px 22px", gridColumn: "1 / -1" } },
                React.createElement("div", { style: { fontWeight: 800, fontSize: 15, marginBottom: 4 } }, "Go-live checklist"),
                React.createElement("div", { style: { fontSize: 12, color: SUB, marginBottom: 14 } }, "De minimale stappen om van demo naar verkoopbare tenant te gaan."),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 } }, GO_LIVE.map(function (it, i) { return React.createElement("div", { key: it[0], style: { border: "1px solid ".concat(BOR), borderRadius: 8, padding: 12, background: i < 2 ? GRNL : SUR } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 5 } },
                        React.createElement("span", { style: { width: 20, height: 20, borderRadius: "50%", background: i < 2 ? GRN : BG, color: i < 2 ? "#fff" : SUB, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 } }, i < 2 ? "\u2713" : i + 1),
                        React.createElement("strong", { style: { fontSize: 13, color: TXT } }, it[0])),
                    React.createElement("div", { style: { fontSize: 11, color: SUB, lineHeight: 1.45 } }, it[1])); })))));
}
function SecurityPage(_a) {
    var policy = _a.policy, setPolicy = _a.setPolicy, events = _a.events, tenants = _a.tenants, users = _a.users, auditLogs = _a.auditLogs;
    var cfg = policy || SECURITY_POLICY_INIT;
    var patch = function (section, key, value) { return setPolicy(function (p) {
        var _a, _b;
        var base = p || SECURITY_POLICY_INIT;
        return __assign(__assign({}, base), (_a = {}, _a[section] = __assign(__assign({}, (base[section] || {})), (_b = {}, _b[key] = value, _b)), _a));
    }); };
    var tenantName = function (id) { var _a; return ((_a = tenants.find(function (t) { return t.id === id; })) === null || _a === void 0 ? void 0 : _a.name) || "Platform"; };
    var critical = [
        { label: "MFA verplicht", ok: !!cfg.auth.mfaRequired, area: "Auth" },
        { label: "Server-side tenant isolation", ok: cfg.data.tenantIsolation === "server-side" || cfg.data.tenantIsolation === "rls", area: "Data" },
        { label: "Encrypted credential vault", ok: !!cfg.credentials.encryptedVault, area: "Secrets" },
        { label: "Stripe secrets server-side", ok: !!cfg.credentials.stripeSecretsServerSide, area: "Secrets" },
        { label: "Support reden verplicht", ok: !!cfg.support.reasonRequired, area: "Support" },
        { label: "GDPR delete flow", ok: !!cfg.data.gdprDeleteEnabled, area: "GDPR" },
    ];
    var score = Math.round((critical.filter(function (x) { return x.ok; }).length / critical.length) * 100);
    var highEvents = (events || []).filter(function (e) { return e.severity === "high"; }).length;
    var activeSupport = tenants.filter(function (t) { var s = t.supportAccess || {}; return s.enabled && (s.autoRenew || !s.expiresAt || s.expiresAt >= TODAY); }).length;
    var ToggleLine = function (_a) {
        var label = _a.label, checked = _a.checked, onChange = _a.onChange, sub = _a.sub;
        return React.createElement("label", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid ".concat(BOR), cursor: "pointer" } },
            React.createElement("span", null,
                React.createElement("span", { style: { display: "block", fontWeight: 800, fontSize: 13, color: TXT } }, label),
                sub && React.createElement("span", { style: { display: "block", fontSize: 11, color: SUB, marginTop: 2, lineHeight: 1.4 } }, sub)),
            React.createElement("input", { type: "checkbox", checked: !!checked, onChange: function (e) { return onChange(e.target.checked); }, style: { width: 18, height: 18, accentColor: BLU } }));
    };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Security Center", sub: "Auth, tenant isolation, secrets, support access en compliance voordat je enterprise verkoopt.", action: React.createElement(Chip, { label: score + "% security-ready", color: score >= 80 ? GRN : score >= 50 ? AMB : RED }) }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 18 } },
            React.createElement(KPI, { icon: "S", label: "Security score", value: score + "%", color: score >= 80 ? GRN : score >= 50 ? AMB : RED }),
            React.createElement(KPI, { icon: "!", label: "P0 gaps", value: critical.filter(function (x) { return !x.ok; }).length, color: RED }),
            React.createElement(KPI, { icon: "E", label: "High events", value: highEvents, color: highEvents ? RED : GRN }),
            React.createElement(KPI, { icon: "A", label: "Actieve support", value: activeSupport, color: activeSupport ? AMB : GRN }),
            React.createElement(KPI, { icon: "U", label: "Gebruikers", value: users.length, color: BLU })),
        React.createElement(Card, { style: { padding: "18px 20px", marginBottom: 14, borderLeft: "4px solid ".concat(score >= 80 ? GRN : RED) } },
            React.createElement("div", { style: { fontWeight: 900, fontSize: 16, color: TXT, marginBottom: 4 } }, "Go-live security gates"),
            React.createElement("div", { style: { fontSize: 12, color: SUB, marginBottom: 12 } }, "Deze punten moeten groen zijn voordat je grotere B2B-klanten of enterprise deals sluit."),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 8 } }, critical.map(function (x) { return React.createElement("div", { key: x.label, style: { border: "1px solid ".concat(x.ok ? GRN + "44" : RED + "33"), background: x.ok ? GRNL : REDL, borderRadius: 8, padding: "10px 12px" } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 800, fontSize: 13, color: TXT } }, x.label),
                        React.createElement("div", { style: { fontSize: 11, color: SUB, marginTop: 2 } }, x.area)),
                    React.createElement(Chip, { label: x.ok ? "OK" : "Gap", color: x.ok ? GRN : RED }))); }))),
        React.createElement(Card, { style: { padding: "18px 20px", marginBottom: 14 } },
            React.createElement("div", { style: { fontWeight: 900, fontSize: 16, color: TXT, marginBottom: 4 } }, "Production security implementation"),
            React.createElement("div", { style: { fontSize: 12, color: SUB, marginBottom: 12 } }, "Deze zes onderdelen zijn geen UI-toggles maar backend/verificatie werk. Tot ze live zijn blijft dit een demo-security model."),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 10 } }, [
                ["Echte auth/MFA", "Supabase Auth/Auth0/Clerk met MFA voor admins, wachtwoordreset en sessieclaims.", "P0", cfg.auth.mfaRequired],
                ["Server-side tenant isolation", "Alle API's filteren op tenant_id; productievoorkeur: PostgreSQL RLS.", "P0", cfg.data.tenantIsolation === "server-side" || cfg.data.tenantIsolation === "rls"],
                ["Encrypted credentials", "Stripe/Robaws/API keys naar server-side vault met rotatie en audit.", "P0", cfg.credentials.encryptedVault],
                ["DPA", "DPA-status per tenant, verplichte acceptatie en documentversie bewaren.", "P1", cfg.data.dpaRequired],
                ["GDPR delete/export", "Data subject export/delete workflow met goedkeuring, audit en retentiechecks.", "P1", cfg.data.gdprExportEnabled && cfg.data.gdprDeleteEnabled],
                ["Server-side rechten", "Permissions in JWT/server middleware afdwingen; frontend is alleen presentatie.", "P0", false],
            ].map(function (item) { return React.createElement("div", { key: item[0], style: { border: "1px solid ".concat(item[3] ? GRN + "44" : RED + "33"), background: item[3] ? GRNL : SUR, borderRadius: 8, padding: "12px 13px" } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", marginBottom: 6 } },
                    React.createElement("div", { style: { fontWeight: 850, fontSize: 13, color: TXT } }, item[0]),
                    React.createElement(Chip, { label: item[2], color: item[2] === "P0" ? RED : AMB })),
                React.createElement("div", { style: { fontSize: 11, color: SUB, lineHeight: 1.45, marginBottom: 8 } }, item[1]),
                React.createElement(Chip, { label: item[3] ? "Voorbereid" : "Nog te bouwen", color: item[3] ? GRN : RED })); }))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 } },
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 8 } }, "Auth & sessies"),
                React.createElement(ToggleLine, { label: "MFA verplicht", checked: cfg.auth.mfaRequired, onChange: function (v) { return patch("auth", "mfaRequired", v); }, sub: "Voor admins en super admins verplicht maken." }),
                React.createElement(ToggleLine, { label: "Wachtwoordreset actief", checked: cfg.auth.passwordResetEnabled, onChange: function (v) { return patch("auth", "passwordResetEnabled", v); } }),
                React.createElement(ToggleLine, { label: "IP logging", checked: cfg.sessions.ipLogging, onChange: function (v) { return patch("sessions", "ipLogging", v); } }),
                React.createElement(ToggleLine, { label: "Device logging", checked: cfg.sessions.deviceLogging, onChange: function (v) { return patch("sessions", "deviceLogging", v); } }),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 } },
                    React.createElement(Inp, { label: "Sessie minuten", type: "number", value: cfg.auth.sessionMinutes, onChange: function (e) { return patch("auth", "sessionMinutes", Number(e.target.value || 0)); } }),
                    React.createElement(Inp, { label: "Idle timeout", type: "number", value: cfg.auth.idleTimeoutMinutes, onChange: function (e) { return patch("auth", "idleTimeoutMinutes", Number(e.target.value || 0)); } }))),
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 8 } }, "Data, GDPR & DPA"),
                React.createElement(Sel, { label: "Tenant isolation", opts: [["demo-client-side", "Demo client-side"], ["server-side", "Server-side enforced"], ["rls", "PostgreSQL RLS"]], value: cfg.data.tenantIsolation, onChange: function (e) { return patch("data", "tenantIsolation", e.target.value); } }),
                React.createElement(ToggleLine, { label: "DPA verplicht", checked: cfg.data.dpaRequired, onChange: function (v) { return patch("data", "dpaRequired", v); } }),
                React.createElement(ToggleLine, { label: "GDPR export actief", checked: cfg.data.gdprExportEnabled, onChange: function (v) { return patch("data", "gdprExportEnabled", v); } }),
                React.createElement(ToggleLine, { label: "GDPR delete flow actief", checked: cfg.data.gdprDeleteEnabled, onChange: function (v) { return patch("data", "gdprDeleteEnabled", v); } }),
                React.createElement(Inp, { label: "Retentie dagen", type: "number", value: cfg.data.retentionDays, onChange: function (e) { return patch("data", "retentionDays", Number(e.target.value || 0)); } }))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 } },
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 8 } }, "Credential vault"),
                React.createElement(ToggleLine, { label: "Encrypted vault actief", checked: cfg.credentials.encryptedVault, onChange: function (v) { return patch("credentials", "encryptedVault", v); }, sub: "Secrets horen niet in frontend-state." }),
                React.createElement(ToggleLine, { label: "Stripe secrets server-side", checked: cfg.credentials.stripeSecretsServerSide, onChange: function (v) { return patch("credentials", "stripeSecretsServerSide", v); } }),
                React.createElement(ToggleLine, { label: "Integratie keys server-side", checked: cfg.credentials.integrationKeysServerSide, onChange: function (v) { return patch("credentials", "integrationKeysServerSide", v); } }),
                React.createElement(Inp, { label: "Rotatie dagen", type: "number", value: cfg.credentials.rotationDays, onChange: function (e) { return patch("credentials", "rotationDays", Number(e.target.value || 0)); } })),
            React.createElement(Card, { style: { padding: "20px 22px" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15, marginBottom: 8 } }, "Support access governance"),
                React.createElement(ToggleLine, { label: "Reden verplicht bij impersonation", checked: cfg.support.reasonRequired, onChange: function (v) { return patch("support", "reasonRequired", v); } }),
                React.createElement(ToggleLine, { label: "Approval trail verplicht", checked: cfg.support.approvalTrailRequired, onChange: function (v) { return patch("support", "approvalTrailRequired", v); } }),
                React.createElement(ToggleLine, { label: "Read-only support waar mogelijk", checked: cfg.support.readOnlyModePreferred, onChange: function (v) { return patch("support", "readOnlyModePreferred", v); } }),
                React.createElement(ToggleLine, { label: "Sessie recording vereist", checked: cfg.support.sessionRecording, onChange: function (v) { return patch("support", "sessionRecording", v); } }))),
        React.createElement(Card, { style: { padding: 0, overflow: "hidden" } },
            React.createElement("div", { style: { padding: "14px 18px", borderBottom: "1px solid ".concat(BOR), display: "flex", justifyContent: "space-between", alignItems: "center" } },
                React.createElement("div", { style: { fontWeight: 850, fontSize: 15 } }, "Security events"),
                React.createElement(Chip, { label: (auditLogs || []).length + " audit logs", color: BLU })),
            (events || []).slice().reverse().map(function (e) { return React.createElement("div", { key: e.id, style: { display: "grid", gridTemplateColumns: "120px 130px 1fr 110px", gap: 12, alignItems: "center", padding: "13px 18px", borderBottom: "1px solid ".concat(BOR) } },
                React.createElement("div", { style: { fontSize: 11, color: SUB } }, fD(e.at), React.createElement("br", null), e.time),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 12, color: TXT } }, tenantName(e.tenantId)),
                    React.createElement("div", { style: { fontSize: 10, color: MUT } }, e.actor)),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 750, fontSize: 12, color: TXT } }, e.detail),
                    React.createElement("div", { style: { fontSize: 10, color: MUT, marginTop: 2 } }, e.type, " · ", e.ip, " · ", e.device)),
                React.createElement(Chip, { label: e.severity, color: e.severity === "high" ? RED : e.severity === "medium" ? AMB : BLU })); })));
}
function AuditPage(_a) {
    var logs = _a.logs, user = _a.user;
    var _b = useState("all"), filter = _b[0], setFilter = _b[1];
    var shown = (logs || []).filter(function (l) { return filter === "all" ? true : l.area === filter; }).slice().reverse();
    var areas = __spreadArray(["all"], Array.from(new Set((logs || []).map(function (l) { return l.area; }))), true);
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Auditlog", sub: "Controleer rechten, billing, integraties en kritieke wijzigingen" }),
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" } }, areas.map(function (a) { return React.createElement("button", { key: a, onClick: function () { return setFilter(a); }, style: { border: "1px solid ".concat(filter === a ? BLU : BOR), background: filter === a ? BLUL : SUR, color: filter === a ? BLU : SUB, borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" } }, a === "all" ? "Alles" : a); })),
        React.createElement(Card, { style: { overflow: "hidden" } },
            shown.map(function (l) { return React.createElement("div", { key: l.id, style: { display: "grid", gridTemplateColumns: "120px 130px 1fr 120px", gap: 12, padding: "13px 16px", borderBottom: "1px solid ".concat(BOR), alignItems: "center" } },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 12, color: TXT } }, fD(l.at)),
                    React.createElement("div", { style: { fontSize: 11, color: MUT } }, l.time)),
                React.createElement(Chip, { label: l.area, color: l.severity === "ok" ? GRN : l.severity === "warn" ? AMB : BLU }),
                React.createElement("div", null,
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: TXT } }, l.action),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } }, l.detail)),
                React.createElement("div", { style: { fontSize: 12, color: SUB, textAlign: "right" } }, l.actor)); }),
            shown.length === 0 && React.createElement("div", { style: { padding: 24, textAlign: "center", color: MUT, fontSize: 13 } }, "Geen auditregels gevonden.")),
        React.createElement("div", { style: { marginTop: 12, fontSize: 11, color: MUT } },
            "Productienoot: deze demo toont auditregels in lokale state. In productie hoort dit append-only en server-side afgedwongen te worden. Ingelogd als ",
            user.name,
            "."));
}
// ─── INTEGRATIES ──────────────────────────────────────────────────────────────
var SECRETARIATEN = [
    { id: "acerta", group: "Sociaal secretariaat", name: "Acerta", logo: "🔵", color: "#0070CC", auth: "OAuth 2.0 + API Key", fields: ["Planning", "Tijdregistraties", "Verlof", "Dimona"], status: "connected", lastSync: gd(-1), note: "Automatische Dimona-aangifte actief" },
    { id: "liantis", group: "Sociaal secretariaat", name: "Liantis", logo: "🟢", color: "#00A651", auth: "OAuth 2.0", fields: ["Planning", "Tijdregistraties", "Verlof", "Loongegevens"], status: "available", lastSync: null, note: "" },
    { id: "sdworx", group: "Sociaal secretariaat", name: "SD Worx", logo: "🔴", color: "#E4003A", auth: "OAuth 2.0 + mTLS", fields: ["Planning", "Tijdregistraties", "Verlof", "Loongegevens", "PG"], status: "available", lastSync: null, note: "" },
    { id: "securex", group: "Sociaal secretariaat", name: "Securex", logo: "🟠", color: "#F47920", auth: "API Key + HMAC", fields: ["Planning", "Tijdregistraties", "Verlof"], status: "available", lastSync: null, note: "" },
    { id: "partena", group: "Sociaal secretariaat", name: "Partena Professional", logo: "🟣", color: "#7B2D8B", auth: "OAuth 2.0", fields: ["Planning", "Tijdregistraties", "Verlof", "Dimona"], status: "available", lastSync: null, note: "" },
    { id: "robaws", group: "ERP & projectadministratie", name: "Robaws", logo: "R", color: "#111827", auth: "API Key + Bedrijfsaccount", fields: ["Klanten", "Projecten", "Werkbonnen", "Materialen", "Uren", "Facturatie"], status: "available", lastSync: null, note: "Werkbonnen, uren en materialen klaar voor Robaws export" },
];
function IntegrationsPage(_a) {
    var user = _a.user, toast = _a.toast;
    var _b = useState(SECRETARIATEN.map(function (s) { return (__assign({}, s)); })), conns = _b[0], setConns = _b[1];
    var _c = useState(null), sel = _c[0], setSel = _c[1];
    var _d = useState(1), step = _d[0], setStep = _d[1];
    var _e = useState(""), apiKey = _e[0], setApiKey = _e[1];
    var _f = useState(""), accountId = _f[0], setAccountId = _f[1];
    var isAdmin = isAdminRole(user.role);
    var connect = function (id) { setConns(function (p) { return p.map(function (s) { return s.id === id ? __assign(__assign({}, s), { status: "connected", lastSync: TODAY, accountId: accountId || undefined }) : s; }); }); toast("Verbonden!", id === "robaws" ? "Robaws koppeling geactiveerd." : "Integratie succesvol geactiveerd."); setSel(null); setStep(1); setApiKey(""); setAccountId(""); };
    var disconnect = function (id) { setConns(function (p) { return p.map(function (s) { return s.id === id ? __assign(__assign({}, s), { status: "available", lastSync: null }) : s; }); }); toast("Ontkoppeld", "", "warn"); };
    var sync = function (id) {
        if (id === "robaws" && window.location.protocol !== "file:") {
            fetch("/api/integrations/robaws/sync", { method: "POST" }).catch(function () { });
        }
        setConns(function (p) { return p.map(function (s) { return s.id === id ? __assign(__assign({}, s), { lastSync: TODAY }) : s; }); });
        toast("Synchronisatie gestart", id === "robaws" ? "Werkbonnen, uren en materialen worden naar Robaws klaargezet." : "Data wordt verstuurd...", "info");
    };
    var testConnection = function () {
        if (sel && sel.id === "robaws" && window.location.protocol !== "file:") {
            fetch("/api/integrations/robaws/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: apiKey, accountId: accountId }) }).catch(function () { });
        }
        setStep(4);
    };
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Integraties", sub: "Koppel WorkFlow Pro aan sociale secretariaten, ERP en projectadministratie" }),
        React.createElement("div", { style: { background: BLUL, border: "1px solid ".concat(BLUB), borderRadius: 12, padding: "13px 16px", marginBottom: 22, display: "flex", gap: 10, alignItems: "flex-start" } },
            React.createElement("span", { style: { fontSize: 20 } }, "\uD83D\uDD12"),
            React.createElement("div", null,
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: BLU } }, "GDPR & Dataveiligheid"),
                React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 2 } },
                    "WorkFlow Pro treedt op als ",
                    React.createElement("strong", null, "Verwerker (Art. 28 GDPR)"),
                    ". Uw bedrijf blijft de Controller. Een DPA wordt automatisch ondertekend bij activatie. Alle communicatie via TLS 1.3 \u00B7 EU-hosting (Frankfurt)."))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 } }, conns.map(function (s) { return React.createElement(Card, { key: s.id, style: { padding: "20px 22px", borderTop: "3px solid ".concat(s.color) } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
                    React.createElement("div", { style: { width: 44, height: 44, borderRadius: 12, background: s.color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 } }, s.logo),
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 800, fontSize: 15, color: TXT } }, s.name),
                        React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 1 } }, s.auth),
                        React.createElement("div", { style: { fontSize: 10, color: s.color, marginTop: 3, fontWeight: 700, textTransform: "uppercase", letterSpacing: .4 } }, s.group || "Integratie"))),
                React.createElement(Chip, { label: s.status === "connected" ? "✓ Verbonden" : "Beschikbaar", color: s.status === "connected" ? GRN : MUT })),
            React.createElement("div", { style: { marginBottom: 12 } },
                React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: SUB, marginBottom: 5, textTransform: "uppercase", letterSpacing: .5 } }, "Datavelden"),
                React.createElement("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" } }, s.fields.map(function (f) { return React.createElement("span", { key: f, style: { fontSize: 10, padding: "2px 8px", borderRadius: 20, background: BG, border: "1px solid ".concat(BOR), color: SUB, fontWeight: 500 } }, f); }))),
            s.status === "connected" && s.lastSync && React.createElement("div", { style: { fontSize: 11, color: MUT, marginBottom: 10 } },
                "\uD83D\uDD04 Laatste sync: ",
                s.lastSync === TODAY ? "Vandaag" : fD(s.lastSync),
                s.note && React.createElement("div", { style: { color: GRN, marginTop: 2 } },
                    "\u2713 ",
                    s.note)),
            isAdmin && React.createElement("div", { style: { display: "flex", gap: 7 } }, s.status === "connected" ? React.createElement(React.Fragment, null,
                React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return sync(s.id); } }, s.id === "robaws" ? "Sync Robaws" : "\uD83D\uDD04 Sync nu"),
                React.createElement(Btn, { v: "danger", sm: true, onClick: function () { return disconnect(s.id); } }, "Ontkoppelen")) : React.createElement(Btn, { v: "accent", sm: true, onClick: function () { setSel(s); setStep(1); setApiKey(""); setAccountId(""); } }, "Koppelen \u2192"))); })),
        sel && React.createElement(Modal, { title: "".concat(sel.name, " koppelen"), wide: true, onClose: function () { setSel(null); setStep(1); } },
            React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 20 } }, ["DPA", "Datavelden", "API config", "Activeren"].map(function (l, i) { return React.createElement("div", { key: i, style: { flex: 1, textAlign: "center" } },
                React.createElement("div", { style: { height: 3, borderRadius: 3, marginBottom: 4, background: step > i + 1 ? GRN : step === i + 1 ? BLU : BOR } }),
                React.createElement("div", { style: { fontSize: 9, fontWeight: 700, color: step === i + 1 ? BLU : step > i + 1 ? GRN : MUT } }, l)); })),
            step === 1 && React.createElement("div", null,
                React.createElement("div", { style: { background: AMBL, borderRadius: 11, padding: "14px 16px", marginBottom: 16, border: "1px solid ".concat(AMB, "30") } },
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: AMB, marginBottom: 6 } }, "\uD83D\uDCC4 Data Verwerkersovereenkomst (DPA)"),
                    React.createElement("div", { style: { fontSize: 12, color: SUB, lineHeight: 1.7 } },
                        "Door ",
                        sel.name,
                        " te koppelen bevestigt u dat:",
                        React.createElement("br", null),
                        "\u2022 WorkFlow Pro enkel de geselecteerde datavelden verwerkt",
                        React.createElement("br", null),
                        "\u2022 Data uitsluitend op EU-servers opgeslagen wordt (Frankfurt/Amsterdam)",
                        React.createElement("br", null),
                        "\u2022 U als Controller verantwoordelijk bent conform GDPR Art. 28",
                        React.createElement("br", null),
                        "\u2022 De DPA automatisch van kracht gaat bij activatie",
                        sel.id === "robaws" && React.createElement(React.Fragment, null,
                            React.createElement("br", null),
                            "\u2022 Robaws-data alleen gebruikt wordt voor project-, werkbon- en facturatie-synchronisatie"))),
                React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                    React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { setSel(null); setStep(1); } }, "Annuleren"),
                    React.createElement(Btn, { sm: true, onClick: function () { return setStep(2); } }, "DPA bevestigen \u2192"))),
            step === 2 && React.createElement("div", null,
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 12 } }, "Selecteer welke data u wil delen"),
                sel.fields.map(function (f) { return React.createElement("label", { key: f, style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", background: BG, borderRadius: 9, marginBottom: 7, cursor: "pointer", border: "1px solid ".concat(BOR) } },
                    React.createElement("input", { type: "checkbox", defaultChecked: true, style: { width: 14, height: 14, accentColor: BLU } }),
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 600, fontSize: 13 } }, f),
                        React.createElement("div", { style: { fontSize: 11, color: MUT } }, (f === "Loongegevens" || f === "PG") ? "⚠ Hoog risico — versleuteld verstuurd" : "Standaard veld"))); }),
                React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 } },
                    React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setStep(1); } }, "\u2190 Terug"),
                    React.createElement(Btn, { sm: true, onClick: function () { return setStep(3); } }, "Bevestigen \u2192"))),
            step === 3 && React.createElement("div", null,
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 4 } }, "API configuratie"),
                React.createElement("div", { style: { fontSize: 12, color: SUB, marginBottom: 14 } },
                    "Genereer een API key via uw ",
                    sel.name,
                    " portaal en plak deze hieronder."),
                sel.id === "robaws" && React.createElement(Inp, { label: "Robaws bedrijfsaccount / omgeving", value: accountId, onChange: function (e) { return setAccountId(e.target.value); }, placeholder: "Bijv. uw Robaws accountnaam of tenant-id" }),
                React.createElement(Inp, { label: "".concat(sel.name, " API Key"), value: apiKey, onChange: function (e) { return setApiKey(e.target.value); }, placeholder: "Plak hier uw API key..." }),
                React.createElement("div", { style: { background: GRNL, border: "1px solid ".concat(GRN, "30"), borderRadius: 9, padding: "10px 13px", fontSize: 11, color: GRN, marginBottom: 14 } }, "\uD83D\uDD12 API keys worden versleuteld opgeslagen (AES-256) en nooit in plain text getoond."),
                React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                    React.createElement(Btn, { v: "ghost", sm: true, onClick: function () { return setStep(2); } }, "\u2190 Terug"),
                    React.createElement(Btn, { sm: true, disabled: !apiKey || (sel.id === "robaws" && !accountId), onClick: testConnection }, "Verbinding testen \u2192"))),
            step === 4 && React.createElement("div", { style: { textAlign: "center", padding: "10px 0" } },
                React.createElement("div", { style: { fontSize: 40, marginBottom: 12 } }, "\u2705"),
                React.createElement("div", { style: { fontWeight: 800, fontSize: 17, color: TXT, marginBottom: 8 } }, "Verbinding geslaagd!"),
                React.createElement("div", { style: { fontSize: 13, color: SUB, marginBottom: 18, lineHeight: 1.7 } },
                    sel.name,
                    " is klaar om te synchroniseren.",
                    React.createElement("br", null),
                    "Eerste sync wordt automatisch gestart na activatie."),
                ["✓ DPA ondertekend", "✓ Datavelden geselecteerd", "✓ API key geverifieerd", "✓ EU-hosting bevestigd"].map(function (l, i) { return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 9, padding: "8px 13px", background: GRNL, borderRadius: 8, fontSize: 12, color: GRN, fontWeight: 600, marginBottom: 6 } }, l); }),
                React.createElement("div", { style: { marginTop: 16 } },
                    React.createElement(Btn, { v: "success", lg: true, onClick: function () { return connect(sel.id); } }, "\uD83D\uDD17 Activeer integratie")))));
}
// ─── BILLING / ABONNEMENTEN ────────────────────────────────────────────────────
var PLANS = [
    { id: "starter", name: "Starter", tagline: "Voor kleine teams", pricePerUser: 9, color: MUT, popular: false,
        features: ["Prikklok & tijdregistratie", "Weekplanning", "Verlofbeheer", "Team berichten", "Klantenbeheer", "Support"],
        notIncluded: ["Werkbonnen", "Wagenpark beheer", "Stockbeheer", "Integraties", "Rapportages", "Datahub export", "Billing", "Audit logging", "Security/GDPR"] },
    { id: "business", name: "Business", tagline: "Meest gekozen", pricePerUser: 18, color: BLU, popular: true,
        features: ["Prikklok & tijdregistratie", "Weekplanning", "Verlofbeheer", "Team berichten", "Klantenbeheer", "Werkbonnen", "Wagenpark beheer", "Stockbeheer", "Integraties", "Rapportages", "Audit logging", "Security/GDPR", "Support"],
        notIncluded: ["Datahub export", "Billing"] },
    { id: "enterprise", name: "Enterprise", tagline: "Voor grote organisaties", pricePerUser: 29, color: NAV_BG, popular: false,
        features: ["Prikklok & tijdregistratie", "Weekplanning", "Verlofbeheer", "Team berichten", "Klantenbeheer", "Werkbonnen", "Wagenpark beheer", "Stockbeheer", "Integraties", "Rapportages", "Datahub export", "Billing", "Audit logging", "Security/GDPR", "Support"],
        notIncluded: [] },
];
var ADD_MODS = [
    { id: "workorders", icon: "📋", name: "Werkbonnen Pro", price: 3, per: "user/mnd", color: BLU, desc: "Digitale werkbonnen, foto-uploads, handtekening" },
    { id: "vehicles", icon: "🚗", name: "Wagenpark", price: 2, per: "user/mnd", color: PUR, desc: "Voertuigbeheer, service-alerts, bestuurder" },
    { id: "stock", icon: "📦", name: "Stockbeheer", price: 2, per: "user/mnd", color: AMB, desc: "Voorraad, min/max alerts, locaties" },
    { id: "integr", icon: "🔗", name: "Integraties", price: 5, per: "mnd", color: TEAL, desc: "Acerta, Liantis, SD Worx, Securex, Partena, Robaws" },
];
function BillingOpsPage(_a) {
    var tenants = _a.tenants, setTenants = _a.setTenants, platformConfig = _a.platformConfig, toast = _a.toast;
    var _b = useState((tenants[0] || {}).id), selectedId = _b[0], setSelectedId = _b[1];
    var selected = tenants.find(function (t) { return t.id === selectedId; }) || tenants[0] || {};
    var billing = selected.billingOps || {};
    var contact = selected.contactPerson || {};
    var invoiceProfile = selected.invoiceProfile || {};
    var _c = useState({
        line: "Jaarlicentie WorkFlow Pro",
        amount: billing.customAnnualPrice || Math.round((selected.mrr || 0) * 12),
        dueDate: gd(14),
        note: ""
    }), invoice = _c[0], setInvoice = _c[1];
    var updateTenant = function (patch) {
        return setTenants(function (prev) { return prev.map(function (t) { return t.id === selected.id ? __assign(__assign({}, t), patch) : t; }); });
    };
    var updateBilling = function (patch) {
        return updateTenant({ billingOps: __assign(__assign({}, billing), patch) });
    };
    var grossAnnual = function (t) {
        var b = t.billingOps || {};
        return Number(b.customAnnualPrice || (t.mrr || 0) * 12 || 0);
    };
    var netAnnual = function (t) {
        var b = t.billingOps || {};
        var discount = Number(b.discountPct || 0);
        return Math.max(0, +(grossAnnual(t) * (1 - discount / 100)).toFixed(2));
    };
    var saveContract = function () {
        var annual = netAnnual(selected);
        updateTenant({
            mrr: Math.round(annual / 12),
            billingStatus: billing.paymentMethodTokenized ? "paid" : "payment_method_missing",
            lifecycle: selected.plan === "enterprise" ? "enterprise_contract" : selected.lifecycle,
            renewalAt: billing.renewalAt || selected.renewalAt || gd(365),
            nextInvoiceAt: gd(14)
        });
        toast("Contract bijgewerkt", selected.name + " heeft nu klantprijzen en renewal.", "info");
    };
    var tokenizeCard = function () {
        updateTenant({
            paymentMethod: "Card token opgeslagen",
            billingStatus: "paid",
            billingOps: __assign(__assign({}, billing), { paymentMethodTokenized: true, paymentMethodLabel: "Card token via Stripe SetupIntent", paymentMethodRef: "pm_demo_" + uid(), autoCharge: true })
        });
        toast("Betaalmethode opgeslagen", "Demo-token aangemaakt. Geen kaartnummer wordt bewaard.", "info");
    };
    var createInvoice = function () {
        var amount = Number(invoice.amount || 0);
        var discount = Number(billing.discountPct || 0);
        var net = +(amount * (1 - discount / 100)).toFixed(2);
        var inv = {
            id: "INV-" + new Date().getFullYear() + "-" + uid().toUpperCase(),
            at: TODAY,
            dueDate: invoice.dueDate,
            line: invoice.line || "SaaS contract",
            gross: amount,
            discountPct: discount,
            net: net,
            status: "draft",
            peppolStatus: billing.peppolEnabled ? "ready" : "missing_peppol",
            note: invoice.note || ""
        };
        updateBilling({ invoiceHistory: __spreadArray(__spreadArray([], billing.invoiceHistory || [], true), [inv], false) });
        toast("Factuur aangemaakt", inv.id + " - EUR " + net.toFixed(2), "info");
    };
    var sendPeppol = function (inv) {
        updateBilling({ invoiceHistory: (billing.invoiceHistory || []).map(function (x) { return x.id === inv.id ? __assign(__assign({}, x), { status: "sent", peppolStatus: "sent", sentAt: TODAY }) : x; }) });
        toast("Peppol verzonden", inv.id, "info");
    };
    var totalArr = tenants.reduce(function (a, t) { return a + netAnnual(t); }, 0);
    var enterpriseCount = tenants.filter(function (t) { return t.plan === "enterprise"; }).length;
    var peppolReady = tenants.filter(function (t) { return (t.billingOps || {}).peppolEnabled; }).length;
    var tokenized = tenants.filter(function (t) { return (t.billingOps || {}).paymentMethodTokenized; }).length;
    var contractType = billing.contractType || "annual_auto_renew";
    return React.createElement("div", null,
        React.createElement(PageHeader, { title: "Billing operations", sub: "Super-admin facturatie, enterprise contracten, kortingen, Peppol en automatische kaartbetaling." }),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 } },
            React.createElement(KPI, { icon: "ARR", label: "Contractwaarde", value: "EUR " + totalArr.toLocaleString("nl-BE"), color: BLU }),
            React.createElement(KPI, { icon: "ENT", label: "Enterprise", value: enterpriseCount, color: NAV_BG }),
            React.createElement(KPI, { icon: "PEP", label: "Peppol klaar", value: peppolReady + "/" + tenants.length, color: TEAL }),
            React.createElement(KPI, { icon: "PAY", label: "Kaart token", value: tokenized + "/" + tenants.length, color: PUR })),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "330px 1fr", gap: 18, alignItems: "start" } },
            React.createElement(Card, { style: { padding: 14 } },
                React.createElement("div", { style: { fontWeight: 900, fontSize: 14, color: TXT, marginBottom: 10 } }, "Klanten"),
                tenants.map(function (t) {
                    var b = t.billingOps || {};
                    var active = t.id === selected.id;
                    return React.createElement("button", { key: t.id, onClick: function () {
                            setSelectedId(t.id);
                            setInvoice({ line: "Jaarlicentie WorkFlow Pro", amount: b.customAnnualPrice || Math.round((t.mrr || 0) * 12), dueDate: gd(14), note: "" });
                        }, style: { width: "100%", textAlign: "left", padding: "11px 12px", borderRadius: 12, border: "1px solid ".concat(active ? BLU : BOR), background: active ? BLUL : SUR, cursor: "pointer", marginBottom: 8, fontFamily: "inherit" } },
                        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" } },
                            React.createElement("span", { style: { fontWeight: 800, fontSize: 13, color: TXT } }, t.name),
                            React.createElement(Chip, { label: t.plan === "enterprise" ? "Op maat" : t.plan, color: t.plan === "enterprise" ? NAV_BG : BLU })),
                        React.createElement("div", { style: { fontSize: 11, color: SUB, marginTop: 3 } }, ((t.contactPerson || {}).name || t.billingEmail || "Geen contactpersoon")),
                        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 11, color: MUT } },
                            React.createElement("span", null, (b.paymentMethodTokenized ? "kaart klaar" : "kaart ontbreekt")),
                            React.createElement("span", { style: { fontWeight: 800, color: TXT } }, t.plan === "enterprise" ? "custom" : "EUR " + netAnnual(t).toLocaleString("nl-BE"))));
                })),
            React.createElement("div", null,
                React.createElement(Card, { style: { padding: 18, marginBottom: 14 } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", marginBottom: 14 } },
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontWeight: 900, fontSize: 18, color: TXT } }, selected.name || "Klant"),
                            React.createElement("div", { style: { fontSize: 12, color: SUB, marginTop: 3 } }, selected.plan === "enterprise" ? "Enterprise: geen publieke prijs tonen, contract via offerte/facturatie." : "Standaard plan met klantgerichte prijsafspraken.")),
                        React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" } },
                            React.createElement(Chip, { label: billing.paymentMethodTokenized ? "Kaarttoken actief" : "Betaalmethode ontbreekt", color: billing.paymentMethodTokenized ? GRN : AMB }),
                            React.createElement(Chip, { label: billing.peppolEnabled ? "Peppol klaar" : "Peppol ontbreekt", color: billing.peppolEnabled ? TEAL : RED }))),
                    React.createElement("div", { style: { background: BG, border: "1px solid ".concat(BOR), borderRadius: 12, padding: 12, marginBottom: 12 } },
                        React.createElement("div", { style: { fontWeight: 900, fontSize: 13, color: TXT, marginBottom: 4 } }, "Contact uit klantenfiche"),
                        React.createElement("div", { style: { fontSize: 12, color: SUB, lineHeight: 1.6 } }, (contact.name || "Geen contactpersoon ingesteld") + (contact.role ? " - " + contact.role : ""),
                            React.createElement("br", null),
                            contact.email || selected.billingEmail || "Geen e-mail",
                            contact.phone ? " - " + contact.phone : "")),
                    React.createElement("div", { style: { background: BG, border: "1px solid ".concat(BOR), borderRadius: 12, padding: 12, marginBottom: 12 } },
                        React.createElement("div", { style: { fontWeight: 900, fontSize: 13, color: TXT, marginBottom: 4 } }, "Factuurgegevens uit klantenfiche"),
                        React.createElement("div", { style: { fontSize: 12, color: SUB, lineHeight: 1.6 } },
                            selected.name || "Geen juridische naam",
                            " - ",
                            invoiceProfile.vat || "geen BTW",
                            React.createElement("br", null),
                            [invoiceProfile.street, invoiceProfile.postalCode, invoiceProfile.city, invoiceProfile.country].filter(Boolean).join(", ") || "Geen facturatieadres",
                            React.createElement("br", null),
                            "Peppol: ",
                            invoiceProfile.peppolId || billing.peppolId || "niet ingesteld",
                            " - Betaling: ",
                            invoiceProfile.paymentTerms || "30 dagen")),
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 } },
                        React.createElement(Inp, { label: "Jaarprijs excl. BTW", type: "number", value: billing.customAnnualPrice || grossAnnual(selected), onChange: function (e) { return updateBilling({ customAnnualPrice: Number(e.target.value || 0) }); } }),
                        React.createElement(Inp, { label: "Korting %", type: "number", value: billing.discountPct || 0, onChange: function (e) { return updateBilling({ discountPct: Number(e.target.value || 0) }); } }),
                        React.createElement(Inp, { label: "Renewal datum", type: "date", value: billing.renewalAt || selected.renewalAt || gd(365), onChange: function (e) { return updateBilling({ renewalAt: e.target.value }); } }),
                        React.createElement(Inp, { label: "Peppol ID", value: billing.peppolId || invoiceProfile.peppolId || "", onChange: function (e) { return updateBilling({ peppolId: e.target.value }); }, placeholder: "BE:VAT:..." }),
                        React.createElement(Sel, { label: "Peppol", value: billing.peppolEnabled ? "yes" : "no", onChange: function (e) { return updateBilling({ peppolEnabled: e.target.value === "yes" }); }, opts: [["no", "Nog niet actief"], ["yes", "Automatisch verzenden"]] }),
                        React.createElement(Sel, { label: "Contract", value: contractType, onChange: function (e) { return updateBilling({ contractType: e.target.value }); }, opts: [["annual_auto_renew", "Jaarlijks auto-renew"], ["annual_manual", "Jaarlijks handmatig"], ["monthly", "Maandelijks"]] })),
                    React.createElement("div", { style: { background: BG, border: "1px solid ".concat(BOR), borderRadius: 12, padding: 12, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 } },
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontWeight: 900, color: TXT } }, "Netto jaarcontract: EUR " + netAnnual(selected).toLocaleString("nl-BE")),
                            React.createElement("div", { style: { fontSize: 11, color: SUB, marginTop: 3 } }, "Automatische afhaling vereist een tokenized betaalmethode. Raw kaartgegevens worden nooit opgeslagen.")),
                        React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" } },
                            React.createElement(Btn, { v: "ghost", onClick: tokenizeCard }, "Kaart setup-token opslaan"),
                            React.createElement(Btn, { onClick: saveContract }, "Contract bewaren")))),
                React.createElement(Card, { style: { padding: 18, marginBottom: 14 } },
                    React.createElement("div", { style: { fontWeight: 900, fontSize: 15, color: TXT, marginBottom: 12 } }, "Factuur aanmaken"),
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginBottom: 10 } },
                        React.createElement(Inp, { label: "Factuurlijn", value: invoice.line, onChange: function (e) { return setInvoice(__assign(__assign({}, invoice), { line: e.target.value })); } }),
                        React.createElement(Inp, { label: "Bedrag excl. BTW", type: "number", value: invoice.amount, onChange: function (e) { return setInvoice(__assign(__assign({}, invoice), { amount: Number(e.target.value || 0) })); } }),
                        React.createElement(Inp, { label: "Vervaldatum", type: "date", value: invoice.dueDate, onChange: function (e) { return setInvoice(__assign(__assign({}, invoice), { dueDate: e.target.value })); } })),
                    React.createElement(Inp, { label: "Interne notitie", value: invoice.note, onChange: function (e) { return setInvoice(__assign(__assign({}, invoice), { note: e.target.value })); }, placeholder: "Bijv. PO-nummer, afspraak of kortingreden" }),
                    React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: 10 } },
                        React.createElement(Btn, { onClick: createInvoice, disabled: !invoice.line || !invoice.amount }, "Factuur aanmaken"))),
                React.createElement(Card, { style: { padding: 18 } },
                    React.createElement("div", { style: { fontWeight: 900, fontSize: 15, color: TXT, marginBottom: 12 } }, "Factuurhistoriek"),
                    (billing.invoiceHistory || []).length === 0 ? React.createElement(EmptyState, { title: "Nog geen facturen", body: "Maak de eerste factuur aan vanuit super admin.", compact: true })
                        : React.createElement("div", { style: { display: "grid", gap: 8 } }, (billing.invoiceHistory || []).slice().reverse().map(function (inv) { return React.createElement("div", { key: inv.id, style: { display: "grid", gridTemplateColumns: "140px 1fr 110px 120px 110px", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid ".concat(BOR), borderRadius: 11, background: BG } },
                            React.createElement("div", { style: { fontWeight: 900, fontSize: 12, color: TXT } }, inv.id),
                            React.createElement("div", null,
                                React.createElement("div", { style: { fontWeight: 700, fontSize: 12, color: TXT } }, inv.line),
                                React.createElement("div", { style: { fontSize: 11, color: SUB } }, "Vervalt " + fD(inv.dueDate))),
                            React.createElement("div", { style: { fontWeight: 900, fontSize: 12, color: TXT } }, "EUR " + Number(inv.net || 0).toFixed(2)),
                            React.createElement(Chip, { label: inv.peppolStatus || inv.status, color: inv.peppolStatus === "sent" ? GRN : inv.peppolStatus === "ready" ? TEAL : AMB }),
                            React.createElement(Btn, { sm: true, v: inv.peppolStatus === "ready" ? "pri" : "ghost", disabled: inv.peppolStatus !== "ready", onClick: function () { return sendPeppol(inv); } }, "Peppol")); }))))));
}
function BillingPage(_a) {
    var user = _a.user, tenants = _a.tenants, setTenants = _a.setTenants, toast = _a.toast, platformConfig = _a.platformConfig;
    var _b = useState("pricing"), tab = _b[0], setTab = _b[1];
    var _c = useState("business"), selPlan = _c[0], setSelPlan = _c[1];
    var _d = useState(10), userCount = _d[0], setUserCount = _d[1];
    var _e = useState(["workorders"]), selMods = _e[0], setSelMods = _e[1];
    var _f = useState("monthly"), cycle = _f[0], setCycle = _f[1];
    var _g = useState(false), checkout = _g[0], setCheckout = _g[1];
    var _h = useState(1), checkStep = _h[0], setCheckStep = _h[1];
    var _j = useState(false), paid = _j[0], setPaid = _j[1];
    var _k = useState({ company: "", email: "", vat: "", card: "", exp: "", cvc: "", name: "" }), cardForm = _k[0], setCardForm = _k[1];
    var isSA = user.role === "super_admin";
    var runtimePlans = ((platformConfig === null || platformConfig === void 0 ? void 0 : platformConfig.plans) || PLANS).filter(function (p) { return p.active !== false; });
    var runtimeMods = ((platformConfig === null || platformConfig === void 0 ? void 0 : platformConfig.modules) || ADD_MODS).filter(function (m) { return m.active !== false; });
    var billCfg = (platformConfig === null || platformConfig === void 0 ? void 0 : platformConfig.billing) || {};
    var yearlyDiscount = Number(billCfg.yearlyDiscount || 20);
    var vatRate = Number(billCfg.vatRate || 21);
    var plan = runtimePlans.find(function (p) { return p.id === selPlan; }) || runtimePlans[0] || PLANS[0];
    var disc = cycle === "yearly" ? 1 - yearlyDiscount / 100 : 1;
    var basePrice = plan.pricePerUser * userCount * disc;
    var modPrice = selMods.reduce(function (a, mid) { var m = runtimeMods.find(function (x) { return x.id === mid; }); if (!m)
        return a; return a + (m.per === "mnd" ? m.price : m.price * userCount) * disc; }, 0);
    var subtotal = basePrice + modPrice;
    var btw = subtotal * (vatRate / 100);
    var total = subtotal + btw;
    var toggleMod = function (id) { return setSelMods(function (p) { return p.includes(id) ? p.filter(function (x) { return x !== id; }) : __spreadArray(__spreadArray([], p, true), [id], false); }); };
    var fmtCard = function (v) { return v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim(); };
    var fmtExp = function (v) { var d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d; };
    var PLANC = { starter: MUT, business: BLU, enterprise: NAV_BG };
    var TABS = __spreadArray([{ id: "pricing", label: "💰 Plannen" }, { id: "configure", label: "⚙️ Configurator" }, { id: "invoice", label: "📄 Factuurvoorbeeld" }], (isSA ? [{ id: "revenue", label: "📊 Revenue" }] : []), true);
    return React.createElement("div", null,
        React.createElement("div", { style: { background: NAV_BG, borderRadius: 16, padding: "22px 26px", marginBottom: 22 } },
            React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 } },
                React.createElement("div", null,
                    React.createElement("h2", { style: { fontWeight: 900, fontSize: 22, color: "#fff", letterSpacing: -.5, margin: 0 } }, "\uD83D\uDCB3 Abonnementen & Billing"),
                    React.createElement("p", { style: { fontSize: 13, color: "rgba(255,255,255,.45)", marginTop: 4 } }, "SaaS billing via Stripe \u00B7 Per gebruiker \u00B7 Automatische BTW-factuur")),
                React.createElement("div", { style: { display: "flex", gap: 6 } }, [["🇪🇺 GDPR", "#60A5FA"], ["Stripe", "#A5B4FC"], ["PCI DSS", "#6EE7B7"]].map(function (_a) {
                    var l = _a[0], col = _a[1];
                    return React.createElement("span", { key: l, style: { background: col + "20", color: col, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 } }, l);
                }))),
            React.createElement("div", { style: { display: "flex", gap: 2 } }, TABS.map(function (t) { return React.createElement("button", { key: t.id, onClick: function () { return setTab(t.id); }, style: { padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", background: tab === t.id ? "rgba(255,255,255,.15)" : "transparent", color: tab === t.id ? "#fff" : "rgba(255,255,255,.45)", transition: "all .15s" } }, t.label); }))),
        tab === "pricing" && React.createElement("div", null,
            React.createElement("div", { style: { display: "flex", justifyContent: "center", marginBottom: 22 } },
                React.createElement("div", { style: { display: "flex", background: SUR, border: "1px solid ".concat(BOR), borderRadius: 12, padding: 4, gap: 2 } }, [{ id: "monthly", label: "Maandelijks" }, { id: "yearly", label: "Jaarlijks", badge: "-" + yearlyDiscount + "%" }].map(function (cy) { return React.createElement("button", { key: cy.id, onClick: function () { return setCycle(cy.id); }, style: { padding: "7px 18px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", background: cycle === cy.id ? NAV_BG : "transparent", color: cycle === cy.id ? "#fff" : SUB, transition: "all .15s", display: "flex", alignItems: "center", gap: 7 } },
                    cy.label,
                    cy.badge && React.createElement("span", { style: { background: GRN, color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 10 } }, cy.badge)); }))),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 28 } }, runtimePlans.map(function (p) { return React.createElement("div", { key: p.id, style: { borderRadius: 16, overflow: "hidden", border: "2px solid ".concat(selPlan === p.id ? p.color : BOR), boxShadow: selPlan === p.id ? "0 0 0 3px ".concat(p.color, "20") : SH, background: SUR, transition: "all .2s" } },
                p.popular && React.createElement("div", { style: { background: p.color, color: "#fff", fontSize: 10, fontWeight: 700, textAlign: "center", padding: "4px 0", letterSpacing: .5 } }, "\u2B50 MEEST GEKOZEN"),
                React.createElement("div", { style: { padding: "20px 22px" } },
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 17, color: TXT, marginBottom: 3 } }, p.name),
                    React.createElement("div", { style: { fontSize: 12, color: MUT, marginBottom: 14 } }, p.tagline),
                    React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 3, marginBottom: 14 } },
                        React.createElement("span", { style: { fontWeight: 900, fontSize: 30, color: p.color, letterSpacing: -1 } },
                            "\u20AC",
                            (p.pricePerUser * disc).toFixed(0)),
                        React.createElement("span", { style: { fontSize: 12, color: MUT } }, "/user/mnd")),
                    React.createElement(Btn, { style: { width: "100%", color: selPlan === p.id ? "#fff" : p.color, background: selPlan === p.id ? p.color : "transparent", border: "1.5px solid ".concat(p.color) }, onClick: function () { setSelPlan(p.id); setTab("configure"); } }, selPlan === p.id ? "✓ Geselecteerd" : "Selecteren →"),
                    React.createElement("div", { style: { height: 1, background: BOR, margin: "16px 0" } }),
                    p.features.map(function (f, i) { return React.createElement("div", { key: i, style: { display: "flex", gap: 7, fontSize: 12, color: TXT, marginBottom: 6 } },
                        React.createElement("span", { style: { color: GRN, fontWeight: 700, flexShrink: 0 } }, "\u2713"),
                        f); }),
                    p.notIncluded.map(function (f, i) { return React.createElement("div", { key: i, style: { display: "flex", gap: 7, fontSize: 12, color: MUT, marginBottom: 6 } },
                        React.createElement("span", { style: { flexShrink: 0 } }, "\u2715"),
                        f); }))); })),
            React.createElement("div", { style: { fontWeight: 700, fontSize: 15, color: TXT, marginBottom: 14 } }, "\uD83E\uDDE9 Extra modules"),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 11 } }, runtimeMods.map(function (m) { return React.createElement("div", { key: m.id, onClick: function () { return toggleMod(m.id); }, style: { background: SUR, borderRadius: 13, padding: "14px 16px", border: "2px solid ".concat(selMods.includes(m.id) ? m.color : BOR), cursor: "pointer", transition: "all .15s", boxShadow: selMods.includes(m.id) ? "0 0 0 3px ".concat(m.color, "12") : SH } },
                React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9 } },
                        React.createElement("div", { style: { width: 36, height: 36, borderRadius: 10, background: m.color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 } }, m.icon),
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: TXT } }, m.name),
                            React.createElement("div", { style: { fontSize: 11, color: MUT, marginTop: 1 } }, m.desc))),
                    React.createElement("div", { style: { width: 22, height: 22, borderRadius: "50%", flexShrink: 0, border: "2px solid ".concat(selMods.includes(m.id) ? m.color : BOR), background: selMods.includes(m.id) ? m.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, transition: "all .15s" } }, selMods.includes(m.id) ? "✓" : "")),
                React.createElement("span", { style: { fontWeight: 800, fontSize: 14, color: m.color } },
                    "+\u20AC",
                    m.price,
                    React.createElement("span", { style: { fontSize: 11, fontWeight: 500, color: MUT } },
                        "/",
                        m.per))); }))),
        tab === "configure" && React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" } },
            React.createElement("div", null,
                React.createElement(Card, { style: { padding: "20px 22px", marginBottom: 14 } },
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 12 } }, "1. Plan"),
                    runtimePlans.map(function (p) { return React.createElement("div", { key: p.id, onClick: function () { return setSelPlan(p.id); }, style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", borderRadius: 11, border: "2px solid ".concat(selPlan === p.id ? p.color : BOR), cursor: "pointer", background: selPlan === p.id ? p.color + "08" : "transparent", marginBottom: 7, transition: "all .15s" } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9 } },
                            React.createElement("div", { style: { width: 19, height: 19, borderRadius: "50%", border: "2px solid ".concat(selPlan === p.id ? p.color : BOR), background: selPlan === p.id ? p.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 } }, selPlan === p.id ? "✓" : ""),
                            React.createElement("span", { style: { fontWeight: 700, fontSize: 13, color: TXT } }, p.name)),
                        React.createElement("span", { style: { fontWeight: 700, fontSize: 13, color: p.color } },
                            "\u20AC",
                            (p.pricePerUser * disc).toFixed(0),
                            "/user/mnd")); })),
                React.createElement(Card, { style: { padding: "20px 22px", marginBottom: 14 } },
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 12 } },
                        "2. Gebruikers: ",
                        React.createElement("span", { style: { color: BLU, fontSize: 18 } }, userCount)),
                    React.createElement("input", { type: "range", min: 1, max: 100, value: userCount, onChange: function (e) { return setUserCount(Number(e.target.value)); }, style: { width: "100%", accentColor: BLU, cursor: "pointer" } }),
                    React.createElement("div", { style: { display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" } }, [5, 10, 15, 25, 50, 100].map(function (n) { return React.createElement("button", { key: n, onClick: function () { return setUserCount(n); }, style: { padding: "4px 13px", borderRadius: 20, border: "1.5px solid ".concat(userCount === n ? BLU : BOR), background: userCount === n ? BLUL : "transparent", color: userCount === n ? BLU : SUB, fontSize: 11, fontWeight: 700, cursor: "pointer" } }, n); }))),
                React.createElement(Card, { style: { padding: "20px 22px" } },
                    React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 12 } }, "3. Facturatieperiode"),
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, [{ id: "monthly", label: "Maandelijks", sub: "Maandelijks opzegbaar" }, { id: "yearly", label: "Jaarlijks", sub: "2 maanden gratis", badge: "-20%" }].map(function (cy) { return React.createElement("div", { key: cy.id, onClick: function () { return setCycle(cy.id); }, style: { padding: "13px 14px", borderRadius: 11, border: "2px solid ".concat(cycle === cy.id ? BLU : BOR), cursor: "pointer", background: cycle === cy.id ? BLUL : "transparent", transition: "all .15s" } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
                            React.createElement("span", { style: { fontWeight: 700, fontSize: 13, color: TXT } }, cy.label),
                            cy.badge && React.createElement("span", { style: { background: GRN, color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 10 } }, cy.badge)),
                        React.createElement("div", { style: { fontSize: 11, color: SUB, marginTop: 3 } }, cy.sub)); })))),
            React.createElement("div", { style: { position: "sticky", top: 20 } },
                React.createElement(Card, { style: { padding: "20px 22px" } },
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 15, color: TXT, marginBottom: 14 } }, "Overzicht"),
                    React.createElement("div", { style: { background: BG, borderRadius: 10, padding: "11px 13px", marginBottom: 9 } },
                        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 13 } },
                            React.createElement("span", { style: { color: SUB } },
                                plan.name,
                                " \u00B7 ",
                                userCount,
                                " users"),
                            React.createElement("span", { style: { fontWeight: 600 } },
                                "\u20AC",
                                basePrice.toFixed(2)))),
                    selMods.map(function (mid) { var m = runtimeMods.find(function (x) { return x.id === mid; }); if (!m)
                        return null; var lt = m.per === "mnd" ? m.price * disc : m.price * userCount * disc; return React.createElement("div", { key: mid, style: { display: "flex", justifyContent: "space-between", padding: "6px 13px", fontSize: 12, color: SUB, background: m.color + "08", borderRadius: 8, marginBottom: 5 } },
                        React.createElement("span", null,
                            m.icon,
                            " ",
                            m.name),
                        React.createElement("span", { style: { fontWeight: 600 } },
                            "\u20AC",
                            lt.toFixed(2))); }),
                    cycle === "yearly" && React.createElement("div", { style: { display: "flex", justifyContent: "space-between", padding: "6px 13px", fontSize: 12, color: GRN, fontWeight: 700, background: GRNL, borderRadius: 8, marginBottom: 5 } },
                        React.createElement("span", null, "\uD83C\uDF89 Jaarkorting (".concat(yearlyDiscount, "%)")),
                        React.createElement("span", null,
                            "-\u20AC",
                            ((subtotal / disc) * (yearlyDiscount / 100)).toFixed(2))),
                    React.createElement("div", { style: { height: 1, background: BOR, margin: "12px 0" } }),
                    [["Subtotaal excl. BTW", "\u20AC".concat(subtotal.toFixed(2))], ["BTW ".concat(vatRate, "%"), "\u20AC".concat(btw.toFixed(2))]].map(function (_a) {
                        var k = _a[0], v = _a[1];
                        return React.createElement("div", { key: k, style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: SUB, marginBottom: 5 } },
                            React.createElement("span", null, k),
                            React.createElement("span", null, v));
                    }),
                    React.createElement("div", { style: { background: NAV_BG, borderRadius: 11, padding: "13px 15px", margin: "11px 0 14px", display: "flex", justifyContent: "space-between", alignItems: "center" } },
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontSize: 11, color: "rgba(255,255,255,.5)" } }, "Totaal te betalen"),
                            React.createElement("div", { style: { fontSize: 9, color: "rgba(255,255,255,.35)" } },
                                cycle === "yearly" ? "per jaar" : "per maand",
                                " \u00B7 incl. BTW")),
                        React.createElement("span", { style: { fontWeight: 900, fontSize: 22, color: "#fff" } },
                            "\u20AC",
                            total.toFixed(2))),
                    paid ? React.createElement("div", { style: { background: GRNL, border: "1px solid ".concat(GRN, "30"), borderRadius: 11, padding: 14, textAlign: "center" } },
                        React.createElement("div", { style: { fontSize: 22, marginBottom: 4 } }, "\u2705"),
                        React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: GRN } }, "Account actief!"))
                        : React.createElement("button", { onClick: function () { setCheckout(true); setCheckStep(1); }, style: { width: "100%", background: "#635BFF", border: "none", color: "#fff", padding: "12px", fontSize: 14, fontWeight: 700, borderRadius: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontFamily: "inherit" } }, "\uD83D\uDCB3 Betalen via Stripe"),
                    React.createElement("div", { style: { textAlign: "center", fontSize: 10, color: MUT, marginTop: 9 } }, "\uD83D\uDD12 Stripe \u00B7 PCI DSS \u00B7 BTW-factuur automatisch")))),
        tab === "invoice" && React.createElement("div", { style: { background: SUR, borderRadius: 14, border: "1px solid ".concat(BOR), overflow: "hidden", boxShadow: SH } },
            React.createElement("div", { style: { background: NAV_BG, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
                React.createElement("div", null,
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } },
                        React.createElement("div", { style: { width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#3B82F6,#6366F1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 } }, "\u26A1"),
                        React.createElement("span", { style: { fontWeight: 800, fontSize: 16, color: "#fff" } }, "WorkFlow Pro")),
                    React.createElement("div", { style: { fontSize: 11, color: "rgba(255,255,255,.5)" } },
                        "Slachthuisstraat 28 \u00B7 9000 Gent",
                        React.createElement("br", null),
                        "BTW BE 0000.000.000")),
                React.createElement("div", { style: { textAlign: "right" } },
                    React.createElement("div", { style: { fontWeight: 800, fontSize: 18, color: "#fff" } }, "FACTUUR"),
                    React.createElement("div", { style: { fontSize: 12, color: "rgba(255,255,255,.6)", marginTop: 4 } },
                        "WFP-2026-",
                        Math.floor(Math.random() * 9000 + 1000)),
                    React.createElement("div", { style: { fontSize: 11, color: "rgba(255,255,255,.5)", marginTop: 2 } },
                        "Datum: ",
                        fD(TODAY)))),
            React.createElement("div", { style: { padding: "20px 24px" } },
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 } },
                    React.createElement("div", { style: { background: BG, borderRadius: 9, padding: "11px 13px" } },
                        React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: MUT, textTransform: "uppercase", marginBottom: 5 } }, "Gefactureerd aan"),
                        React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, "Uw Bedrijf NV"),
                        React.createElement("div", { style: { fontSize: 12, color: SUB } }, "billing@uw.be")),
                    React.createElement("div", { style: { background: BG, borderRadius: 9, padding: "11px 13px" } },
                        React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: MUT, textTransform: "uppercase", marginBottom: 5 } }, "Abonnement"),
                        React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } },
                            plan.name,
                            " Plan"),
                        React.createElement("div", { style: { fontSize: 12, color: SUB } },
                            cycle === "yearly" ? "Jaarlijks" : "Maandelijks",
                            " \u00B7 ",
                            userCount,
                            " gebruikers"))),
                React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", marginBottom: 14 } },
                    React.createElement("thead", null,
                        React.createElement("tr", { style: { background: BG } }, ["Omschrijving", "Aantal", "Eenheidsprijs", "Totaal"].map(function (h, i) { return React.createElement("th", { key: h, style: { padding: "8px 11px", fontSize: 11, fontWeight: 700, color: SUB, textTransform: "uppercase", letterSpacing: .5, textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid ".concat(BOR) } }, h); }))),
                    React.createElement("tbody", null,
                        React.createElement("tr", { style: { borderBottom: "1px solid ".concat(BOR) } },
                            React.createElement("td", { style: { padding: "10px 11px", fontSize: 13 } },
                                "WorkFlow Pro ",
                                plan.name),
                            React.createElement("td", { style: { padding: "10px 11px", fontSize: 13, color: SUB, textAlign: "right" } },
                                userCount,
                                " users"),
                            React.createElement("td", { style: { padding: "10px 11px", fontSize: 13, color: SUB, textAlign: "right" } },
                                "\u20AC",
                                (plan.pricePerUser * disc).toFixed(2),
                                "/user"),
                            React.createElement("td", { style: { padding: "10px 11px", fontSize: 13, fontWeight: 600, textAlign: "right" } },
                                "\u20AC",
                                basePrice.toFixed(2))),
                        selMods.map(function (mid) { var m = runtimeMods.find(function (x) { return x.id === mid; }); if (!m)
                            return null; var lt = m.per === "mnd" ? m.price * disc : m.price * userCount * disc; return React.createElement("tr", { key: mid, style: { borderBottom: "1px solid ".concat(BOR) } },
                            React.createElement("td", { style: { padding: "10px 11px", fontSize: 13 } },
                                m.icon,
                                " Module: ",
                                m.name),
                            React.createElement("td", { style: { padding: "10px 11px", fontSize: 13, color: SUB, textAlign: "right" } }, m.per === "mnd" ? "1 mnd" : "".concat(userCount, " users")),
                            React.createElement("td", { style: { padding: "10px 11px", fontSize: 13, color: SUB, textAlign: "right" } },
                                "\u20AC",
                                (m.price * disc).toFixed(2),
                                "/",
                                m.per === "mnd" ? "mnd" : "user"),
                            React.createElement("td", { style: { padding: "10px 11px", fontSize: 13, fontWeight: 600, textAlign: "right" } },
                                "\u20AC",
                                lt.toFixed(2))); }))),
                React.createElement("div", { style: { display: "flex", justifyContent: "flex-end" } },
                    React.createElement("div", { style: { minWidth: 240 } },
                        [["Subtotaal excl. BTW", "\u20AC".concat(subtotal.toFixed(2))], ["BTW ".concat(vatRate, "%"), "\u20AC".concat(btw.toFixed(2))]].map(function (_a) {
                            var k = _a[0], v = _a[1];
                            return React.createElement("div", { key: k, style: { display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, color: SUB } },
                                React.createElement("span", null, k),
                                React.createElement("span", null, v));
                        }),
                        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", padding: "10px 13px", background: NAV_BG, borderRadius: 9, marginTop: 7, fontSize: 14, fontWeight: 800, color: "#fff" } },
                            React.createElement("span", null, "Totaal"),
                            React.createElement("span", null,
                                "\u20AC",
                                total.toFixed(2))))))),
        tab === "revenue" && isSA && React.createElement("div", null,
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", gap: 12, marginBottom: 22 } },
                React.createElement(KPI, { icon: "\uD83D\uDCB0", label: "MRR", value: "\u20AC".concat(tenants.filter(function (t) { return t.status === "active"; }).reduce(function (a, t) { return a + t.mrr; }, 0)), color: GRN }),
                React.createElement(KPI, { icon: "\uD83D\uDCC8", label: "ARR", value: "\u20AC".concat((tenants.filter(function (t) { return t.status === "active"; }).reduce(function (a, t) { return a + t.mrr; }, 0) * 12).toLocaleString()), color: TEAL }),
                React.createElement(KPI, { icon: "\uD83C\uDFE2", label: "Actief", value: tenants.filter(function (t) { return t.status === "active"; }).length, color: BLU }),
                React.createElement(KPI, { icon: "\u25D0", label: "Trial", value: tenants.filter(function (t) { return t.status === "trial"; }).length, color: AMB }),
                React.createElement(KPI, { icon: "\u2298", label: "Geschorst", value: tenants.filter(function (t) { return t.status === "suspended"; }).length, color: RED })),
            React.createElement(Card, { style: { padding: 0, overflow: "hidden" } },
                React.createElement("div", { style: { padding: "14px 18px", borderBottom: "1px solid ".concat(BOR), fontWeight: 700, fontSize: 14 } }, "Alle abonnementen"),
                tenants.sort(function (a, b) { return b.mrr - a.mrr; }).map(function (t) { return React.createElement("div", { key: t.id, style: { display: "grid", gridTemplateColumns: "1fr 95px 70px 100px 95px", gap: 12, padding: "13px 18px", borderBottom: "1px solid ".concat(BOR), alignItems: "center" }, onMouseEnter: function (e) { return e.currentTarget.style.background = BG; }, onMouseLeave: function (e) { return e.currentTarget.style.background = ""; } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 600, fontSize: 13, color: TXT } }, t.name),
                        React.createElement("div", { style: { fontSize: 11, color: MUT } }, t.billingEmail)),
                    React.createElement(Chip, { label: t.plan, color: { starter: MUT, business: BLU, enterprise: GRN }[t.plan] }),
                    React.createElement("span", { style: { fontSize: 12, color: SUB } },
                        t.users,
                        " users"),
                    React.createElement("span", { style: { fontFamily: "monospace", fontWeight: 700, color: GRN, fontSize: 13 } },
                        "\u20AC",
                        t.mrr.toFixed(2),
                        "/mnd"),
                    React.createElement(SChip, { label: t.status, sk: t.status })); }))),
        checkout && React.createElement(Modal, { title: "Afrekenen", wide: true, onClose: function () { setCheckout(false); setCheckStep(1); } },
            React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 20 } }, ["Bedrijf", "Betaling", "Klaar"].map(function (l, i) { return React.createElement("div", { key: i, style: { flex: 1, textAlign: "center" } },
                React.createElement("div", { style: { height: 3, borderRadius: 3, marginBottom: 4, background: checkStep > i + 1 ? GRN : checkStep === i + 1 ? BLU : BOR } }),
                React.createElement("div", { style: { fontSize: 9, fontWeight: 700, color: checkStep === i + 1 ? BLU : checkStep > i + 1 ? GRN : MUT } }, l)); })),
            checkStep === 1 && React.createElement("div", null,
                React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 14 } }, "Bedrijfsgegevens"),
                React.createElement(Inp, { label: "Bedrijfsnaam", value: cardForm.company, onChange: function (e) { return setCardForm(__assign(__assign({}, cardForm), { company: e.target.value })); }, placeholder: "Uw Bedrijf NV" }),
                React.createElement(Inp, { label: "E-mailadres voor facturen", type: "email", value: cardForm.email, onChange: function (e) { return setCardForm(__assign(__assign({}, cardForm), { email: e.target.value })); }, placeholder: "billing@bedrijf.be" }),
                React.createElement(Inp, { label: "BTW-nummer (optioneel)", value: cardForm.vat, onChange: function (e) { return setCardForm(__assign(__assign({}, cardForm), { vat: e.target.value })); }, placeholder: "BE 0000.000.000" }),
                React.createElement("div", { style: { background: BG, borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 12, color: SUB } },
                    React.createElement("strong", { style: { color: TXT } }, "Samenvatting:"),
                    " WorkFlow Pro ",
                    plan.name,
                    " \u00B7 ",
                    userCount,
                    " users \u00B7 ",
                    cycle === "yearly" ? "Jaarlijks" : "Maandelijks",
                    " \u00B7 ",
                    React.createElement("strong", { style: { color: BLU } },
                        "\u20AC",
                        total.toFixed(2),
                        " incl. BTW")),
                React.createElement(Btn, { v: "pri", lg: true, full: true, disabled: !cardForm.company || !cardForm.email, onClick: function () { return setCheckStep(2); } }, "Verder naar betaling \u2192")),
            checkStep === 2 && React.createElement("div", null,
                React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: TXT, marginBottom: 10 } }, "Betaalgegevens"),
                React.createElement("div", { style: { border: "1.5px solid ".concat(BOR), borderRadius: 11, overflow: "hidden", marginBottom: 12 } },
                    React.createElement("div", { style: { padding: "9px 12px", borderBottom: "1px solid ".concat(BOR) } },
                        React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: MUT, marginBottom: 4 } }, "KAARTNUMMER"),
                        React.createElement("input", { placeholder: "1234 5678 9012 3456", value: cardForm.card, onChange: function (e) { return setCardForm(__assign(__assign({}, cardForm), { card: fmtCard(e.target.value) })); }, style: { width: "100%", border: "none", outline: "none", fontSize: 14, fontFamily: "monospace", background: "transparent" } })),
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr" } },
                        React.createElement("div", { style: { padding: "9px 12px", borderRight: "1px solid ".concat(BOR) } },
                            React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: MUT, marginBottom: 4 } }, "VERVALDATUM"),
                            React.createElement("input", { placeholder: "MM/JJ", value: cardForm.exp, onChange: function (e) { return setCardForm(__assign(__assign({}, cardForm), { exp: fmtExp(e.target.value) })); }, style: { width: "100%", border: "none", outline: "none", fontSize: 14, fontFamily: "monospace", background: "transparent" } })),
                        React.createElement("div", { style: { padding: "9px 12px" } },
                            React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: MUT, marginBottom: 4 } }, "CVC"),
                            React.createElement("input", { placeholder: "123", value: cardForm.cvc, onChange: function (e) { return setCardForm(__assign(__assign({}, cardForm), { cvc: e.target.value.slice(0, 3) })); }, style: { width: "100%", border: "none", outline: "none", fontSize: 14, fontFamily: "monospace", background: "transparent" } })))),
                React.createElement(Inp, { label: "Naam op kaart", value: cardForm.name, onChange: function (e) { return setCardForm(__assign(__assign({}, cardForm), { name: e.target.value })); }, placeholder: "Jan Janssen" }),
                React.createElement("div", { style: { background: GRNL, border: "1px solid ".concat(GRN, "30"), borderRadius: 9, padding: "9px 12px", marginBottom: 14, fontSize: 11, color: GRN, display: "flex", gap: 7, alignItems: "center" } }, "\uD83D\uDD12 Kaartgegevens worden nooit opgeslagen bij WorkFlow Pro. 100% via Stripe."),
                React.createElement("button", { onClick: function () { if (cardForm.card && cardForm.exp && cardForm.cvc)
                        setCheckStep(3); }, style: { width: "100%", background: "#635BFF", border: "none", color: "#fff", padding: "12px", fontSize: 14, fontWeight: 700, borderRadius: 11, cursor: (!cardForm.card || !cardForm.exp || !cardForm.cvc) ? "not-allowed" : "pointer", opacity: (!cardForm.card || !cardForm.exp || !cardForm.cvc) ? .5 : 1, fontFamily: "inherit" } },
                    "\uD83D\uDCB3 Betaal \u20AC",
                    total.toFixed(2),
                    " via Stripe"),
                React.createElement("div", { style: { textAlign: "center", fontSize: 10, color: MUT, marginTop: 8 } },
                    "Beveiligd door ",
                    React.createElement("strong", { style: { color: "#635BFF" } }, "Stripe"),
                    " \u00B7 PCI DSS Compliant")),
            checkStep === 3 && React.createElement("div", { style: { textAlign: "center", padding: "16px 0" } },
                React.createElement("div", { style: { fontSize: 52, marginBottom: 14 } }, "\u2705"),
                React.createElement("div", { style: { fontWeight: 800, fontSize: 19, color: TXT, marginBottom: 8 } }, "Betaling geslaagd!"),
                React.createElement("div", { style: { fontSize: 13, color: SUB, lineHeight: 1.7, marginBottom: 16 } },
                    "Account wordt nu geactiveerd.",
                    React.createElement("br", null),
                    "Factuur verstuurd naar ",
                    React.createElement("strong", { style: { color: TXT } }, cardForm.email)),
                ["✓ Account geactiveerd", "✓ Factuur verstuurd", "✓ Webhook verwerkt", "✓ Modules beschikbaar"].map(function (l, i) { return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 9, padding: "8px 14px", background: GRNL, borderRadius: 8, fontSize: 12, color: GRN, fontWeight: 600, marginBottom: 6 } }, l); }),
                React.createElement("div", { style: { marginTop: 16 } },
                    React.createElement(Btn, { v: "success", lg: true, onClick: function () { setCheckout(false); setCheckStep(1); setPaid(true); toast("Welkom bij WorkFlow Pro!", "Account succesvol geactiveerd."); } }, "Naar mijn dashboard \u2192")))));
}
// ─── MAIN APP ─────────────────────────────────────────────────────────────────
var APP_CSS = "*{box-sizing:border-box;margin:0;padding:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}body{background:#F5F8FB;color:#10233F}button,input,select,textarea{font:inherit}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #8DB8FF;outline-offset:2px}::selection{background:#BFD7FF;color:#10233F}::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:#F5F8FB}::-webkit-scrollbar-thumb{background:#CAD8E6;border-radius:8px;border:2px solid #F5F8FB}@keyframes wfpSmile{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-4px) rotate(4deg)}}";
var PREVIEW_KEY = "wfp_module_previews_seen_v1";
var MODULE_PREVIEWS = {
    dashboard: { title: "Dashboard", body: "Dit is het startpunt met de belangrijkste signalen. Gebruik de kaarten om snel naar acties te springen.", steps: ["Bekijk open taken en waarschuwingen.", "Klik op KPI-kaarten om door te gaan naar de juiste module.", "Gebruik dit scherm als dagelijkse cockpit."] },
    tenants: { title: "SaaS klanten", body: "Hier beheer je klantfiches op platformniveau: plan, status, support, owner en klantnotities.", steps: ["Open een klantfiche voor accountinformatie.", "Volg billingstatus en churnsignalen op.", "Gebruik supporttoegang alleen met toestemming van de klant."] },
    platform: { title: "Platform beheer", body: "Hier beheer je SaaS-instellingen zonder code: prijzen, bundels, Stripe, support en adminrechten.", steps: ["Pas abonnementsbundels en prijszetting aan.", "Beheer Stripe- en billingbeleid.", "Stel centrale Admin-rechten in voor alle tenants."] },
    onboarding: { title: "Tenant onboarding", body: "Gebruik deze flow om een nieuwe klant van lege tenant naar werkende omgeving te begeleiden.", steps: ["Vul bedrijfsgegevens en facturatie in.", "Importeer medewerkers via CSV-preview.", "Maak de eerste planning en integraties klaar."] },
    alerts: { title: "Actiecentrum", body: "Hier komen signalen samen die opvolging vragen, zoals open approvals, syncproblemen en risico's.", steps: ["Filter op prioriteit.", "Klik door naar de bronmodule.", "Gebruik dit als dagelijkse opvolglijst."] },
    datahub: { title: "Datahub", body: "Hier exporteer je operationele en compliance-data voor rapportage, audit of migratie.", steps: ["Kies het datadomein.", "Controleer de scope.", "Exporteer alleen wat je nodig hebt."] },
    readiness: { title: "Go-live", body: "Deze cockpit toont of het platform klaar is voor verkoop en uitrol.", steps: ["Bekijk blockers per domein.", "Prioriteer P0-items.", "Gebruik de score als product owner checklist."] },
    lifecycle: { title: "Lifecycle", body: "Hier volg je trial, activatie, payment risk, churn risk en renewal per tenant.", steps: ["Bekijk waar klanten vastlopen.", "Prioriteer accounts met risico.", "Gebruik notities voor customer success opvolging."] },
    security: { title: "Security", body: "Hier beheer je security en compliance zoals MFA, GDPR, DPA, sessies en credentialbeleid.", steps: ["Controleer tenant-isolatie en rechten.", "Volg security events op.", "Gebruik auditlogs voor gevoelige acties."] },
    venues: { title: "Venues", body: "Beheer locaties, werven en operationele plaatsen waar medewerkers werken.", steps: ["Maak locaties aan per tenant.", "Koppel medewerkers aan venues.", "Gebruik venue scope in rollen en rapportages."] },
    customers: { title: "Klanten", body: "Beheer klantfiches van de tenant: contactgegevens, sector, omzetpotentieel en opvolging.", steps: ["Maak klanten aan of werk ze bij.", "Koppel werkbonnen en projecten aan klanten.", "Gebruik status en notities voor opvolging."] },
    employees: { title: "Medewerkers", body: "Hier beheer je gebruikers, rollen, venues en toegang tot onderdelen van de app.", steps: ["Maak medewerkers en vrije rollen aan.", "Controleer rechten per actie en gevoeligheid.", "Gebruik rol-preview om te zien wat iemand ziet."] },
    planning: { title: "Planning & Taken", body: "Plan medewerkers op dagen, locaties en taaktypes. Dit is de basis voor uren, werkbonnen en rapportage.", steps: ["Gebruik de weeknavigatie.", "Maak een taak aan met project en klant.", "Pas taakvelden aan per bedrijf."] },
    clock: { title: "Prikklok", body: "Medewerkers registreren hier hun start- en eindtijd op een eenvoudige manier.", steps: ["Controleer de taak van vandaag.", "Klok in bij start.", "Klok uit bij vertrek."] },
    clockings: { title: "Tijdregistraties", body: "Bekijk en analyseer geregistreerde uren per medewerker, team en periode.", steps: ["Filter op medewerker.", "Controleer afwijkingen.", "Gebruik data voor rapportage en payroll."] },
    expenses: { title: "Onkosten", body: "Registreer, controleer en keur onkosten goed met limieten en audittrail.", steps: ["Voeg kosten toe met categorie.", "Beoordeel ingediende onkosten.", "Exporteer data voor finance."] },
    workorders: { title: "Werkbonnen", body: "Werkbonnen bundelen uitgevoerde werken, foto's, materialen, klantinformatie en goedkeuring.", steps: ["Maak een werkbon aan vanuit de werf.", "Voeg materialen of foto's toe.", "Laat werkbonnen nakijken en exporteer ze."] },
    leaves: { title: "Verlof", body: "Medewerkers vragen verlof aan, admins keuren goed of af en teams zien beschikbaarheid.", steps: ["Bekijk open aanvragen.", "Controleer planning-impact.", "Keur goed of geef reden bij afwijzing."] },
    messages: { title: "Berichten", body: "Gebruik berichten voor operationele communicatie binnen de tenant.", steps: ["Stuur korte updates.", "Volg ongelezen berichten op.", "Gebruik dit voor planning- of werkboncontext."] },
    vehicles: { title: "Wagenpark", body: "Beheer voertuigen, bestuurders, onderhoud en kosten.", steps: ["Koppel voertuigen aan medewerkers.", "Volg onderhoudsdata op.", "Gebruik kosten in managementrapportage."] },
    stock: { title: "Stock", body: "Beheer voorraad, locaties, minimumstock en verbruik op werkbonnen.", steps: ["Controleer voorraadniveaus.", "Registreer verbruik.", "Volg minimumstock alerts op."] },
    rapport: { title: "Rapportages", body: "Rapportages geven managementinzicht in uren, kosten, planning, werkbonnen en marge.", steps: ["Bekijk trends per maand.", "Zoek verliesposten.", "Gebruik export voor managementoverleg."] },
    integrations: { title: "Integraties", body: "Koppel externe systemen zoals ERP, sociaal secretariaat of projectadministratie.", steps: ["Kies een integratie.", "Gebruik testmodus of sandbox waar mogelijk.", "Controleer syncstatus en logs."] },
    billing: { title: "Abonnementen", body: "Hier ziet de klant zijn abonnement. Als super admin zie je ook omzet en billingcontrole.", steps: ["Kies of wijzig een plan.", "Controleer seat-count en BTW.", "Gebruik Stripe-flow voor betaling en facturen."] },
    settings: { title: "Instellingen", body: "Hier beheert de klant tenantinstellingen zoals supporttoegang, limieten en bedrijfsinformatie.", steps: ["Controleer bedrijfsgegevens.", "Zet supporttoegang bewust aan of uit.", "Beheer operationele limieten."] },
    audit: { title: "Auditlog", body: "De auditlog toont gevoelige wijzigingen, rechtenwijzigingen en belangrijke acties.", steps: ["Filter per domein.", "Controleer oude en nieuwe waarden.", "Gebruik dit bij support en compliance."] },
};
function readSeenPreviews() {
    try {
        return JSON.parse(window.localStorage.getItem(PREVIEW_KEY) || "{}") || {};
    }
    catch (e) {
        return {};
    }
}
function writeSeenPreviews(seen) {
    try {
        window.localStorage.setItem(PREVIEW_KEY, JSON.stringify(seen));
    }
    catch (e) { }
}
function ModulePreviewOverlay(_a) {
    var preview = _a.preview, onClose = _a.onClose, onSkipAll = _a.onSkipAll;
    if (!preview)
        return null;
    var steps = (preview.steps || []).slice(0, 2);
    return React.createElement("div", { style: { position: "fixed", right: 18, bottom: 18, zIndex: 1200, width: "min(360px,calc(100vw - 36px))", background: "rgba(255,255,255,.96)", border: "1px solid ".concat(BOR), borderRadius: 8, boxShadow: SHM, overflow: "hidden", backdropFilter: "blur(10px)" } },
        React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "flex-start", padding: "13px 14px 10px" } },
            React.createElement("div", { style: { width: 28, height: 28, borderRadius: 8, background: BLUL, color: BLU, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, flexShrink: 0, fontSize: 12 } }, "i"),
            React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                React.createElement("div", { style: { fontSize: 10, color: MUT, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0, marginBottom: 3 } }, "Tip"),
                React.createElement("div", { style: { color: TXT, fontSize: 13, fontWeight: 900, marginBottom: 4 } }, preview.title),
                React.createElement("div", { style: { color: SUB, fontSize: 12, lineHeight: 1.45 } }, preview.body)),
            React.createElement("button", { onClick: onClose, title: "Sluiten", style: { width: 26, height: 26, borderRadius: 8, border: "1px solid ".concat(BOR), background: "#fff", color: SUB, cursor: "pointer", fontSize: 15, lineHeight: 1 } }, "x")),
        steps.length > 0 && React.createElement("div", { style: { padding: "0 14px 11px 52px", display: "grid", gap: 5 } }, steps.map(function (step, i) { return React.createElement("div", { key: i, style: { color: TXT, fontSize: 11, lineHeight: 1.35, display: "flex", gap: 6 } },
            React.createElement("span", { style: { color: BLU, fontWeight: 900 } }, i + 1 + "."),
            React.createElement("span", null, step)); })),
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 14px", borderTop: "1px solid ".concat(BOR), background: "#F8FBFF" } },
            React.createElement("button", { onClick: onSkipAll, style: { border: "none", background: "transparent", color: MUT, cursor: "pointer", fontSize: 11, fontWeight: 800 } }, "Niet meer tonen"),
            React.createElement("button", { onClick: onClose, style: { border: "1px solid ".concat(BLUB), background: BLUL, color: BLU, borderRadius: 8, padding: "6px 9px", cursor: "pointer", fontSize: 11, fontWeight: 900 } }, "Ok")));
}
function App() {
    var _a = useState(null), user = _a[0], setUser = _a[1];
    var _b = useState("dashboard"), page = _b[0], setPage = _b[1];
    var _c = useState(true), sidebar = _c[0], setSidebar = _c[1];
    var _d = useState([]), toasts = _d[0], setToasts = _d[1];
    var _e = useState(loadInitialData), data = _e[0], setData = _e[1];
    var _f = useState(false), serverMode = _f[0], setServerMode = _f[1];
    var _g = useState(null), modulePreview = _g[0], setModulePreview = _g[1];
    var _h = useState({ "Start": true, "Platform": true, "Klantbeheer": true, "Operaties": true, "Analyse": false, "Beheer": false }), navOpen = _h[0], setNavOpen = _h[1];
    var hydrated = useRef(false);
    var saveTimer = useRef(null);
    useEffect(function () {
        if (window.location.protocol === "file:") {
            hydrated.current = true;
            return;
        }
        fetch("/api/state")
            .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("API niet bereikbaar")); })
            .then(function (record) {
            setServerMode(true);
            if (record && record.data) {
                setData(normalizeData(record.data));
            }
            else {
                fetch("/api/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: data }) }).catch(function () { });
            }
        })
            .catch(function () { return setServerMode(false); })
            .finally(function () { hydrated.current = true; });
    }, []);
    useEffect(function () {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
        catch (e) {
            console.warn("Kon WorkFlow Pro data niet bewaren.", e);
        }
        if (!serverMode || !hydrated.current)
            return;
        if (saveTimer.current)
            clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(function () {
            fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: data }) }).catch(function (e) { return console.warn("Serveropslag tijdelijk niet bereikbaar.", e); });
        }, 350);
    }, [data, serverMode]);
    useEffect(function () {
        if (!user) {
            setModulePreview(null);
            return;
        }
        var preview = MODULE_PREVIEWS[page];
        if (!preview)
            return;
        var key = "".concat(user.role, ":").concat(page);
        var seen = readSeenPreviews();
        if (seen.__all || seen[key])
            return;
        setModulePreview(__assign(__assign({}, preview), { key: key }));
    }, [page, user && user.role]);
    var toast = useCallback(function (title, body, tp) {
        if (body === void 0) { body = ""; }
        if (tp === void 0) { tp = "ok"; }
        var id = uid();
        setToasts(function (p) { return __spreadArray(__spreadArray([], p, true), [{ id: id, title: title, body: body, tp: tp }], false); });
        setTimeout(function () { return setToasts(function (p) { return p.filter(function (t) { return t.id !== id; }); }); }, 4000);
    }, []);
    var upd = function (key, val) { return setData(function (p) {
        var _a;
        var current = p[key];
        var nextVal = typeof val === "function" ? val(current) : val;
        var next = normalizeData(__assign(__assign({}, p), (_a = {}, _a[key] = nextVal, _a)));
        if (key !== "auditLogs" && ["users", "tenants", "venues", "customers", "customRoles", "expLimits", "expenses", "workorders", "stock", "vehicles", "integrations", "platformConfig", "securityPolicy", "securityEvents"].includes(key)) {
            next.auditLogs = __spreadArray(__spreadArray([], (p.auditLogs || []), true), [{ id: "al_" + uid(), at: TODAY, time: new Date().toTimeString().slice(0, 5), actor: user ? user.name : "System", action: "Wijziging opgeslagen", area: key === "customRoles" || key === "users" ? "Rechten" : key === "tenants" ? "Tenant" : key === "expLimits" ? "Instellingen" : key, detail: "Aanpassing in ".concat(key, " bewaard"), severity: "info" }], false).slice(-100);
        }
        return next;
    }); };
    var closeModulePreview = function () {
        if (modulePreview && modulePreview.key) {
            var seen = readSeenPreviews();
            seen[modulePreview.key] = true;
            writeSeenPreviews(seen);
        }
        setModulePreview(null);
    };
    var skipAllModulePreviews = function () {
        var seen = readSeenPreviews();
        seen.__all = true;
        writeSeenPreviews(seen);
        setModulePreview(null);
        toast("Previews uitgezet", "Je krijgt geen module-intro's meer te zien.");
    };
    if (!user) {
        return React.createElement(React.Fragment, null,
            React.createElement("style", null, APP_CSS),
            React.createElement(Login, { onLogin: function (u) { setUser(u); setPage("dashboard"); } }));
    }
    var tenantAdminPolicy = getTenantAdminPolicy(data.platformConfig);
    if (user.role === "tenant_admin") {
        user = __assign(__assign({}, user), { permissions: tenantAdminPolicy.permissions || ROLE_DEFAULTS.tenant_admin, actions: tenantAdminPolicy.actions || ["view", "create", "update", "delete", "approve", "export"], scope: tenantAdminPolicy.scope || "tenant", sensitivity: tenantAdminPolicy.sensitivity || "financial" });
    }
    var isSA = user.role === "super_admin";
    var isAdm = user.role === "super_admin" || user.role === "tenant_admin";
    var isVM = user.role === "venue_manager";
    var usesAdminNav = isAdm || isVM || hasPerm(user, "employees") || hasPerm(user, "venues") || hasPerm(user, "customers") || hasPerm(user, "reports") || hasPerm(user, "billing") || hasPerm(user, "integrations");
    var NAV_SA = [
        { id: "goldenpath", icon: "G", label: "Golden path" },
        { id: "dashboard", icon: "⊞", label: "Platform" },
        { id: "tenants", icon: "🏢", label: "SaaS klanten" },
        { id: "onboarding", icon: "O", label: "Tenant onboarding" },
        { id: "rapport", icon: "📊", label: "Rapportages" },
        { id: "billing", icon: "💳", label: "Billing" },
    ];
    if (NAV_SA.every(function (x) { return x.id !== "platform"; }))
        NAV_SA.splice(2, 0, { id: "platform", icon: "P", label: "Platform beheer" });
    if (NAV_SA.every(function (x) { return x.id !== "alerts"; }))
        NAV_SA.splice(3, 0, { id: "alerts", icon: "!", label: "Actiecentrum" }, { id: "datahub", icon: "D", label: "Datahub" });
    if (NAV_SA.every(function (x) { return x.id !== "readiness"; }))
        NAV_SA.splice(3, 0, { id: "readiness", icon: "G", label: "Go-live" });
    if (NAV_SA.every(function (x) { return x.id !== "lifecycle"; }))
        NAV_SA.splice(4, 0, { id: "lifecycle", icon: "L", label: "Lifecycle" });
    if (NAV_SA.every(function (x) { return x.id !== "security"; }))
        NAV_SA.splice(5, 0, { id: "security", icon: "S", label: "Security" });
    var NAV_ADMIN = [
        { id: "goldenpath", icon: "G", label: "Golden path" },
        { id: "dashboard", icon: "⊞", label: "Dashboard" },
        { id: "venues", icon: "🏢", label: "Venues" },
        { id: "customers", icon: "K", label: "Klanten" },
        { id: "employees", icon: "👥", label: "Medewerkers" },
        { id: "planning", icon: "📅", label: "Planning & Taken" },
        { id: "clockings", icon: "📊", label: "Tijdregistraties" },
        { id: "expenses", icon: "💸", label: "Onkosten", badge: data.expenses.filter(function (e) { return e.status === "submitted"; }).length },
        { id: "workorders", icon: "📋", label: "Werkbonnen", badge: data.workorders.filter(function (w) { return !w.reviewed && w.files.length > 0; }).length },
        { id: "leaves", icon: "🏖", label: "Verlof", badge: data.leaves.filter(function (l) { return l.status === "In behandeling"; }).length },
        { id: "messages", icon: "💬", label: "Berichten", badge: data.messages.filter(function (m) { return m.to === user.id && !m.read; }).length },
        { id: "vehicles", icon: "🚗", label: "Wagenpark" },
        { id: "stock", icon: "📦", label: "Stock" },
        { id: "rapport", icon: "📈", label: "Rapportages" },
        { id: "integrations", icon: "🔗", label: "Integraties" },
        { id: "billing", icon: "💳", label: "Abonnementen" },
        { id: "settings", icon: "⚙️", label: "Instellingen" },
    ];
    if (NAV_ADMIN.every(function (x) { return x.id !== "alerts"; }))
        NAV_ADMIN.splice(1, 0, { id: "alerts", icon: "!", label: "Actiecentrum" });
    if (NAV_ADMIN.every(function (x) { return x.id !== "datahub"; }))
        NAV_ADMIN.splice(Math.max(0, NAV_ADMIN.length - 3), 0, { id: "datahub", icon: "D", label: "Datahub" });
    if (NAV_ADMIN.every(function (x) { return x.id !== "audit"; }))
        NAV_ADMIN.splice(Math.max(0, NAV_ADMIN.length - 2), 0, { id: "audit", icon: "A", label: "Auditlog" });
    var NAV_VM = [
        { id: "dashboard", icon: "⊞", label: "Dashboard" },
        { id: "planning", icon: "📅", label: "Planning & Taken" },
        { id: "clockings", icon: "📊", label: "Tijdregistraties" },
        { id: "expenses", icon: "💸", label: "Onkosten", badge: data.expenses.filter(function (e) { return e.status === "submitted" && data.venues.filter(function (v) { return (user.venueIds || []).includes(v.id); }).some(function (v) { return v.id === e.venueId; }); }).length },
        { id: "workorders", icon: "📋", label: "Werkbonnen" },
        { id: "customers", icon: "K", label: "Klanten" },
        { id: "leaves", icon: "🏖", label: "Verlof" },
        { id: "messages", icon: "💬", label: "Berichten", badge: data.messages.filter(function (m) { return m.to === user.id && !m.read; }).length },
        { id: "stock", icon: "📦", label: "Stock" },
    ];
    var NAV_EMP = __spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray([
        { id: "dashboard", icon: "⊞", label: "Dashboard" },
        { id: "clock", icon: "⏱", label: "Prikklok" },
        { id: "planning", icon: "📅", label: "Mijn Taken" }
    ], (hasPerm(user, "expenses") ? [{ id: "expenses", icon: "💸", label: "Onkosten" }] : []), true), (hasPerm(user, "workorders") ? [{ id: "workorders", icon: "📋", label: "Werkbonnen" }] : []), true), (hasPerm(user, "leaves") ? [{ id: "leaves", icon: "🏖", label: "Verlof" }] : []), true), (hasPerm(user, "messages") ? [{ id: "messages", icon: "💬", label: "Berichten", badge: data.messages.filter(function (m) { return m.to === user.id && !m.read; }).length }] : []), true), (hasPerm(user, "vehicles") ? [{ id: "vehicles", icon: "🚗", label: "Wagenpark" }] : []), true);
    var NAV = isSA ? NAV_SA : usesAdminNav ? (isVM && !isAdm ? NAV_VM : NAV_ADMIN.filter(function (item) { return item.id === "dashboard" || item.id === "goldenpath" || hasPerm(user, item.id === "rapport" ? "reports" : item.id); })) : NAV_EMP;
    var byIds = function (ids) { return ids.map(function (id) { return NAV.find(function (item) { return item.id === id; }); }).filter(Boolean); };
    var NAV_GROUPS = isSA ? [
        { title: "Start", items: byIds(["dashboard", "goldenpath", "tenants", "lifecycle", "readiness"]) },
        { title: "Platform", items: byIds(["platform", "security", "billing"]) },
        { title: "Klantactivatie", items: byIds(["onboarding", "alerts", "datahub"]) },
        { title: "Analyse", items: byIds(["rapport"]) },
    ] : usesAdminNav ? [
        { title: "Start", items: byIds(["dashboard", "goldenpath", "alerts"]) },
        { title: "Klantbeheer", items: byIds(["venues", "customers", "employees"]) },
        { title: "Operaties", items: byIds(["planning", "clockings", "expenses", "workorders", "leaves", "messages", "vehicles", "stock"]) },
        { title: "Analyse", items: byIds(["rapport", "datahub"]) },
        { title: "Beheer", items: byIds(["integrations", "billing", "settings", "audit"]) },
    ] : [
        { title: "Vandaag", items: byIds(["dashboard", "clock", "planning"]) },
        { title: "Mijn werk", items: byIds(["expenses", "workorders", "leaves", "messages", "vehicles"]) },
    ];
    var toggleNavGroup = function (title) { return setNavOpen(function (prev) {
        var _a;
        return __assign(__assign({}, prev), (_a = {}, _a[title] = !(prev[title] !== false), _a));
    }); };
    var renderNavItem = function (item, nested) {
        var active = page === item.id;
        return React.createElement("div", { key: item.id, onClick: function () { return setPage(item.id); }, title: !sidebar ? item.label : "", style: { display: "flex", alignItems: "center", gap: 9, padding: sidebar ? nested ? "8px 10px 8px 12px" : "9px 10px" : "9px", borderRadius: 8, cursor: "pointer", marginBottom: 5, background: active ? BLUL : "transparent", border: "1px solid ".concat(active ? BLUB : "transparent"), transition: "background .12s, border-color .12s", position: "relative" }, onMouseEnter: function (e) { return !active && (e.currentTarget.style.background = "#F2F7FC"); }, onMouseLeave: function (e) { return !active && (e.currentTarget.style.background = "transparent"); } },
            React.createElement("span", { style: { width: 25, height: 25, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, color: active ? BLU : SUB, background: active ? "#DCEBFF" : "#F3F7FB", lineHeight: 1 } }, item.icon),
            sidebar && React.createElement("span", { style: { fontSize: 12, fontWeight: active ? 800 : 650, color: active ? TXT : SUB, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.label),
            (item.badge || 0) > 0 && React.createElement("span", { style: { background: "#EF4444", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 9, marginLeft: sidebar ? 0 : "auto" } }, item.badge),
            active && React.createElement("div", { style: { position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 18, background: BLU, borderRadius: "3px 0 0 3px" } }));
    };
    var P = { user: user, allUsers: data.users, allShifts: data.shifts, allClocks: data.clocks,
        allExp: data.expenses, allWO: data.workorders, allLeaves: data.leaves,
        allMsgs: data.messages, venues: data.venues, customTypes: data.customTypes, customers: data.customers, toast: toast };
    var renderPage = function () {
        switch (page) {
            case "dashboard":
                if (isSA)
                    return React.createElement(DashSA, { tenants: data.tenants, go: setPage });
                if (isAdm || isVM)
                    return React.createElement(DashAdmin, __assign({}, P, { go: setPage }));
                return React.createElement(DashEmp, __assign({}, P));
            case "goldenpath": return isAdm ? React.createElement(GoldenPathPage, { user: user, tenants: data.tenants, setTenants: function (v) { return upd("tenants", v); }, allUsers: data.users, setUsers: function (v) { return upd("users", v); }, venues: data.venues, setVenues: function (v) { return upd("venues", v); }, allShifts: data.shifts, setShifts: function (v) { return upd("shifts", v); }, allWO: data.workorders, setWO: function (v) { return upd("workorders", v); }, allClocks: data.clocks, setClocks: function (v) { return upd("clocks", v); }, go: setPage, toast: toast }) : null;
            case "tenants": return isSA ? React.createElement(TenantsPage, { tenants: data.tenants, setTenants: function (v) { return upd("tenants", v); }, toast: toast }) : null;
            case "platform": return isSA ? React.createElement(PlatformOwnerPage, { platformConfig: data.platformConfig, setPlatformConfig: function (v) { return upd("platformConfig", v); }, tenants: data.tenants, setTenants: function (v) { return upd("tenants", v); }, allUsers: data.users, setUser: setUser, setPage: setPage, setAuditLogs: function (v) { return upd("auditLogs", v); }, toast: toast }) : null;
            case "readiness": return isSA ? React.createElement(ReadinessPage, { tenants: data.tenants }) : null;
            case "lifecycle": return isSA ? React.createElement(LifecyclePage, { tenants: data.tenants, go: setPage }) : null;
            case "security": return isSA ? React.createElement(SecurityPage, { policy: data.securityPolicy, setPolicy: function (v) { return upd("securityPolicy", v); }, events: data.securityEvents, tenants: data.tenants, users: data.users, auditLogs: data.auditLogs }) : null;
            case "alerts": return hasPerm(user, "alerts") ? React.createElement(AlertsPage, { user: user, allUsers: data.users, allExp: data.expenses, allLeaves: data.leaves, allWO: data.workorders, allStock: data.stock, allVehicles: data.vehicles, tenants: data.tenants, venues: data.venues, go: setPage }) : null;
            case "onboarding": return isSA ? React.createElement(OnboardingPage, { user: user, tenants: data.tenants, setTenants: function (v) { return upd("tenants", v); }, allUsers: data.users, setUsers: function (v) { return upd("users", v); }, venues: data.venues, setShifts: function (v) { return upd("shifts", v); }, toast: toast, go: setPage }) : null;
            case "venues": return hasPerm(user, "venues") ? React.createElement(VenuesPage, { user: user, venues: data.venues, setVenues: function (v) { return upd("venues", v); }, allUsers: data.users, toast: toast }) : null;
            case "customers": return hasPerm(user, "customers") ? React.createElement(CustomersPage, { user: user, customers: data.customers, setCustomers: function (v) { return upd("customers", v); }, allUsers: data.users, toast: toast }) : null;
            case "employees": return hasPerm(user, "employees") ? React.createElement(EmployeesPage, { user: user, allUsers: data.users, setUsers: function (v) { return upd("users", v); }, venues: data.venues, customRoles: data.customRoles, setCustomRoles: function (v) { return upd("customRoles", v); }, setAuditLogs: function (v) { return upd("auditLogs", v); }, adminRolePolicy: tenantAdminPolicy, toast: toast }) : null;
            case "planning": return hasPerm(user, "planning") || user.role === "employee" ? React.createElement(PlanningPage, __assign({}, P, { setShifts: function (v) { return upd("shifts", v); }, setCustomTypes: function (v) { return upd("customTypes", v); } })) : null;
            case "clock": return React.createElement(ClockPage, { user: user, allClocks: data.clocks, setClocks: function (v) { return upd("clocks", v); }, allShifts: data.shifts, customTypes: data.customTypes, toast: toast });
            case "clockings": return hasPerm(user, "clockings") ? React.createElement(ClockingsPage, __assign({}, P)) : null;
            case "expenses": return hasPerm(user, "expenses") ? React.createElement(ExpensesPage, __assign({}, P, { setExp: function (v) { return upd("expenses", v); }, vehicles: data.vehicles, expLimits: data.expLimits })) : null;
            case "workorders": return hasPerm(user, "workorders") ? React.createElement(WorkordersPage, __assign({}, P, { setWO: function (v) { return upd("workorders", v); }, allStock: data.stock, setStock: function (v) { return upd("stock", v); } })) : null;
            case "leaves": return hasPerm(user, "leaves") ? React.createElement(LeavePage, __assign({}, P, { setLeaves: function (v) { return upd("leaves", v); } })) : null;
            case "messages": return hasPerm(user, "messages") ? React.createElement(MessagesPage, __assign({}, P, { setMsgs: function (v) { return upd("messages", v); } })) : null;
            case "vehicles": return hasPerm(user, "vehicles") ? React.createElement(VehiclesPage, { user: user, allUsers: data.users, allVehicles: data.vehicles, setVehicles: function (v) { return upd("vehicles", v); }, venues: data.venues, toast: toast }) : null;
            case "stock": return hasPerm(user, "stock") ? React.createElement(StockPage, { user: user, allStock: data.stock, setStock: function (v) { return upd("stock", v); }, venues: data.venues, toast: toast }) : null;
            case "rapport": return hasPerm(user, "reports") ? React.createElement(RapportPage, { user: user, allUsers: data.users, allShifts: data.shifts, allClocks: data.clocks, allExp: data.expenses, allWO: data.workorders, allLeaves: data.leaves, venues: data.venues, customTypes: data.customTypes }) : null;
            case "datahub": return hasPerm(user, "datahub") ? React.createElement(DataHubPage, { user: user, allUsers: data.users, setUsers: function (v) { return upd("users", v); }, venues: data.venues, setVenues: function (v) { return upd("venues", v); }, allExp: data.expenses, allWO: data.workorders, allStock: data.stock, setStock: function (v) { return upd("stock", v); }, customers: data.customers, setCustomers: function (v) { return upd("customers", v); }, vehicles: data.vehicles, setVehicles: function (v) { return upd("vehicles", v); }, tenants: data.tenants, toast: toast }) : null;
            case "audit": return hasPerm(user, "audit") ? React.createElement(AuditPage, { user: user, logs: data.auditLogs }) : null;
            case "integrations": return hasPerm(user, "integrations") ? React.createElement(IntegrationsPage, { user: user, toast: toast }) : null;
            case "billing": return isSA ? React.createElement(BillingOpsPage, { tenants: data.tenants, setTenants: function (v) { return upd("tenants", v); }, toast: toast, platformConfig: data.platformConfig }) : React.createElement(BillingPage, { user: user, tenants: data.tenants, setTenants: function (v) { return upd("tenants", v); }, toast: toast, platformConfig: data.platformConfig });
            case "settings": return isAdm && hasPerm(user, "settings") ? React.createElement(SettingsPage, { user: user, tenant: data.tenants.find(function (t) { return t.id === user.tenantId; }), setTenants: function (v) { return upd("tenants", v); }, platformConfig: data.platformConfig, expLimits: data.expLimits, setExpLimits: function (v) { return upd("expLimits", v); }, toast: toast }) : null;
            default: return null;
        }
    };
    return React.createElement(React.Fragment, null,
        React.createElement("style", null, APP_CSS),
        React.createElement(Toasts, { items: toasts, rm: function (id) { return setToasts(function (p) { return p.filter(function (t) { return t.id !== id; }); }); } }),
        React.createElement(ModulePreviewOverlay, { preview: modulePreview, onClose: closeModulePreview, onSkipAll: skipAllModulePreviews }),
        React.createElement("div", { style: { display: "flex", height: "100vh", overflow: "hidden", background: BG } },
            React.createElement("aside", { style: { width: sidebar ? 248 : 72, background: "linear-gradient(180deg,#FFFFFF 0%,#F8FBFF 100%)", display: "flex", flexDirection: "column", transition: "width .2s ease", flexShrink: 0, borderRight: "1px solid ".concat(BOR), boxShadow: "8px 0 30px rgba(16,35,63,.035)" } },
                React.createElement("div", { style: { padding: sidebar ? "18px 14px 15px" : "18px 10px 15px", borderBottom: "1px solid ".concat(BOR), display: "flex", alignItems: "center", gap: 10 } },
                    React.createElement("div", { style: { width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#246BFE,#18A999)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, boxShadow: "0 12px 28px rgba(36,107,254,.22)", border: "1px solid rgba(255,255,255,.65)" } }, "\u26A1"),
                    sidebar && React.createElement("div", null,
                        React.createElement("div", { style: { fontWeight: 900, fontSize: 14, color: TXT, letterSpacing: 0 } }, "WorkFlow Pro"),
                        React.createElement("div", { style: { fontSize: 10, color: SUB, marginTop: 1 } }, isSA ? "Super Admin" : user.name.split(" ")[0]))),
                React.createElement("nav", { style: { flex: 1, overflowY: "auto", padding: "12px 8px" } }, sidebar ? NAV_GROUPS.filter(function (g) { return g.items.length; }).map(function (group) {
                    var open = navOpen[group.title] !== false;
                    var hasActive = group.items.some(function (item) { return item.id === page; });
                    return React.createElement("div", { key: group.title, style: { marginBottom: 8 } },
                        React.createElement("button", { onClick: function () { return toggleNavGroup(group.title); }, style: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: "none", background: hasActive ? "#F2F7FC" : "transparent", color: hasActive ? TXT : MUT, cursor: "pointer", borderRadius: 8, padding: "7px 8px", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0 } },
                            React.createElement("span", null, group.title),
                            React.createElement("span", { style: { fontSize: 12, color: hasActive ? BLU : MUT } }, open ? "−" : "+")),
                        open && React.createElement("div", { style: { paddingTop: 4 } }, group.items.map(function (item) { return renderNavItem(item, true); })));
                }) : NAV.map(function (item) { return renderNavItem(item, false); })),
                React.createElement("div", { style: { padding: "10px 7px 12px", borderTop: "1px solid ".concat(BOR) } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, padding: sidebar ? "7px 10px" : "7px", borderRadius: 9 } },
                        React.createElement(Av, { u: user, sz: 30 }),
                        sidebar && React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                            React.createElement("div", { style: { fontSize: 12, fontWeight: 800, color: TXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, user.name.split(" ")[0]),
                            React.createElement("div", { style: { fontSize: 10, color: SUB } }, isSA ? "⚡ Platform" : isAdm ? "🔑 Admin" : isVM ? "🏗 Werfleider" : "👤 Medewerker")),
                        sidebar && React.createElement("button", { onClick: function () { if (user.supportSession) {
                                    setUser(data.users.find(function (u) { return u.role === "super_admin"; }) || USERS[0]);
                                    setPage("platform");
                                }
                                else {
                                    setUser(null);
                                    setPage("dashboard");
                                } }, style: { background: "#F2F7FC", border: "1px solid ".concat(BOR), color: SUB, cursor: "pointer", fontSize: 15, padding: "2px 4px", borderRadius: 7 }, title: user.supportSession ? "Terug naar super admin" : "Uitloggen" }, "\u21E5")),
                    React.createElement("button", { onClick: function () { return setSidebar(function (o) { return !o; }); }, style: { width: "100%", background: "none", border: "none", color: MUT, cursor: "pointer", padding: "5px", fontSize: 12, marginTop: 3, borderRadius: 7, textAlign: "center" }, onMouseEnter: function (e) { return e.currentTarget.style.color = SUB; }, onMouseLeave: function (e) { return e.currentTarget.style.color = MUT; } }, sidebar ? "← Inklappen" : "→"))),
            React.createElement("main", { style: { flex: 1, overflowY: "auto", background: "linear-gradient(180deg,#F8FBFF 0%,#EEF5F8 100%)" } },
                React.createElement("div", { style: { maxWidth: 1240, margin: "0 auto", padding: "28px 30px 56px" } }, renderPage()))));
}
