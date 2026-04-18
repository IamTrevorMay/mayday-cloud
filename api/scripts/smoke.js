#!/usr/bin/env node
// Mayday Cloud API — smoke test
// Usage: node scripts/smoke.js [base-url]
//        SMOKE_API_URL=http://... node scripts/smoke.js

const BASE =
  process.argv[2] ||
  process.env.SMOKE_API_URL ||
  "http://localhost:4000";

const tests = [
  // ── Public (no auth) ──────────────────────────────────────
  {
    method: "GET",
    path: "/health",
    expect: 200,
    body: null,
    label: "GET /health",
  },
  {
    method: "GET",
    path: "/api/drop/nonexistent-token",
    expect: 404,
    body: null,
    label: "GET /api/drop/bad-token",
  },
  {
    method: "POST",
    path: "/api/auth/login",
    expect: 400,
    body: {},
    label: "POST /api/auth/login (empty body)",
  },
  {
    method: "POST",
    path: "/api/auth/signup",
    expect: 400,
    body: {},
    label: "POST /api/auth/signup (empty body)",
  },
  {
    method: "POST",
    path: "/api/auth/studio",
    expect: 400,
    body: {},
    label: "POST /api/auth/studio (empty body)",
  },
  {
    method: "POST",
    path: "/api/auth/login",
    expect: 401,
    body: { email: "fake@example.com", password: "wrongpassword" },
    label: "POST /api/auth/login (bad creds)",
  },

  // ── Protected (expect 401 without auth) ───────────────────
  {
    method: "GET",
    path: "/api/nas/health",
    expect: 401,
    body: null,
    label: "GET /api/nas/health (no auth)",
  },
  {
    method: "GET",
    path: "/api/nas/list",
    expect: 401,
    body: null,
    label: "GET /api/nas/list (no auth)",
  },
  {
    method: "GET",
    path: "/api/me",
    expect: 401,
    body: null,
    label: "GET /api/me (no auth)",
  },
  {
    method: "GET",
    path: "/api/shares",
    expect: 401,
    body: null,
    label: "GET /api/shares (no auth)",
  },
  {
    method: "GET",
    path: "/api/keys",
    expect: 401,
    body: null,
    label: "GET /api/keys (no auth)",
  },
];

async function run() {
  const tag = "[smoke]";
  console.log(`${tag} Mayday Cloud API smoke test`);
  console.log(`${tag} Target: ${BASE}`);
  console.log(`${tag} ${"─".repeat(35)}`);

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    const url = `${BASE}${t.path}`;
    const opts = { method: t.method };

    if (t.body !== null) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(t.body);
    }

    try {
      const res = await fetch(url, opts);

      if (res.status === t.expect) {
        console.log(`${tag} \u2713 ${t.label} \u2192 ${res.status}`);
        passed++;
      } else {
        console.log(
          `${tag} \u2717 ${t.label} \u2192 expected ${t.expect}, got ${res.status}`
        );
        failed++;
      }
    } catch (err) {
      console.log(`${tag} \u2717 ${t.label} \u2192 ${err.cause?.code || err.message}`);
      failed++;
    }
  }

  const total = passed + failed;
  console.log(`${tag} ${"─".repeat(35)}`);
  console.log(`${tag} ${passed}/${total} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
