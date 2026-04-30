# Mayday Cloud

Personal cloud storage platform backed by a 60TB Yotamaster NAS rack.

> **See [STATUS.md](./STATUS.md)** for the current audit findings, active bug list, and phased stabilization roadmap. Check it before starting new work.

## Architecture

- **Web**: React 18 + Craco SPA, deployed to Vercel at `cloud.maydaystudio.net`
- **API**: Express 4, runs on work machine via pm2 at `cloud-api.maydaystudio.net` (port 4000)
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
- **Uploads**: Small files (<5MB) via multer POST, large files via TUS resumable protocol (up to 10GB).
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

- **Web**: Push to main -> Vercel auto-deploys
- **API**: `pm2 start api/src/server.js --name mayday-cloud-api`
- **Desktop**: Push tag `desktop-v*` -> GitHub Actions builds, signs, notarizes, and publishes the universal DMG to GitHub Releases. See [desktop/RELEASE.md](./desktop/RELEASE.md).
