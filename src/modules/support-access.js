// GDPR support-toegang · jaarlijkse mededeling + auto-renew.
//
// Zolang een tenant support-toegang toestaat met autoRenew, blijft die staan,
// maar de klant krijgt jaarlijks een informatieve mededeling ("staat nog steeds
// aan") via het notificatiesysteem (in-app + e-mailkanaal). De klant kan altijd
// stopzetten via Instellingen → Support-toegang. Zie [[project-support-access]].

const { createNotification } = require("./notifications");

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SYSTEM_ACTOR = { email: "system@workflowpro" };

// Stuurt de jaarlijkse mededeling voor elke tenant waarvan de review-datum is
// verstreken, en schuift de volgende review een jaar op (auto-renew).
function runSupportAccessReview(store, now = Date.now()) {
  const tenants = store.data.tenants || [];
  const notified = [];
  for (const tenant of tenants) {
    const sa = tenant.supportAccess;
    if (!sa || sa.allowed !== true) continue;
    if (sa.autoRenew === false) continue;
    if (!sa.reviewDueAt || new Date(sa.reviewDueAt).getTime() > now) continue;

    try {
      createNotification(store, tenant, {
        type: "support",
        channel: "email",
        audience: "admins",
        title: "Support-toegang staat nog steeds aan",
        body: `Je gaf toestemming voor support-toegang${sa.allowedAt ? ` (sinds ${String(sa.allowedAt).slice(0, 10)})` : ""}. Deze blijft jaarlijks automatisch actief. Wil je ze stopzetten, dan kan dat via Instellingen → Support-toegang.`,
        priority: "normal",
        sourceRef: `support-review:${tenant.id}:${String(sa.reviewDueAt).slice(0, 10)}`
      }, SYSTEM_ACTOR);
    } catch (_) { /* notificatie-fout mag de renew niet blokkeren */ }

    // Auto-renew: volgende mededeling over een jaar (vanaf nu, geen inhaal-storm).
    store.updateTenant(tenant.id, {
      supportAccess: {
        ...sa,
        reviewDueAt: new Date(now + YEAR_MS).toISOString(),
        lastReviewNoticeAt: new Date(now).toISOString()
      }
    });
    store.audit({ actor: SYSTEM_ACTOR.email, tenantId: tenant.id, action: "support_access_yearly_notice", area: "support", detail: sa.reviewDueAt });
    notified.push(tenant.id);
  }
  return { notified };
}

module.exports = { runSupportAccessReview, YEAR_MS };
