# Mayday Cloud — Status & Roadmap

This file is the in-repo memory for the stabilization effort. It travels with commits so any machine working on this project can pick up context immediately. Update it as work progresses: check off items, add new findings, adjust phases.

**Last updated:** 2026-04-18

---

## Current Focus

**Phases 1–7 complete.** All audit bugs resolved. Test system, observability, and maintenance cadence in place.

The stabilization roadmap is finished. This file remains the in-repo record. Future work should be tracked as new sections below the roadmap.

### Additional fix (2026-04-12)
- Hidden files (dotfiles) were showing in the Drive listing. Fixed `api/src/routes/nas.js` to filter all entries starting with `.` at every directory level (previously only filtered `.trash`/`.thumbs`/`.tus-staging` at root).

---

## Audit Findings (2026-04-11)

Findings from a parallel codebase audit. All items verified against actual code before listing. Severity reflects real user impact, not theoretical risk.

### Critical

- [x] **AuthContext mount race** — `web/src/contexts/AuthContext.js` — fixed in `dbdb861`. Listener is now authoritative; `getSession` is guarded by a ref so it cannot overwrite a fresh session.

- [x] **Studio SSO duplicate accounts** — `api/src/routes/auth.js` — fixed in `dbdb861`. Replaced `admin.listUsers()` with a direct `profiles` table lookup by email using `maybeSingle()`.

- [x] **Share link download endpoint ignores `used_count`** — `api/src/routes/drop.js` — fixed in `dbdb861`. Atomic optimistic-lock increment runs before streaming; directory listing is browse-only and does not consume a use.

- [x] **TUS `onSuccess` stale closure** — `web/src/pages/Drive.js` — fixed in `dbdb861`. Added a `currentPathRef` mirror and a `refreshIfViewing()` helper that only refetches if the user is still viewing the upload destination.

### High

- [x] **Service role key used for password sign-in** — `api/src/routes/auth.js` — fixed 2026-04-12. Added `SUPABASE_ANON_KEY` to api/.env; `signInWithPassword` now uses anon client. Service role reserved for admin ops only.

- [x] **TUS uploads not aborted on unmount** — `web/src/pages/Drive.js` — fixed 2026-04-12. Active uploads tracked in `activeTusUploads` ref, aborted on component unmount.

- [x] **Token expiry not refreshed in `authedFetch`** — `web/src/lib/supabase.js` — fixed 2026-04-12. Added `getFreshSession()` that auto-refreshes tokens expiring within 60s. Used by both `authedFetch` and `authedUrl`.

- [x] **TUS CORS preflight missing required headers** — `api/src/server.js` — fixed 2026-04-12. CORS now explicitly allows TUS request headers and exposes TUS response headers.

- [x] **Sync client: watcher races startup sync** — `client/src/sync-engine.js` — fixed in `40ccd2b`. `_handleAddChange` now checks if file is already synced with matching size/mtime before re-enqueuing.

- [x] **Sync client: stat-then-delete window** — `client/src/sync-engine.js`, `client/src/uploader.js` — fixed in `40ccd2b`. ENOENT caught in both the watcher handler and the upload queue. Skips with a log instead of retrying.

- [x] **Sync client: TUS resumption from stale chunk** — `client/src/api.js` — fixed in `40ccd2b`. Compares current file size against previous upload's recorded size before resuming; starts fresh if they differ.
  `findPreviousUploads()` continues from a prior byte offset without validating the file on disk matches the previous run. File replaced between runs = corrupted upload.

### Medium

- [x] **CORS wide open** — `api/src/server.js` — fixed in `4bb79bb`. Origin allow-list via `CORS_ORIGINS` env var.

- [x] **Sync client: scanner swallows errors silently** — `client/src/scanner.js` — fixed in `40ccd2b`. Permission errors and stat failures now logged as warnings with affected path.

- [ ] **Auth middleware drop-path check is fragile** — `api/src/middleware/auth.js:110` — currently safe because of mount ordering, but re-mounting the drop router would turn it into a real auth bypass. Document the coupling.

### Verified false (do not act on)

- Sync client `drain()` does NOT resolve prematurely. Correctly checks `active === 0 && queue.length === 0`.
- Auth middleware `startsWith('/drop/')` is NOT an encoded-path bypass at current mount point.

---

## Roadmap

### Phase 1 — Critical fixes ✓ COMPLETE (commit `dbdb861`)
Fix user-visible breakage and data loss. ~1 afternoon.

1. [x] AuthContext mount race
2. [x] Studio SSO duplicate accounts
3. [x] Share link download `used_count`
4. [x] TUS `onSuccess` stale closure

**Exit criteria:** signup stays logged in; Studio login for any existing user finds the right account; download share links honor `max_uses`; mid-upload navigation refreshes the correct folder.

