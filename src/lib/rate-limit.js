const buckets = new Map();
const POLICIES = {
  login: { windowMs: 60_000, limit: 10, name: "login" },
  write: { windowMs: 60_000, limit: 80, name: "write" },
  read: { windowMs: 60_000, limit: 180, name: "read" }
};

function clientId(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "local";
}

function policy(req, pathname) {
  if (!pathname.startsWith("/api/")) return null;
  if (pathname === "/api/auth/login") return POLICIES.login;
  if (req.method !== "GET") return POLICIES.write;
  return POLICIES.read;
}

function cleanExpiredBuckets(now = Date.now()) {
  for (const [bucketKey, value] of buckets.entries()) {
    if (value.resetAt <= now) buckets.delete(bucketKey);
  }
}

function checkRateLimit(req, pathname) {
  const activePolicy = policy(req, pathname);
  if (!activePolicy) return { limited: false };
  const now = Date.now();
  const key = `${clientId(req)}:${activePolicy.name}:${pathname}`;
  const current = buckets.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + activePolicy.windowMs, policy: activePolicy.name };
  bucket.count += 1;
  buckets.set(key, bucket);
  cleanExpiredBuckets(now);

  const remaining = Math.max(activePolicy.limit - bucket.count, 0);
  return {
    limited: bucket.count > activePolicy.limit,
    limit: activePolicy.limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
    policy: activePolicy.name
  };
}

function rateLimitSnapshot(now = Date.now()) {
  cleanExpiredBuckets(now);
  const policies = Object.values(POLICIES).map(row => ({
    name: row.name,
    limit: row.limit,
    windowSeconds: Math.round(row.windowMs / 1000)
  }));
  const activeBuckets = Array.from(buckets.values());
  const byPolicy = policies.reduce((acc, row) => {
    acc[row.name] = { activeBuckets: 0, currentRequests: 0, maxBucketCount: 0 };
    return acc;
  }, {});
  for (const bucket of activeBuckets) {
    const name = String(bucket.policy || "");
    if (!byPolicy[name]) byPolicy[name] = { activeBuckets: 0, currentRequests: 0, maxBucketCount: 0 };
    byPolicy[name].activeBuckets += 1;
    byPolicy[name].currentRequests += bucket.count || 0;
    byPolicy[name].maxBucketCount = Math.max(byPolicy[name].maxBucketCount, bucket.count || 0);
  }
  return {
    generatedAt: new Date(now).toISOString(),
    activeBuckets: activeBuckets.length,
    policies,
    byPolicy
  };
}

module.exports = { checkRateLimit, rateLimitSnapshot };
