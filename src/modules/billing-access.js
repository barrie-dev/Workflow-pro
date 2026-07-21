"use strict";

// ── Trial-to-paid conversietrechter ─────────────────────────────────────────
// Eén bron van waarheid voor "mag deze tenant nog schrijven, en wat tonen we
// de gebruiker?". De registratieflow zet status "trial" + trialEndsAt; Stripe
// (of de mock) zet status "active"/"paid" bij conversie. Deze module leidt uit
// die twee velden een leesbare toestand af, plus een harde schrijf-gate zodra
// de proef definitief voorbij is.
//
// Ontwerpkeuzes (bewust minst-bestraffend, best voor conversie):
//  * Een tenant zonder trialEndsAt wordt NOOIT geblokkeerd. Zaai-/pilot-tenants
//    (zoals de demo) hebben geen deadline en blijven onaangeroerd.
//  * Na de proef volgt eerst een respijtperiode (grace): alles blijft werken,
//    maar de banner wordt dringend. Pas ná de grace blokkeren we schrijven -
//    nooit lezen. Niemand wordt ooit uit z'n eigen data gesloten.
//  * Betalen kan altijd: de billing/subscription-routes blijven schrijfbaar,
//    ook tijdens een geblokkeerde proef, zodat upgraden nooit vastloopt.

const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAID_STATUSES = ["active", "paid"];
// Pre-expiry herinneringen op deze resterende dagen (dalend).
const NUDGE_DAYS = [7, 3, 1];

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// Kernafleiding. `now` is injecteerbaar zodat tests deterministisch zijn.
function billingAccess(tenant, now = new Date()) {
  const t = tenant || {};
  const status = String(t.status || "trial");
  const converted = PAID_STATUSES.includes(status);

  // Betalend: volledige toegang, geen banner.
  if (converted) {
    return {
      state: "active", status, converted: true, writeBlocked: false,
      trialEndsAt: t.trialEndsAt || null, daysLeft: null, graceDaysLeft: null,
      graceEndsAt: null, expired: false, inGrace: false, plan: t.plan || null,
    };
  }

  const end = parseDate(t.trialEndsAt);

  // Geen deadline (zaai-/pilot-/gegrandfatherde tenant): nooit geblokkeerd.
  if (!end) {
    return {
      state: status === "trial" ? "trial_open" : status, status, converted: false,
      writeBlocked: false, trialEndsAt: null, daysLeft: null, graceDaysLeft: null,
      graceEndsAt: null, expired: false, inGrace: false, plan: t.plan || null,
    };
  }

  const nowMs = now.getTime();
  const endMs = end.getTime();
  const graceEndMs = endMs + GRACE_DAYS * DAY_MS;
  const expired = nowMs >= endMs;
  const pastGrace = nowMs >= graceEndMs;
  const inGrace = expired && !pastGrace;

  // "Dagen over" naar boven afgerond: op de laatste dag toont dit nog "1 dag".
  const daysLeft = expired ? 0 : Math.max(1, Math.ceil((endMs - nowMs) / DAY_MS));
  const graceDaysLeft = inGrace ? Math.max(1, Math.ceil((graceEndMs - nowMs) / DAY_MS)) : (pastGrace ? 0 : null);

  let state;
  if (!expired) state = "trial";
  else if (inGrace) state = "grace";
  else state = "expired";

  return {
    state, status, converted: false,
    writeBlocked: pastGrace,
    trialEndsAt: t.trialEndsAt,
    daysLeft, graceDaysLeft,
    graceEndsAt: new Date(graceEndMs).toISOString(),
    expired, inGrace, plan: t.plan || null,
  };
}

// Bepaalt welke herinnering vandaag past (of null). Elke mijlpaal vuurt één
// keer; de aanroeper dedupliceert op sourceRef `trial:nudge:<stage>`.
function trialNudge(tenant, now = new Date()) {
  const a = billingAccess(tenant, now);
  if (a.converted) return null;

  if (a.state === "trial") {
    if (!NUDGE_DAYS.includes(a.daysLeft)) return null;
    return {
      stage: `d${a.daysLeft}`,
      title: a.daysLeft === 1 ? "Je proefperiode eindigt morgen" : `Nog ${a.daysLeft} dagen in je proefperiode`,
      body: `Je proefperiode van Monargo One loopt af over ${a.daysLeft} dag(en). Kies een abonnement om zonder onderbreking verder te werken.`,
    };
  }
  if (a.state === "grace") {
    return {
      stage: "expired",
      title: "Je proefperiode is afgelopen",
      body: `Je proefperiode is voorbij. Je hebt nog ${a.graceDaysLeft} dag(en) volledige toegang; kies daarna een abonnement om te blijven werken.`,
    };
  }
  if (a.state === "expired") {
    return {
      stage: "blocked",
      title: "Kies een abonnement om verder te werken",
      body: "Je proefperiode en respijtperiode zijn voorbij. Je gegevens blijven bewaard en zichtbaar; kies een abonnement om weer te kunnen bewerken.",
    };
  }
  return null;
}

module.exports = { billingAccess, trialNudge, GRACE_DAYS, NUDGE_DAYS };
