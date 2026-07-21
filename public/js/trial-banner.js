/* ============================================================
   Trial-to-paid conversietrechter · in-app banner (GTM sprint 1)
   Zelfstandig + CSP-veilig (geen inline handlers). Leest de billing-
   status uit /api/me en toont de admin een discrete proef-strip met een
   upgrade-CTA. Escaleert naar een niet-wegklikbare balk zodra de proef
   (na respijt) verloopt · de echte schrijf-blokkade zit server-side (402).
   Alleen voor tenant_admin: billing is een beheerderstaak.
   ============================================================ */
(function () {
  "use strict";

  const token = () => localStorage.getItem("wfp_token") || "";
  const T = (key, fallback) => (window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback);
  const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Welke toestanden verdienen aandacht (active/trial_open tonen niets).
  function copyFor(b) {
    if (!b) return null;
    if (b.state === "trial") {
      const d = b.daysLeft;
      const urgent = d <= 3;
      return {
        tone: urgent ? "warn" : "info",
        dismissible: true,
        key: `trial:${d}`,
        text: d === 1
          ? T("trial.banner.lastDay", "Je proefperiode eindigt morgen.")
          : T("trial.banner.daysLeft", "Nog {d} dagen in je proefperiode.").replace("{d}", d),
        cta: T("trial.banner.choosePlan", "Kies een abonnement"),
      };
    }
    if (b.state === "grace") {
      return {
        tone: "warn",
        dismissible: false,
        key: "grace",
        text: T("trial.banner.grace", "Je proefperiode is afgelopen · nog {d} dag(en) volledige toegang.").replace("{d}", b.graceDaysLeft),
        cta: T("trial.banner.choosePlan", "Kies een abonnement"),
      };
    }
    if (b.state === "expired") {
      return {
        tone: "block",
        dismissible: false,
        key: "expired",
        text: T("trial.banner.expired", "Je proefperiode is voorbij. Je gegevens blijven bewaard; kies een abonnement om weer te bewerken."),
        cta: T("trial.banner.reactivate", "Abonnement kiezen"),
      };
    }
    return null;
  }

  function injectStyles() {
    if (document.getElementById("wfpTrialStyles")) return;
    const s = document.createElement("style");
    s.id = "wfpTrialStyles";
    s.textContent = `
#wfpTrialBanner{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;z-index:8800;
  max-width:min(680px,calc(100vw - 130px));width:max-content;display:flex;align-items:center;gap:14px;
  padding:12px 14px 12px 16px;border-radius:14px;background:#fff;color:#0B1320;
  box-shadow:0 10px 30px rgba(11,19,32,.16);border:1px solid #E6EAF0;border-left:4px solid #0071E3;
  font:500 14px/1.35 Inter,system-ui,sans-serif}
#wfpTrialBanner.warn{border-left-color:#B45309}
#wfpTrialBanner.block{border-left-color:#B42318}
#wfpTrialBanner .wfpTrialText{flex:1;min-width:0}
#wfpTrialBanner .wfpTrialCta{flex:none;border:none;cursor:pointer;border-radius:10px;
  padding:9px 14px;background:#0071E3;color:#fff;font:600 13px Inter,system-ui,sans-serif;white-space:nowrap}
#wfpTrialBanner .wfpTrialCta:hover{background:#0063c7}
#wfpTrialBanner .wfpTrialClose{flex:none;border:none;background:transparent;cursor:pointer;
  color:#6B7688;font-size:18px;line-height:1;padding:2px 4px}
@media (max-width:560px){#wfpTrialBanner{left:12px;right:12px;transform:none;max-width:none;width:auto;flex-wrap:wrap}}`;
    document.head.appendChild(s);
  }

  function gotoBilling() {
    const nav = document.querySelector('[data-view="billing"]');
    if (nav) { nav.click(); return; }
    // Val terug op de instellingen-knop of laat de balk staan.
    const alt = document.getElementById("admSettingsToBilling");
    if (alt) alt.click();
  }

  function render(copy) {
    let el = document.getElementById("wfpTrialBanner");
    if (!copy) { if (el) el.remove(); return; }
    if (sessionStorage.getItem("wfpTrialDismiss") === copy.key && copy.dismissible) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = "wfpTrialBanner";
      document.body.appendChild(el);
    }
    el.className = copy.tone;
    el.innerHTML =
      `<span class="wfpTrialText">${esc(copy.text)}</span>` +
      `<button type="button" class="wfpTrialCta">${esc(copy.cta)}</button>` +
      (copy.dismissible ? `<button type="button" class="wfpTrialClose" aria-label="Sluiten">&times;</button>` : "");
    el.querySelector(".wfpTrialCta").addEventListener("click", gotoBilling);
    const close = el.querySelector(".wfpTrialClose");
    if (close) close.addEventListener("click", () => { sessionStorage.setItem("wfpTrialDismiss", copy.key); el.remove(); });
  }

  async function refresh() {
    const tok = token();
    if (!tok) { render(null); return; }
    try {
      const me = await fetch("/api/me", { headers: { Authorization: "Bearer " + tok } }).then(r => r.ok ? r.json() : null);
      if (!me || !me.ok || !me.user || me.user.role !== "tenant_admin") { render(null); return; }
      injectStyles();
      render(copyFor(me.billing));
    } catch (_) { /* stil: de banner is best-effort */ }
  }

  // Publiek: platforms kunnen na een login/status-wijziging verversen.
  window.WfpTrialBanner = { refresh };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh);
  else refresh();
})();
