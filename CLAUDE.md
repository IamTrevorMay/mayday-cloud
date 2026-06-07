# Mayday Cloud

Personal cloud storage platform backed by a 60TB Yotamaster NAS rack.

> **See [STATUS.md](./STATUS.md)** for the current audit findings, active bug list, and phased stabilization roadmap. Check it before starting new work.

## Architecture

- **Web**: React 18 + Craco SPA, deployed to Vercel at `www.mayday.systems`
- **API**: Express 4, runs on work machine via pm2 (name: `mayday-api`) at `cloud-api.maydaystudio.net` (port 4000)
- **Auth/DB**: Supabase (separate project from Studio Hub)
- **Storage**: Yotamaster NAS via USB-C, mounted at `/Volumes/May Server`
- **Client**: Node.js CLI for desktop folder sync
- **Desktop**: Electron menubar app (`desktop/`), packaged as universal signed/notarized DMG. See [desktop/RELEASE.md](./desktop/RELEASE.md) for build pipeline, signing secrets, and release procedure.

## Project Structure

```
web/          React SPA (dark theme, inline styles, DM Sans font)
api/          Express API server
client/       Desktop sync CLI (mayday-cloud init/sync/status)
desktop/      Electron menubar app — distributable via GitHub Releases
supabase/     Migration files
```

## Database (Supabase, 4 tables, all RLS-enabled)

- **profiles** — auto-created on signup via trigger; roles: admin, member, viewer
- **share_links** — token-based sharing with expiry, usage limits, upload/download modes
- **api_keys** — hashed `mck_*` keys with optional path scoping
- **favorites** — user bookmarks, unique on (user_id, file_path)

## Key Patterns

- **Auth**: Email/password sign-up/sign-in on Cloud's own Supabase, plus "Sign in with Mayday Studio" flow that bridges to Studio Hub's Supabase. API also accepts `mck_*` API keys. Role cache with 5-min TTL.
- **Uploads**: Small files (<5MB) via multer POST, large files via TUS resumable protocol (up to 10GB). TUS and WebDAV endpoints are excluded from the global rate limiter.
- **Password Reset**: Self-service via `/api/auth/reset-password` (public), admin-triggered via `/api/restrictions/admin/users/:id/reset-password`. Frontend reset page at `/reset`. Uses Supabase `resetPasswordForEmail` with Resend SMTP.
- **Soft deletes**: Files move to `.trash/` with timestamp prefix, restorable.
- **Thumbnails**: Sharp (images) + ffmpeg (video frames), cached by SHA256(path:mtime) in `.thumbs/`.
- **Path safety**: All user paths sanitized and verified within ASSETS_ROOT.
- **Sync client**: Startup diff + live chokidar watcher, 3-concurrent upload queue, SQLite state DB at `~/.mayday-cloud/`.

## Commands

```bash
# API
cd api && npm install && npm run dev    # dev with nodemon
cd api && npm start                     # production

# Web
cd web && npm install && npm start      # dev on :3000

# Client
cd client && npm install
node bin/mayday-cloud.js init           # interactive setup
node bin/mayday-cloud.js sync           # start syncing
node bin/mayday-cloud.js status         # check connection & stats
```

## Environment Variables

See `api/.env.example` and `web/.env.example` for required config.

## Deploy

- **Web**: Vercel project is `web` (NOT `mayday-cloud`). Domain: `www.mayday.systems`. After push, deploy with `npx vercel --prod` (linked to `web` project via `.vercel/project.json`). The GitHub auto-deploy integration is NOT connected — deploy manually.
- **API**: `pm2 restart mayday-api` (process name is `mayday-api`, not `mayday-cloud-api`). Script: `api/src/server.js`, cwd: `api/`. API is behind Cloudflare proxy; TUS server uses `respectForwardedHeaders: true`.
- **Desktop**: Push tag `desktop-v*` -> GitHub Actions builds, signs, notarizes, and publishes the universal DMG to GitHub Releases. See [desktop/RELEASE.md](./desktop/RELEASE.md).

## Vercel Notes

- `vercel.json` in repo root configures: build from `web/`, output `web/build`, SPA rewrites for client-side routing.
- The old `mayday-cloud` Vercel project has been deleted. Only the `web` project remains.
- Always deploy with `npx vercel --prod` from the repo root after pushing.

## Workflow Rules

- **Clarify before coding**: When the user suggests a change, always ask clarifying questions using the AskUserQuestion tool (multiple choice selector) before starting any implementation work. Do not assume intent — confirm scope, approach, and any ambiguities first.
