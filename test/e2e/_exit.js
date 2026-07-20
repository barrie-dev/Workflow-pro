"use strict";
// Zachte exit voor smokes: laat de event-loop leeglopen in plaats van hard te
// stoppen. Een hard process.exit racet op Windows met sluitende keep-alive-
// sockets van fetch en crasht dan in libuv (win/async.c) NA het SMOKE-verdict,
// waardoor een geslaagde smoke toch als gefaald telt. Idle fetch-sockets zijn
// unref'ed, dus normaal eindigt het proces binnen enkele ms vanzelf; de
// unref'ede timer is het vangnet als iets (bv. een niet-gesloten testserver)
// de loop toch openhoudt.
module.exports = function exitSoft(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 3000).unref();
};
