"use strict";
/**
 * Monargo One — herbruikbare tabel-tools: sorteren + filteren.
 *
 * Progressive enhancement op álle hoofdtabellen (.adm-table / .mgr-table /
 * .sa-tbl) zonder de render-functies aan te passen:
 *  - Klik op een kolomkop → sorteer (toggle oplopend/aflopend). Type wordt
 *    automatisch herkend: datum (dd/mm/jjjj of jjjj-mm-dd), getal/bedrag, tekst.
 *  - Boven elke tabel met genoeg rijen verschijnt een filterveld dat rijen
 *    live verbergt op basis van vrije tekst.
 *
 * Werkt ook op dynamisch (her)gerenderde tabellen via een MutationObserver;
 * sorteren zelf loopt via event-delegatie, dus dat geldt sowieso overal.
 */
(function () {
  if (window.__monargoTableTools) return;
  window.__monargoTableTools = true;

  var SEL = "table.adm-table, table.mgr-table, table.sa-tbl";
  var MIN_ROWS_FOR_FILTER = 6;

  var css = ""
    + SEL.split(",").map(function (s) { return s + " thead th"; }).join(",")
    + "{cursor:pointer;user-select:none;white-space:nowrap;}"
    + SEL.split(",").map(function (s) { return s + " thead th:hover"; }).join(",")
    + "{color:var(--wf-blue);}"
    + ".tt-arrow{font-size:9px;opacity:.7;margin-left:4px;}"
    + ".tt-filter-wrap{display:flex;justify-content:flex-end;margin:0 0 10px;}"
    + ".tt-filter{height:34px;width:100%;max-width:240px;padding:0 12px 0 32px;border:1px solid var(--line,#e5e5ea);"
    + "border-radius:980px;font-size:13px;color:var(--ink,#1d1d1f);background:var(--surface,#fff) "
    + "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239ca3af'%3E%3Cpath d='M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z'/%3E%3C/svg%3E\") no-repeat 9px center;"
    + "background-size:15px;outline:none;font-family:inherit;transition:border-color .15s, box-shadow .15s;}"
    + ".tt-filter:focus{border-color:var(--wf-blue);box-shadow:0 0 0 3px rgba(0,113,227,.15);}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  // ── Waarde-parsing voor slim sorteren ─────────────────────────────────────
  function parseVal(raw) {
    var s = (raw || "").trim();
    if (!s) return { d: NaN, n: NaN, s: "" };
    var tm = s.match(/\b(\d{1,2}):(\d{2})\b/);                        // optionele tijd HH:MM
    var hh = tm ? +tm[1] : 0, mm = tm ? +tm[2] : 0;
    var m = s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);      // dd/mm/jjjj
    if (m) return { d: new Date(+m[3], +m[2] - 1, +m[1], hh, mm).getTime(), n: NaN, s: s };
    m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);                       // jjjj-mm-dd
    if (m) return { d: new Date(+m[1], +m[2] - 1, +m[3], hh, mm).getTime(), n: NaN, s: s };
    if (tm && !/\d{4}/.test(s)) return { d: NaN, n: hh * 60 + mm, s: s }; // alleen tijd → minuten
    if (/\d/.test(s)) {
      // getal/bedrag: strip valuta/spaties, NL-duizendpunten weg, komma → punt
      var num = parseFloat(s.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
      if (!isNaN(num)) return { d: NaN, n: num, s: s };
    }
    return { d: NaN, n: NaN, s: s.toLowerCase() };
  }

  function sortTable(table, idx, th) {
    var tbody = table.tBodies[0]; if (!tbody) return;
    var headCount = th.parentNode.children.length;
    var rows = [].slice.call(tbody.rows).filter(function (r) {
      return r.children.length === headCount && !r.querySelector("[colspan]");
    });
    if (rows.length < 2) return;
    var dir = th.getAttribute("data-sort-dir") === "asc" ? "desc" : "asc";
    var thead = th.closest("thead");
    thead.querySelectorAll("th").forEach(function (h) {
      h.removeAttribute("data-sort-dir");
      var a = h.querySelector(".tt-arrow"); if (a) a.remove();
    });
    th.setAttribute("data-sort-dir", dir);
    var arrow = document.createElement("span");
    arrow.className = "tt-arrow"; arrow.textContent = dir === "asc" ? "▲" : "▼";
    th.appendChild(arrow);
    var mul = dir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      var A = parseVal(a.children[idx] && a.children[idx].textContent);
      var B = parseVal(b.children[idx] && b.children[idx].textContent);
      if (!isNaN(A.d) || !isNaN(B.d)) return (((isNaN(A.d) ? 0 : A.d)) - ((isNaN(B.d) ? 0 : B.d))) * mul;
      if (!isNaN(A.n) || !isNaN(B.n)) return (((isNaN(A.n) ? 0 : A.n)) - ((isNaN(B.n) ? 0 : B.n))) * mul;
      return (A.s < B.s ? -1 : A.s > B.s ? 1 : 0) * mul;
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
  }

  document.addEventListener("click", function (e) {
    var th = e.target.closest("th"); if (!th) return;
    var table = th.closest(SEL); if (!table || !th.closest("thead")) return;
    var idx = [].indexOf.call(th.parentNode.children, th);
    sortTable(table, idx, th);
  });

  // ── Filterveld boven elke (voldoende grote) tabel ─────────────────────────
  function enhanceFilter(table) {
    var tbody = table.tBodies[0]; if (!tbody) return;
    // Stale filter van een vorige render vlak vóór deze tabel opruimen
    var prev = table.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains("tt-filter-wrap")) prev.remove();
    if (tbody.rows.length < MIN_ROWS_FOR_FILTER) return;
    if (table.getAttribute("data-tt") === "1" && table.previousElementSibling &&
        table.previousElementSibling.classList.contains("tt-filter-wrap")) return;
    table.setAttribute("data-tt", "1");
    var wrap = document.createElement("div"); wrap.className = "tt-filter-wrap";
    var inp = document.createElement("input");
    inp.type = "search"; inp.className = "tt-filter"; inp.placeholder = "Filter…";
    inp.setAttribute("aria-label", "Filter tabel");
    wrap.appendChild(inp);
    table.parentNode.insertBefore(wrap, table);
    inp.addEventListener("input", function () {
      var q = inp.value.toLowerCase().trim();
      [].slice.call(tbody.rows).forEach(function (r) {
        if (r.querySelector("[colspan]")) return;
        r.style.display = (!q || r.textContent.toLowerCase().indexOf(q) !== -1) ? "" : "none";
      });
    });
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(SEL)) enhanceFilter(root);
    root.querySelectorAll(SEL).forEach(enhanceFilter);
  }

  var obs = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) scan(added[j]);
    }
  });
  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true });
    scan(document.body);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      obs.observe(document.body, { childList: true, subtree: true });
      scan(document.body);
    });
  }
})();
