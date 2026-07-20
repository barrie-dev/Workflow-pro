// h51 scenario 3 (verdieping) + h45 mobile offline: een offline-wachtrij die
// hetzelfde commando twee keer aanbiedt (netwerk-retry) mag NIET dubbel
// toepassen en NIET het conflictpad in · herkenning op commandId, eerdere
// uitkomst terug. Echte conflicten blijven gewoon 409 met de serverstaat.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  const wo = await j("POST", `/api/tenants/${tid}/workorders`, { title: "Offline klus", date: "2026-07-20" }, tok);
  const woId = wo.data.workorder.id;
  const canon = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical`, null, tok);
  const v1 = canon.data.workorder.version;

  // ── Commando 1: normale sync ──
  const cmd1 = { baseVersion: v1, patch: { description: "Ketel nagekeken, filter vervangen" }, clientId: "toestel-7", clientUpdatedAt: "2026-07-20T09:15:00Z", commandId: "q-001" };
  const s1 = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sync`, cmd1, tok);
  check("sync met commandId toegepast", s1.status === 200 && !s1.data.replayed, s1.status);
  const vNa = s1.data.workorder.version;
  check("versie opgehoogd na toepassing", vNa > v1, `${v1} → ${vNa}`);

  // ── DUBBEL QUEUE-ITEM: exact hetzelfde commando nogmaals ──
  const s2 = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sync`, cmd1, tok);
  check("dubbel queue-item → 200 mét replay-markering (geen conflict)", s2.status === 200 && s2.data.replayed === true, JSON.stringify({ s: s2.status, r: s2.data.replayed, code: s2.data.code }));
  check("geen tweede toepassing: versie ongewijzigd", s2.data.workorder.version === vNa, s2.data.workorder.version);
  check("inhoud ongewijzigd na replay", s2.data.workorder.description === "Ketel nagekeken, filter vervangen");

  // ── Echt conflict blijft een conflict: ander commando op een oude versie ──
  const s3 = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sync`, { baseVersion: v1, patch: { description: "Andere wijziging" }, clientId: "toestel-7", commandId: "q-002" }, tok);
  check("nieuw commando op stale versie → 409 SYNC_CONFLICT", s3.status === 409 && s3.data.code === "SYNC_CONFLICT", s3.data.code);
  check("conflict draagt serverstaat + clientmutatie (nooit stil overschrijven)", !!s3.data.serverState && s3.data.clientPatch.description === "Andere wijziging");

  // ── Wachtrij verwerkt verder met de actuele versie ──
  const s4 = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sync`, { baseVersion: vNa, patch: { description: "Samengevoegd na conflict" }, clientId: "toestel-7", commandId: "q-002" }, tok);
  check("zelfde commandId na conflictresolutie werkt gewoon", s4.status === 200 && s4.data.workorder.version > vNa, s4.data.workorder.version);

  // En als dat item daarna nóg eens uit de wachtrij komt: replay, geen conflict.
  const s5 = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sync`, { baseVersion: vNa, patch: { description: "Samengevoegd na conflict" }, clientId: "toestel-7", commandId: "q-002" }, tok);
  check("herhaald verwerkt item → replay", s5.status === 200 && s5.data.replayed === true);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
