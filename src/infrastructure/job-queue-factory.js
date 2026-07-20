"use strict";
/**
 * Kies de JobQueue-adapter (handover 4.6).
 *
 * Draait de opslag op PostgreSQL, dan deelt de queue dezelfde pool: jobs en
 * data leven in dezelfde database, dus reserveringen overleven een herstart en
 * werken over replicas heen. In JSON-modus (één instantie) volstaat de
 * memory-queue met identieke semantiek.
 *
 * Een Azure Service Bus-adapter implementeert later hetzelfde contract; per
 * handover is dat geen P0-verplichting.
 */

const { MemoryJobQueue } = require("./local/memory-job-queue");

function createJobQueue(storeAdapter) {
  if (storeAdapter && storeAdapter.name === "postgres" && storeAdapter.pool) {
    const { PostgresJobQueue } = require("./postgres/pg-job-queue");
    return new PostgresJobQueue(storeAdapter.pool);
  }
  return new MemoryJobQueue();
}

module.exports = { createJobQueue };
