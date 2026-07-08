/* ============================================================
   Boden · AI-assistent chat-widget (gedeeld over alle platforms)
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

  function tenantId() {
    const u = window._wfpCurrentUser || {};
    return u.tenantId || null;
  }

  function injectStyles() {
    if (document.getElementById("bodenStyles")) return;
    const s = document.createElement("style");
    s.id = "bodenStyles";
    s.textContent = `
#bodenFab{position:fixed;right:20px;bottom:20px;z-index:9000;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;
  background:var(--wf-blue);color:#fff;box-shadow:0 6px 20px rgba(30,107,230,.45);display:grid;place-items:center;font-size:24px;transition:transform .15s,background .15s}
#bodenFab:hover{transform:scale(1.06);background:var(--wf-blue-d)}
#bodenPanel{position:fixed;right:20px;bottom:88px;z-index:9000;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);
  background:#fff;border:1px solid var(--gray-200);border-radius:16px;box-shadow:0 18px 50px rgba(15,23,42,.25);display:none;flex-direction:column;overflow:hidden}
#bodenPanel.open{display:flex}
.boden-head{background:var(--wf-navy);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.boden-head .av{width:32px;height:32px;border-radius:50%;background:var(--wf-blue);display:grid;place-items:center;font-weight:700;font-size:14px}
.boden-head .nm{font-weight:600;font-size:14px;line-height:1.1}
.boden-head .sub{font-size:11px;color:var(--wf-sidebar-dim)}
.boden-head .x{margin-left:auto;background:none;border:none;color:var(--wf-sidebar-dim);font-size:20px;cursor:pointer;line-height:1}
.boden-body{flex:1;overflow-y:auto;padding:14px;background:var(--gray-50);display:flex;flex-direction:column;gap:10px}
.boden-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.45;white-space:normal;word-wrap:break-word}
.boden-msg.user{align-self:flex-end;background:var(--wf-blue);color:#fff;border-bottom-right-radius:4px}
.boden-msg.bot{align-self:flex-start;background:#fff;color:var(--gray-900);border:1px solid var(--gray-200);border-bottom-left-radius:4px}
.boden-prop{align-self:flex-start;max-width:90%;background:#fff;border:1px solid var(--wf-blue-l);border-radius:12px;padding:10px 12px;font-size:12.5px}
.boden-prop .pl{font-weight:600;color:var(--wf-navy);margin-bottom:6px}
.boden-prop .pp{color:var(--gray-600);font-size:12px;margin-bottom:8px;white-space:pre-wrap}
.boden-prop button{background:var(--wf-orange);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
.boden-prop button.sec{background:#fff;color:var(--gray-600);border:1px solid var(--gray-200);margin-left:6px}
.boden-prop .done{color:var(--wf-green);font-weight:600}
.boden-typing{align-self:flex-start;color:var(--gray-400);font-size:12px;font-style:italic}
.boden-foot{flex-shrink:0;border-top:1px solid var(--gray-200);padding:10px;display:flex;gap:8px;background:#fff}
.boden-foot input{flex:1;border:1.5px solid var(--gray-200);border-radius:10px;padding:9px 12px;font-size:13px;font-family:inherit;outline:none}
.boden-foot input:focus{border-color:var(--wf-blue)}
.boden-foot button{background:var(--wf-blue);color:#fff;border:none;border-radius:10px;width:40px;cursor:pointer;font-size:16px}
.boden-foot button:disabled{opacity:.5;cursor:default}`;
    document.head.appendChild(s);
  }

  function buildShell() {
    if (document.getElementById("bodenFab")) return;
    const fab = document.createElement("button");
    fab.id = "bodenFab"; fab.title = "Boden · AI-assistent"; fab.innerHTML = '<svg viewBox="0 0 24 24" style="width:26px;height:26px;fill:currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    fab.addEventListener("click", toggle);
    document.body.appendChild(fab);

    const panel = document.createElement("div");
    panel.id = "bodenPanel";
    panel.innerHTML = `
      <div class="boden-head">
        <div class="av">B</div>
        <div><div class="nm">Boden</div><div class="sub">Je AI-assistent</div></div>
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
      addBot("Hoi! Ik ben **Boden**, je assistent. Vraag me iets over je planning, werkbonnen, klanten, facturen… Ik help binnen jouw rechten.");
    }
  }

  function toggle() {
    _open = !_open;
    const p = document.getElementById("bodenPanel");
    if (p) p.classList.toggle("open", _open);
    if (_open) setTimeout(() => document.getElementById("bodenInput")?.focus(), 50);
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
    typing.className = "boden-typing"; typing.textContent = "Boden denkt na…";
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
