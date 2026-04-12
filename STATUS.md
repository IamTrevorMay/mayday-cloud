# Mayday Cloud — Status & Roadmap

This file is the in-repo memory for the stabilization effort. It travels with commits so any machine working on this project can pick up context immediately. Update it as work progresses: check off items, add new findings, adjust phases.

**Last updated:** 2026-04-12

---

## Current Focus

**Phase 1 complete** (commit `dbdb861`). **Phase 2 complete** (2026-04-12). **Paused before Phase 3.**

Phase 1 verified: signup persistence, existing login, Studio SSO, share link max_uses all passing.

Next session picks up with **Phase 3 — Test system** (items 9–12 below).

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

- [ ] **Sync client: watcher races startup sync** — `client/src/sync-engine.js:99`
  Chokidar starts while `_startupSync` is still populating the database. Same `relPath` can be written by both paths, producing duplicate/mis-ordered queue entries.

- [ ] **Sync client: stat-then-delete window** — `client/src/sync-engine.js:118-119`
  Brief gap between `fs.statSync` and enqueue. If the file is deleted in that window, the uploader retries 3 times before erroring out.

- [ ] **Sync client: TUS resumption from stale chunk** — `client/src/api.js:88-91`
  `findPreviousUploads()` continues from a prior byte offset without validating the file on disk matches the previous run. File replaced between runs = corrupted upload.

### Medium

- [ ] **CORS wide open** — `api/src/server.js` — tighten `origin: true` to a known allow-list (`www.mayday.systems`, localhost dev) before production hardening.

- [ ] **Sync client: scanner swallows errors silently** — `client/src/scanner.js:14-16` — permission errors drop whole subtrees without logging.

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

### Phase 3 — Test system: Stage 1 + Stage 2 ← NEXT
Safety net before further changes. ~1 day.

9. `api/scripts/smoke.js` — hits every public route, green/red per endpoint
10. GitHub Actions CI — web build, API syntax check, smoke script on every push to `main`
11. Vitest unit tests — `differ.js`, `scanner.js`, `middleware/auth.js verifyToken`, `routes/auth.js` signup & studio bridge
12. Wire tests into CI — block merges on red

**Exit criteria:** every push gets a green/red signal within two minutes; Phase 1–2 fixes each have at least one test.

### Phase 4 — Sync client bugs
CLI stability. ~1 day.

13. Gate watcher until `_startupSync` completes
14. Handle `ENOENT` gracefully in upload queue instead of retrying
15. Validate file mtime/size before TUS resumption
16. Scanner error logging

**Exit criteria:** sync client survives crash-resume without losing or duplicating files; permission errors are visible in the log.

### Phase 5 — Test system: Stage 3 (Playwright e2e)
Catch the race-condition class of bugs. ~1 day.

17. Playwright harness against web dev server + test Supabase
18. Happy-path flows: signup, login, Studio SSO, drag-drop to current folder, drag-drop to subfolder, mid-upload navigation
19. Run in CI on PRs (slow lane)

**Exit criteria:** race-condition bugs are reproducibly caught by e2e, not just unit tests.

### Phase 6 — Hardening & observability
~1-2 days spread out.

20. CORS origin allow-list
21. Structured API logging (`{ route, method, user_id, status, duration_ms, error }`)
22. React error boundary posting to `/api/errors`
23. `/admin/health` page (API, NAS, disk, user count, active shares)
24. Weekly scheduled smoke run against production

**Exit criteria:** production issues are visible before users report them.

### Phase 7 — Ongoing cadence

25. Optional pre-push hook (smoke + unit tests)
26. Monthly audit day — re-run the parallel bug-audit pattern
27. Monthly `npm outdated` bumps with CI verification

---

## How to Use This File

- **Before starting a Phase**, re-read the relevant section and confirm nothing has drifted since it was written. Bugs may have been fixed incidentally; new ones may have appeared.
- **When finishing an item**, check it off in the Audit Findings section and note the commit hash or date alongside it.
- **When adding a new finding**, put it in the right severity bucket and link the file:line. Don't bury it in prose.
- **When a Phase is complete**, move on to the next one. Don't jump ahead unless blocked.
- **Never delete findings** — mark them resolved with a strikethrough or checkmark so the history is preserved.
