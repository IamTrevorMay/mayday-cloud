# Production Launch Checklist — Mayday Cloud

## 1. Supabase Configuration

- [ ] **Verify migrations are applied.** Run both migration files against the Cloud Supabase project (`cuqurazxkyotoqsznjil.supabase.co`). Confirm tables exist: `profiles`, `share_links`, `api_keys`, `favorites`. Confirm the `handle_new_user` trigger is active.
- [ ] **Create your admin account.** Sign up through the app, then in Supabase dashboard go to `profiles` table and set your row's `role` to `admin`. This unlocks the `/api/admin/health` endpoint and write operations.
- [ ] **Verify RLS policies.** In Supabase dashboard > Authentication > Policies, confirm all four tables have RLS enabled and the correct policies from the migration files.
- [ ] **Enable email confirmations (optional).** Supabase dashboard > Authentication > Email Templates. The signup flow sets `email_confirm: true` via admin API, but you may want to customize the confirmation email template for branding.
- [ ] **Check Supabase rate limits.** Free tier has rate limits on auth endpoints. If you expect more than a handful of users, verify the plan supports your usage.

## 2. API Server (Work Machine)

- [ ] **Install dependencies.** `cd api && npm ci`
- [ ] **Fill in `api/.env` completely:**
  ```
  SUPABASE_URL=https://cuqurazxkyotoqsznjil.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<already set>
  SUPABASE_JWT_JWK=<already set>
  SUPABASE_ANON_KEY=<the Cloud anon key — needed for password sign-in>
  STUDIO_SUPABASE_URL=https://ytfjkoxowfskuibdsfea.supabase.co
  STUDIO_SUPABASE_ANON_KEY=<already set>
  ASSETS_ROOT=/Volumes/May Server
  PORT=4000
  CORS_ORIGINS=https://www.mayday.systems,http://localhost:3000
  ```
- [ ] **Verify `SUPABASE_ANON_KEY` is set.** Phase 2 switched `signInWithPassword` to use the anon key. If this env var is missing, Cloud login and signup will fail. This is the same key as `REACT_APP_SUPABASE_ANON_KEY`.
- [ ] **Verify NAS is mounted.** `ls /Volumes/May\ Server` should list your storage root. If the NAS disconnects, the API health check will report it, but uploads/downloads will fail until reconnected.
- [ ] **Start with pm2:**
  ```bash
  cd api
  pm2 start src/server.js --name mayday-cloud-api
  pm2 save
  ```
- [ ] **Verify pm2 startup is configured.** `pm2 startup` — ensures the API restarts after a system reboot.
- [ ] **Test the API locally.** `curl http://localhost:4000/health` should return `{ "ok": true }`.
- [ ] **Run the smoke test.** `cd api && npm run smoke` — all 11 checks should pass against localhost.

## 3. Reverse Proxy / Domain (API)