**Deploy notes:** Web auto-deploys via Vercel. API requires `pm2 restart mayday-cloud-api` on the work machine to pick up `auth.js` and `drop.js` changes.

### Phase 2 — Latent bombs ✓ COMPLETE (2026-04-12)
Security leaks and edge cases.

5. [x] Service role key misuse
6. [x] TUS unmount cleanup
7. [x] `authedFetch` token expiry refresh
8. [x] TUS CORS preflight headers (fixes drag-drop 401)

**Exit criteria:** large drag-drop uploads succeed from `www.mayday.systems`; long-lived tabs recover after token expiry; navigating during upload leaves no console warnings.

### Phase 3 — Test system: Stage 1 + Stage 2 ✓ COMPLETE (commit `468dec3`)
Safety net before further changes.

9. [x] `api/scripts/smoke.js` — 11 endpoint tests, run via `npm run smoke`
10. [x] GitHub Actions CI — `.github/workflows/ci.yml` with 3 jobs: web build, API syntax+tests, client tests
11. [x] Vitest unit tests — 26 tests total: differ (11), scanner (7), auth/verifyToken (8)
12. [x] Tests wired into CI — runs on push to main and PRs

**Exit criteria:** every push gets a green/red signal within two minutes; Phase 1–2 fixes each have at least one test.

**Test inventory:**
- `cd api && npm test` — 8 auth middleware tests
- `cd client && npm test` — 18 differ + scanner tests
- `cd api && npm run smoke` — 11 endpoint tests (requires running server)

### Phase 4 — Sync client bugs ✓ COMPLETE (commit `40ccd2b`)
CLI stability.

13. [x] Watcher-vs-startup race — skip already-synced unchanged files
14. [x] ENOENT handling — graceful skip in both watcher and upload queue
15. [x] TUS stale resumption — validate file size before resuming
16. [x] Scanner error logging — warnings with affected paths

**Exit criteria:** sync client survives crash-resume without losing or duplicating files; permission errors are visible in the log.

### Phase 5 — Test system: Stage 3 (Playwright e2e) ✓ COMPLETE (commit `d6b5e44`)
Catch the race-condition class of bugs.

17. [x] Playwright harness — serves static build, Chromium only
18. [x] 16 e2e tests: login page (10), navigation/routing (4), drop page (2)
19. [x] CI job added (slow lane, runs after web-build, uploads failure screenshots)

**Bonus fix:** AuthContext 5-second loading timeout — app no longer hangs forever if Supabase auth init fails to resolve (network issues, etc.)

**Run locally:** `cd web && npm run build && npm run test:e2e`

**Exit criteria:** race-condition bugs are reproducibly caught by e2e, not just unit tests.

### Phase 6 — Hardening & observability ✓ COMPLETE (commit `4bb79bb`)

20. [x] CORS origin allow-list — defaults to `www.mayday.systems` + `localhost:3000`, configurable via `CORS_ORIGINS` env
21. [x] Structured API logging — JSON per request: `{ method, route, status, duration_ms, user_id }`
22. [x] React error boundary — wraps app, posts crashes to `/api/errors`, shows reload button
23. [x] `/api/admin/health` — admin-only: API, NAS, disk usage, user count, active shares, active API keys
24. [x] Weekly smoke run — `.github/workflows/weekly-smoke.yml`, Monday 9am UTC, requires `PRODUCTION_API_URL` repo variable

**Exit criteria:** production issues are visible before users report them.

**Deploy notes:** API needs `pm2 restart`. Set `CORS_ORIGINS` in `.env` if production origin differs. Set `PRODUCTION_API_URL` as a GitHub repo variable to enable the weekly smoke run.

### Phase 7 — Ongoing cadence ✓ COMPLETE (commit TBD)

25. [x] Pre-push hook — `scripts/pre-push.sh` runs API + client unit tests before push. Install: `cp scripts/pre-push.sh .git/hooks/pre-push`
26. [x] Monthly audit + test run — `.github/workflows/monthly-maintenance.yml`, 1st of every month at 10am UTC. Runs full test suite and reports outdated deps in the workflow summary.
27. [x] Dependency check — same workflow, `npm outdated` across all three packages with summary output

---

## How to Use This File

- **Before starting a Phase**, re-read the relevant section and confirm nothing has drifted since it was written. Bugs may have been fixed incidentally; new ones may have appeared.
- **When finishing an item**, check it off in the Audit Findings section and note the commit hash or date alongside it.
- **When adding a new finding**, put it in the right severity bucket and link the file:line. Don't bury it in prose.
- **When a Phase is complete**, move on to the next one. Don't jump ahead unless blocked.
- **Never delete findings** — mark them resolved with a strikethrough or checkmark so the history is preserved.
