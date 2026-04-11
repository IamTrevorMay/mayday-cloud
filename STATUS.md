# Mayday Cloud — Status & Roadmap

This file is the in-repo memory for the stabilization effort. It travels with commits so any machine working on this project can pick up context immediately. Update it as work progresses: check off items, add new findings, adjust phases.

**Last updated:** 2026-04-11

---

## Current Focus

**Phase 1 — Critical fixes.** Fix user-visible breakage and data-loss bugs before touching the test system. Rationale: writing tests against the current code would lock in several bugs; fixing first then testing avoids double work.

---

## Audit Findings (2026-04-11)

Findings from a parallel codebase audit. All items verified against actual code before listing. Severity reflects real user impact, not theoretical risk.

### Critical

- [ ] **AuthContext mount race** — `web/src/contexts/AuthContext.js:10-24`
  Both `getSession()` and `onAuthStateChange()` fire on mount and both call `setSession`. Late resolution of `getSession` can overwrite a fresh session with `null`, bouncing users back to login immediately after successful signup.

- [ ] **Studio SSO duplicate accounts** — `api/src/routes/auth.js:94`
  `admin.listUsers()` is called with no pagination. Supabase defaults to 50 per page. Once the Cloud Supabase passes 50 users, any Studio login for a user beyond page 1 fails the existence check and creates a duplicate Cloud account, orphaning the user's files, favorites, and share links.

- [ ] **Share link download endpoint ignores `used_count`** — `api/src/routes/drop.js`
  Upload path increments `used_count` with optimistic locking; download path never touches it. Download-mode share links effectively have no usage limit until they expire.

- [ ] **TUS `onSuccess` stale closure** — `web/src/pages/Drive.js:577-581`
  `fetchListing(currentPath)` inside the TUS `onSuccess` callback captures `currentPath` at upload start. If the user navigates mid-upload, the listing refresh hits the wrong folder.

### High

- [ ] **Service role key used for password sign-in** — `api/src/routes/auth.js:43, 60`
  `signInWithPassword` is called on a client constructed with `SUPABASE_SERVICE_ROLE_KEY`. Principle-of-least-privilege violation — should use the anon key.

- [ ] **TUS uploads not aborted on unmount** — `web/src/pages/Drive.js`
  No cleanup effect tracks active `tus.Upload` instances. Unmounting mid-upload leaves orphaned uploads running and triggers "state update on unmounted component" warnings.

- [ ] **Token expiry not refreshed in `authedFetch`** — `web/src/lib/supabase.js:13-34`
  No check of `session.expires_at`. Long-lived tabs start 401ing silently once the JWT expires, with no auto-refresh and no user feedback.

- [ ] **TUS CORS preflight missing required headers** — `api/src/server.js`
  `cors({ origin: true, credentials: true })` does not explicitly allow `Authorization`, `Tus-Resumable`, `Upload-Length`, `Upload-Metadata`, or expose TUS response headers. This is the root cause of the drag-drop 401 seen in production.

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

### Phase 1 — Critical fixes
Fix user-visible breakage and data loss. ~1 afternoon.

1. AuthContext mount race
2. Studio SSO duplicate accounts
3. Share link download `used_count`
4. TUS `onSuccess` stale closure

**Exit criteria:** signup stays logged in; Studio login for any existing user finds the right account; download share links honor `max_uses`; mid-upload navigation refreshes the correct folder.

### Phase 2 — Latent bombs
Security leaks and edge cases. ~1 day.

5. Service role key misuse
6. TUS unmount cleanup
7. `authedFetch` token expiry refresh
8. TUS CORS preflight headers (fixes drag-drop 401)

**Exit criteria:** large drag-drop uploads succeed from `www.mayday.systems`; long-lived tabs recover after token expiry; navigating during upload leaves no console warnings.

### Phase 3 — Test system: Stage 1 + Stage 2
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
