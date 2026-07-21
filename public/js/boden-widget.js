/* ============================================================
   Mona · AI-assistent chat-widget (gedeeld over alle platforms)
   CSP-veilig: alles via addEventListener, geen inline handlers.
   Mount per platform met: window.WfpBoden.mount({ navigate })
   ============================================================ */
(function () {
  "use strict";

  const token = () => localStorage.getItem("wfp_token") || "";
  const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Minimale markdown: **vet** + nieuwe regels
  const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");

  let _navigate = null;       // platform-callback om naar een view te gaan
  let _history = [];          // {role, content}
  let _open = false;
  let _busy = false;
  let _preparedShown = false; // "Voorbereid voor jou" één keer per sessie laden

  function tenantId() {
    const u = window._wfpCurrentUser || {};
    return u.tenantId || null;
  }

  function injectStyles() {
    if (document.getElementById("bodenStyles")) return;
    const s = document.createElement("style");
    s.id = "bodenStyles";
    s.textContent = `
#bodenFab{position:fixed;right:22px;bottom:22px;z-index:9000;width:44px;height:44px;border-radius:10px;border:1px solid #111827;cursor:pointer;
  background:#111827;color:#fff;box-shadow:0 6px 18px rgba(17,24,39,.18);display:grid;place-items:center;font-size:16px;transition:transform .15s,background .15s,box-shadow .15s}
#bodenFab:hover{transform:translateY(-1px);background:#0b3cdb;border-color:#0b3cdb}
#bodenFab:focus-visible{outline:none;box-shadow:0 0 0 4px rgba(15,70,255,.15),0 6px 18px rgba(17,24,39,.18)}
#bodenPanel{position:fixed;right:22px;bottom:78px;z-index:9000;width:390px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 110px);
  background:#fff;border:1px solid #dfe3e8;border-radius:12px;box-shadow:0 20px 54px rgba(15,23,42,.18);display:none;flex-direction:column;overflow:hidden}
#bodenPanel.open{display:flex}
.boden-head{background:#fff;color:#17191f;padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid #e5e8ec}
.boden-head .av{width:32px;height:32px;border-radius:8px;background:#111827;color:#fff;display:grid;place-items:center;font-weight:720;font-size:13px}
.boden-head .nm{font-weight:650;font-size:15px;line-height:1.15}
.boden-head .sub{margin-top:2px;font-size:12px;color:#7b818b}
.boden-head .x{width:32px;height:32px;margin-left:auto;background:#fff;border:1px solid transparent;border-radius:8px;color:#747a84;font-size:20px;cursor:pointer;line-height:1}
.boden-head .x:hover{background:#f2f4f7;color:#17191f}
.boden-body{flex:1;overflow-y:auto;padding:16px;background:#f6f7f9;display:flex;flex-direction:column;gap:11px}
.boden-msg{max-width:88%;padding:10px 12px;border-radius:10px;font-size:14px;line-height:1.5;white-space:normal;word-wrap:break-word}
.boden-msg.user{align-self:flex-end;background:var(--wf-blue);color:#fff;border-bottom-right-radius:4px}
.boden-msg.bot{align-self:flex-start;background:#fff;color:var(--gray-900);border:1px solid #e0e3e8;border-bottom-left-radius:4px;box-shadow:0 2px 8px rgba(15,23,42,.035)}
.boden-prop{align-self:flex-start;max-width:94%;background:#fff;border:1px solid #dfe3e8;border-radius:10px;padding:13px 14px;font-size:13px;box-shadow:0 3px 10px rgba(15,23,42,.035)}
.boden-prop .pl{font-weight:650;color:#172033;margin-bottom:7px;font-size:14px}
.boden-prop .pp{color:var(--gray-600);font-size:12.5px;line-height:1.45;margin-bottom:10px;white-space:pre-wrap}
.boden-prop button{min-height:36px;background:var(--wf-blue);color:#fff;border:none;border-radius:9px;padding:0 13px;font-size:12.5px;font-weight:650;cursor:pointer}
.boden-prop button.sec{background:#fff;color:var(--gray-600);border:1px solid var(--gray-200);margin-left:6px}
.boden-prop .done{color:var(--wf-green);font-weight:600}
.boden-prep{align-self:flex-start;max-width:94%;background:#fff;border:1px solid #dfe3e8;border-left:3px solid var(--wf-blue);border-radius:10px;padding:12px 14px;font-size:13px;box-shadow:0 3px 10px rgba(15,23,42,.035)}
.boden-prep .pt{font-weight:650;color:#172033;font-size:14px}
.boden-prep .pw{color:var(--gray-600);font-size:12.5px;line-height:1.45;margin:5px 0 9px}
.boden-prep-step{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap}
.boden-prep-step button{min-height:34px;background:var(--wf-blue);color:#fff;border:none;border-radius:9px;padding:0 12px;font-size:12.5px;font-weight:650;cursor:pointer}
.boden-prep-step button:disabled{opacity:.5;cursor:default;background:var(--gray-200);color:var(--gray-600)}
.boden-prep-step .done{color:var(--wf-green);font-weight:600;font-size:12px}
.boden-prep-step .addon{color:var(--gray-500);font-size:11.5px;font-style:italic}
.boden-typing{align-self:flex-start;color:var(--gray-500);font-size:12.5px;font-style:italic}
.boden-foot{flex-shrink:0;border-top:1px solid #e1e4e9;padding:12px;display:flex;gap:8px;background:#fff}
.boden-foot input{flex:1;min-width:0;height:42px;border:1px solid var(--gray-200);border-radius:8px;padding:0 12px;font-size:14px;font-family:inherit;outline:none}
.boden-foot input:focus{border-color:var(--wf-blue)}
.boden-foot button{background:var(--wf-blue);color:#fff;border:none;border-radius:8px;width:42px;cursor:pointer;font-size:16px}
.boden-foot button:disabled{opacity:.5;cursor:default}
@media(max-width:560px){#bodenFab{right:14px;bottom:14px;width:42px;height:42px}#bodenPanel{inset:0 0 68px;width:auto;height:auto;max-width:none;max-height:none;border-radius:0}.boden-body{padding:13px}.boden-msg{max-width:92%}}`;
    document.head.appendChild(s);
  }

  function buildShell() {
    if (document.getElementById("bodenFab")) return;
    const fab = document.createElement("button");
    fab.id = "bodenFab"; fab.title = "Mona openen"; fab.setAttribute("aria-label", "Open Mona assistent"); fab.setAttribute("aria-controls", "bodenPanel"); fab.setAttribute("aria-expanded", "false"); fab.innerHTML = '<span style="font-size:14px;font-weight:720;letter-spacing:-.04em">M</span>';
    fab.addEventListener("click", toggle);
    document.body.appendChild(fab);

    const panel = document.createElement("div");
    panel.id = "bodenPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Mona slimme assistent");
    panel.innerHTML = `
      <div class="boden-head">
        <div class="av">M</div>
        <div><div class="nm">Mona</div><div class="sub">Assistent</div></div>
        <button class="x" id="bodenClose" title="Sluiten">×</button>
      </div>
      <div class="boden-body" id="bodenBody"></div>
      <div class="boden-foot">
        <input id="bodenInput" type="text" placeholder="Stel een vraag…" autocomplete="off">
        <button id="bodenSend" title="Versturen"><svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
      </div>`;
    document.body.appendChild(panel);
    document.getElementById("bodenClose").addEventListener("click", toggle);
    document.getElementById("bodenSend").addEventListener("click", send);
    document.getElementById("bodenInput").addEventListener("keydown", e => { if (e.key === "Enter") send(); });

    if (!_history.length) {
      addBot("Hoi! Ik ben **Mona**, je slimme assistent. Vraag me iets over je planning, werkbonnen, klanten of facturen. Ik help binnen jouw rechten.");
    }
  }

  function toggle() {
    _open = !_open;
    const p = document.getElementById("bodenPanel");
    if (p) p.classList.toggle("open", _open);
    document.getElementById("bodenFab")?.setAttribute("aria-expanded", String(_open));
    if (_open) {
      setTimeout(() => document.getElementById("bodenInput")?.focus(), 50);
      if (!_preparedShown) { _preparedShown = true; loadPrepared(); }
    }
  }

  // ── "Voorbereid voor jou" (Mona Prepare · h48) ─────────────────────────────
  // Proactief: bij het openen toont Mona wat ze al heeft klaargezet. Elke
  // actiestap hergebruikt de bestaande bevestig-flow (confirmProposal).
  async function loadPrepared() {
    let d;
    try {
      const r = await fetch(`/api/tenants/${tenantId()}/mona/prepared`, {
        headers: { Authorization: "Bearer " + token() },
      });
      d = await r.json();
      if (!r.ok || !d.plans || !d.plans.length) return;
    } catch (e) { return; }

    const intro = document.createElement("div");
    intro.className = "boden-msg bot";
    intro.innerHTML = fmt(`**Voorbereid voor jou** · ${d.plans.length} ding(en) staan klaar om te bevestigen:`);
    bodyEl().appendChild(intro);

    for (const plan of d.plans.slice(0, 6)) {
      const card = document.createElement("div");
      card.className = "boden-prep";
      card.innerHTML = `<div class="pt">${esc(plan.title)}</div><div class="pw">${esc(plan.why || "")}</div>`;
      for (const step of (plan.steps || [])) {
        const prop = {
          action: step.action, label: step.label, params: step.params || {},
          method: step.endpoint && step.endpoint.method, path: step.endpoint && step.endpoint.path,
        };
        const row = document.createElement("div");
        row.className = "boden-prep-step";
        const btn = document.createElement("button");
        const status = document.createElement("span");
        if (step.action === "navigate") {
          btn.textContent = step.label || "Ga ernaartoe";
          btn.addEventListener("click", () => confirmProposal(prop, btn, status));
        } else if (step.needsAddon) {
          // Uitvoeren vereist de AI-acties-add-on · eerlijk tonen i.p.v. te doen alsof.
          btn.textContent = step.label; btn.disabled = true;
          status.className = "addon"; status.textContent = "AI-acties-add-on nodig";
        } else {
          btn.textContent = step.label;
          btn.addEventListener("click", () => confirmProposal(prop, btn, status));
        }
        row.appendChild(btn); row.appendChild(status);
        card.appendChild(row);
      }
      bodyEl().appendChild(card);
    }
    scroll();
  }

  function bodyEl() { return document.getElementById("bodenBody"); }
  function scroll() { const b = bodyEl(); if (b) b.scrollTop = b.scrollHeight; }

  function addMsg(role, html) {
    const b = bodyEl(); if (!b) return;
    const d = document.createElement("div");
    d.className = "boden-msg " + (role === "user" ? "user" : "bot");
    d.innerHTML = html;
    b.appendChild(d); scroll();
  }
  function addUser(text) { addMsg("user", esc(text)); }
  function addBot(text) { addMsg("bot", fmt(text)); }

  function addProposal(p) {
    const b = bodyEl(); if (!b) return;
    const wrap = document.createElement("div");
    wrap.className = "boden-prop";
    const paramTxt = Object.entries(p.params || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
    wrap.innerHTML = `<div class="pl">${esc(p.label)}</div>${paramTxt ? `<div class="pp">${esc(paramTxt)}</div>` : ""}`;
    const btn = document.createElement("button");
    btn.textContent = p.action === "navigate" ? "Ga ernaartoe" : "Bevestigen";
    const status = document.createElement("span");
    btn.addEventListener("click", () => confirmProposal(p, btn, status));
    wrap.appendChild(btn); wrap.appendChild(status);
    b.appendChild(wrap); scroll();
  }

  async function confirmProposal(p, btn, status) {
    if (p.action === "navigate") {
      const view = (p.params && p.params.view) || "";
      if (_navigate && view) { _navigate(view); toggle(); }
      return;
    }
    if (!p.path) return;
    btn.disabled = true; btn.textContent = "Bezig…";
    try {
      const r = await fetch(`/api/tenants/${tenantId()}/${p.path}`, {
        method: p.method || "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
        body: JSON.stringify(p.params || {}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Mislukt");
      btn.remove();
      status.className = "done"; status.textContent = "Uitgevoerd";
    } catch (e) {
      btn.disabled = false; btn.textContent = "Opnieuw";
      status.style.color = "var(--wf-red)"; status.textContent = " " + e.message;
    }
  }

  async function send() {
    const input = document.getElementById("bodenInput");
    if (!input || _busy) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addUser(text);
    _history.push({ role: "user", content: text });
    _busy = true;
    document.getElementById("bodenSend").disabled = true;

    const typing = document.createElement("div");
    typing.className = "boden-typing"; typing.textContent = "Mona denkt na…";
    bodyEl().appendChild(typing); scroll();

    try {
      const r = await fetch(`/api/tenants/${tenantId()}/boden`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
        body: JSON.stringify({ messages: _history.slice(-12) }),
      });
      const d = await r.json();
      typing.remove();
      if (!r.ok) { addBot("Sorry, er ging iets mis: " + (d.error || r.status)); }
      else {
        addBot(d.reply || "…");
        _history.push({ role: "assistant", content: d.reply || "" });
        (d.proposals || []).forEach(addProposal);
      }
    } catch (e) {
      typing.remove();
      addBot("Sorry, ik kon de assistent niet bereiken.");
    } finally {
      _busy = false;
      const sb = document.getElementById("bodenSend"); if (sb) sb.disabled = false;
    }
  }

  // Publieke API
  window.WfpBoden = {
    mount({ navigate } = {}) {
      _navigate = navigate || null;
      if (!tenantId()) return; // Boden is tenant-gebonden; niet voor super-admin
      injectStyles();
      buildShell();
    },
    unmount() {
      document.getElementById("bodenFab")?.remove();
      document.getElementById("bodenPanel")?.remove();
      _open = false;
    },
  };
})();
