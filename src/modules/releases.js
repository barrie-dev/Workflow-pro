const { config } = require("../lib/config");

const RELEASE_NOTES = [
  {
    version: "0.8.0",
    date: "2026-04-29",
    title: "Billing controls",
    changes: ["Seat counting", "Pricing quote", "Contract state machine", "Dunning flow"]
  },
  {
    version: "0.7.0",
    date: "2026-04-29",
    title: "Admin hardening",
    changes: ["Rate limiting", "Foutregistratie", "Supporttoegang met consent", "Super-admin tenantbeheer", "Backup restore"]
  },
  {
    version: "0.6.0",
    date: "2026-04-29",
    title: "Core operations",
    changes: ["CSV medewerkersimport", "Rollen en rechten", "Managementrapportage", "Onkostenapproval", "API keys"]
  },
  {
    version: "0.5.0",
    date: "2026-04-28",
    title: "Mobile pilot flow",
    changes: ["PWA", "Mobile Today", "Foto upload metadata", "Handtekening", "Offline queue basis"]
  }
];

function releaseInfo() {
  return {
    version: config.appVersion,
    channel: config.releaseChannel,
    commitSha: config.commitSha,
    releasedAt: RELEASE_NOTES[0].date,
    latest: RELEASE_NOTES[0],
    notes: RELEASE_NOTES
  };
}

module.exports = { RELEASE_NOTES, releaseInfo };
