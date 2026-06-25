"use strict";
/**
 * Geo-helpers voor locatie-geverifieerd in-/uitklokken ("coördinaten tegen
 * valsspelen"). Puur en testbaar — geen store/HTTP.
 *
 * Een werf (venue) kan een `geo: { lat, lng, radiusM }` hebben. Bij het inklokken
 * stuurt het toestel zijn positie mee; we berekenen de afstand en markeren of de
 * medewerker binnen de geofence van de werf staat.
 */

const DEFAULT_RADIUS_M = 200; // standaard geofence-straal rond een werf
const MAX_ACCURACY_M = 100;   // boven deze GPS-onnauwkeurigheid vertrouwen we de fix niet

// Haversine-afstand tussen twee coördinaten, in meters.
function distanceMeters(a, b) {
  if (!isCoord(a) || !isCoord(b)) return null;
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function isCoord(c) {
  return c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))
    && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;
}

// Normaliseer een rauwe geo-payload van een toestel naar { lat, lng, accuracy, at }.
function normalizeGeo(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.lat ?? raw.latitude);
  const lng = Number(raw.lng ?? raw.longitude);
  if (!isCoord({ lat, lng })) return null;
  const accuracy = Number(raw.accuracy);
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    at: raw.at || new Date().toISOString(),
  };
}

/**
 * Verifieer een klok-positie tegen de geofence van een werf.
 * Retourneert altijd een resultaat (ook zonder venue-geo) zodat de UI kan tonen
 * waarom er niet geverifieerd kon worden.
 */
function verifyClockGeo(geo, venue, options = {}) {
  const g = normalizeGeo(geo);
  if (!g) return { verified: false, status: "no_device_location", distanceM: null, geo: null };

  const radiusM = Number(options.radiusM || (venue && venue.geo && venue.geo.radiusM) || DEFAULT_RADIUS_M);
  const maxAccuracy = Number(options.maxAccuracyM || MAX_ACCURACY_M);
  const venueGeo = venue && venue.geo;

  if (!isCoord(venueGeo)) return { verified: false, status: "no_venue_location", distanceM: null, geo: g };
  if (g.accuracy != null && g.accuracy > maxAccuracy) {
    return { verified: false, status: "low_accuracy", distanceM: distanceMeters(g, venueGeo), radiusM, geo: g };
  }

  const distanceM = distanceMeters(g, venueGeo);
  const within = distanceM != null && distanceM <= radiusM;
  return {
    verified: within,
    status: within ? "within_fence" : "outside_fence",
    distanceM,
    radiusM,
    geo: g,
  };
}

module.exports = { distanceMeters, isCoord, normalizeGeo, verifyClockGeo, DEFAULT_RADIUS_M, MAX_ACCURACY_M };