- [ ] **Set up a reverse proxy** for `cloud-api.maydaystudio.net` (or whatever domain you're using for the API). If using Nginx:
  ```nginx
  server {
      server_name cloud-api.maydaystudio.net;
      location / {
          proxy_pass http://localhost:4000;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          client_max_body_size 10G;  # Match TUS max upload
      }
  }
  ```
- [ ] **Enable HTTPS.** Use Let's Encrypt / certbot for the API domain. TUS uploads and auth tokens travel over this connection — must be HTTPS.
- [ ] **Verify `client_max_body_size`** (Nginx) or equivalent. TUS uploads can be up to 10GB. If your proxy has a smaller body limit, large uploads will fail.
- [ ] **Verify the proxy passes all headers.** The TUS CORS fix (Phase 2) requires `Authorization`, `Tus-Resumable`, `Upload-Length`, `Upload-Metadata`, `Upload-Offset` headers to pass through. Some proxies strip custom headers by default.
- [ ] **Update `CORS_ORIGINS`** in `api/.env` to include the actual production frontend URL if it differs from `https://www.mayday.systems`.

## 4. Web App (Vercel)

- [ ] **Verify Vercel env vars are correct.** Currently set:
  - `REACT_APP_SUPABASE_URL` — ✓ set
  - `REACT_APP_SUPABASE_ANON_KEY` — ✓ set
  - `REACT_APP_API_URL` — ✓ set (should be `https://cloud-api.maydaystudio.net` or your API domain)
- [ ] **Verify the `REACT_APP_API_URL` points to HTTPS.** If it still points to `http://localhost:4000`, production will fail. Update via `vercel env rm REACT_APP_API_URL production && echo "https://your-api-domain" | vercel env add REACT_APP_API_URL production`.
- [ ] **Trigger a fresh deploy.** `cd web && vercel --prod --yes` — or push to main (auto-deploys).
- [ ] **Verify the domain.** `www.mayday.systems` is already aliased. Check that `https://www.mayday.systems` loads the login page.
- [ ] **Test bare domain.** Does `mayday.systems` (without www) redirect to `www.mayday.systems`? If not, add a redirect in Vercel dashboard (Settings > Domains).

## 5. Security Hardening

- [ ] **Add rate limiting to the API.** Install `express-rate-limit`:
  ```bash
  cd api && npm install express-rate-limit
  ```
  Add rate limiters:
  - Global: 100 req/min per IP
  - `/api/auth/*`: 10 req/min per IP (prevents brute-force)
  - `/api/drop/*/upload`: 5 req/min per IP (prevents abuse of public upload links)
- [ ] **Rotate any secrets that were committed accidentally.** The `api/.env` is in `.gitignore`, but check `git log --all -p -- "*.env"` to confirm no secrets were ever committed. If they were, rotate the Supabase service role key.
- [ ] **Verify the `.env` files are gitignored.** Both `api/.env` and `web/.env` must NOT be in the repo. Confirm with `git ls-files api/.env web/.env` — should return nothing.
- [ ] **Review Supabase service role key exposure.** The service role key is used server-side only (API). It must never appear in frontend code, browser network requests, or error messages. The Phase 2 fix moved `signInWithPassword` off the service role — verify that's deployed.

## 6. Data & Backup

- [ ] **NAS backup strategy.** The Yotamaster NAS is the single source of truth for all files. If it fails, everything is lost. Confirm you have:
  - RAID or redundancy at the hardware level
  - An offsite backup schedule (even periodic rsync to an external drive)
- [ ] **Supabase backup.** Free tier has daily backups with 7-day retention. Pro tier gets point-in-time recovery. Verify your plan level and backup config in the Supabase dashboard.
- [ ] **`.trash/` cleanup policy.** Soft-deleted files accumulate in `.trash/` on the NAS. Decide on a retention window (e.g., auto-purge after 30 days) or periodically empty via the UI.

## 7. Testing & Verification

- [ ] **Run the full test suite locally:**
  ```bash
  cd api && npm test           # 8 tests
  cd client && npm test        # 18 tests
  cd web && npm run build && npm run test:e2e  # 16 tests
  ```
- [ ] **Run smoke test against production:**
  ```bash
  cd api && node scripts/smoke.js https://cloud-api.maydaystudio.net
  ```
- [ ] **Manual smoke test in browser:**
  - [ ] Go to `https://www.mayday.systems` → should show login page
  - [ ] Sign up with a new email/password → should land in Drive
  - [ ] Upload a small file (<5MB) → should appear in the listing
  - [ ] Upload a large file (>5MB) → TUS upload should show progress and complete
  - [ ] Drag a file onto a subfolder → file should land in that folder
  - [ ] Create a download share link → open in incognito → download should work
  - [ ] Create an upload share link → open in incognito → upload should work
  - [ ] Test share link with `max_uses: 1` → second use should return 410
  - [ ] Test "Sign in with Mayday Studio" → should authenticate and land in Drive
  - [ ] Check `/api/admin/health` (with auth) → should return all-green status
  - [ ] Delete a file → should move to trash → restore from trash → should reappear
  - [ ] Leave the tab open for 1+ hours → operations should still work (token refresh)

## 8. GitHub & CI

- [ ] **Set `PRODUCTION_API_URL` repo variable.** GitHub > repo > Settings > Variables > Repository variables. Set to your production API URL. This enables the weekly Monday smoke run.
- [ ] **Add Supabase env vars as GitHub secrets** (for e2e in CI). GitHub > repo > Settings > Secrets > Actions:
  - `REACT_APP_SUPABASE_URL`
  - `REACT_APP_SUPABASE_ANON_KEY`
  - `REACT_APP_API_URL`
- [ ] **Verify CI is green.** Check the latest push at `github.com/IamTrevorMay/mayday-cloud/actions` — all three jobs (web-build, api-tests, client-tests) should be passing.
- [ ] **Enable the pre-push hook** (optional):
  ```bash
  cp scripts/pre-push.sh .git/hooks/pre-push
  ```

## 9. Desktop Sync Client (When Ready)

- [ ] **Publish or install locally.** The client isn't on npm yet. For personal use: `cd client && npm link` to make `mayday-cloud` available globally.
- [ ] **Create an API key** in the web UI (Settings > API Keys). This is what the client uses to authenticate.
- [ ] **Run `mayday-cloud init`** and provide the API URL, API key, local folder, and remote folder.
- [ ] **Test `mayday-cloud sync`** — drop a file in the local folder, verify it appears on the NAS.
- [ ] **Set up as a launch daemon** (macOS) or service (Linux) for always-on sync.

## 10. Post-Launch

- [ ] **Monitor pm2 logs** for the first few days: `pm2 logs mayday-cloud-api --lines 100`. Look for `[client-error]` entries (frontend crashes) and `[req]` entries with high `duration_ms` or 5xx status codes.
- [ ] **Check `/api/admin/health`** daily for the first week. Verify disk usage isn't climbing unexpectedly.
- [ ] **Set up the monthly maintenance cycle.** The GitHub Actions workflow runs on the 1st of each month automatically. Review the workflow summary for outdated deps and act on major version bumps.
