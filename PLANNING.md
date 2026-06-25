# Mayday Cloud — Planning

## Recently Completed

### Stabilization Complete (2026-04)
All stabilization phases (1–7) are complete. The platform is stable with:
- Full test coverage (unit, smoke, e2e via Playwright)
- CI/CD pipeline on GitHub Actions
- Structured logging and observability
- Weekly and monthly automated maintenance checks
- Pre-push hooks for local validation

### Recent Fixes (2026)
- Hidden files (dotfiles) filtered from Drive listing at all directory levels
- User creation and folder restriction endpoints for Studio integration
- TUS uploads excluded from global rate limiter
- Password reset flow (self-service + admin-triggered)

### NAS Playback Performance Tuning (2026-06-25)

**Goal**: Make Premiere editing over the rclone mount feel responsive — kill
the scrubbing/UI stalls and stop wasting the local disk cache.

**Context**: Editing pulls media through a layered path —
`Premiere → macOS NFS (loopback) → rclone VFS cache → WebDAV/HTTPS → Cloudflare
→ Express API → NAS`. Benchmarking the live API isolated the real costs:
- ~250ms per-request latency floor, shared by every endpoint → it's the
  network+NAS-open hop (Cloudflare→origin ≈ 190ms), **not** mount flags or the
  WebDAV library.
- Throughput floats 20–36 MB/s — below the ~50+ MB/s 4K needs from a cold cache.
- Cloudflare proxies but does **not** cache (no `cf-cache-status`) — pure hop tax.
- Occasional multi-second stalls (one 16s read) — suspected NAS drive spin-up.

**Changes shipped**:
- Mount metadata caching: `--dir-cache-time` 30s → 1h (removes the repeated
  ~250ms metadata round-trips behind the scrub stall); `--vfs-cache-max-age`
  72h → 168h.
- Dynamic VFS cache sizing (`desktop/src/mount/cache-size.js`): sizes from free
  disk — `min(50% free, free − 150G)`, clamped 15G–300G. macOS uses `diskutil`
  (purgeable-aware) since `df`/statfs under-report. Default `mountCacheSize`
  is now `'auto'`; an explicit config value still wins.
- WebDAV real-size header (`api/src/webdav/range-size.js`): range responses now
  report the true file size instead of `bytes a-b/*`, eliminating rclone's
  extra HEAD/PROPFIND size-probe round-trip per file.
- API: `express.json()` skipped on binary-stream routes (`/api/webdav`,
  `/api/nas/tus`).

**Outcome**: Repeated metadata/read round-trips are removed and warm clips serve
from a right-sized local cache. The raw pipe (throughput + 250ms floor) is a
physical ceiling tuning cannot move — see follow-ups below.

## Planned

### Near-term
- Document the coupling between auth middleware mount ordering and path check

#### Playback performance follow-ups
Mount tuning is maxed; remaining wins are editor- and infra-side:
- **Premiere proxies** — edit low-res copies, relink full-res on export. The
  real fix for 4K over a 20–36 MB/s pipe. Editor-side, no code change.
- **Cache pre-warming** — preload a project's media so it's local before scrubbing.
- **Cloudflare bypass for mount (shipped)** — `fast.maydaystudio.net` DNS-only
  (grey-cloud) subdomain with Caddy TLS. Desktop app has a `mountApiUrl` config
  field (Preferences → Mount API URL) so the rclone mount bypasses Cloudflare
  while the web UI / normal API traffic stays proxied. Trade-off: exposes origin
  IP, loses CF TLS/DDoS on that subdomain.
- **Disable NAS drive sleep** — suspected cause of the multi-second cold-read
  stalls (drive spin-up). Check Yotamaster power/standby settings.
- **Confirm NAS-site uplink** — 20–36 MB/s may be the upload ceiling there; if so
  it's the hard limit and only caching/proxies help.

### Long-term

#### Raspberry Pi Server Migration

Migrate the API server off the Mac Studio onto a headless Raspberry Pi. Only the `api/` layer moves — the web frontend stays on Vercel, desktop/client apps are unchanged.

**Why**: Frees up the Mac Studio, reduces the server to a dedicated low-power appliance. The API is lightweight Node.js with no macOS-specific dependencies.

**Hardware**:
- Raspberry Pi 4 or 5 (ARM64)
- Boot from USB SSD (not SD card — avoids write-wear from thumbnails, TUS staging, trash)
- Yotamaster NAS connected directly via USB 3.0
- Ethernet to local network

**Software**:
- Raspberry Pi OS Lite 64-bit (headless, no desktop)
- Node.js 22, ffmpeg, pm2
- All npm dependencies work on ARM64 Linux — sharp has prebuilt binaries, everything else is pure JS

**Setup flow**:
1. Flash OS onto USB SSD, boot Pi, enable SSH
2. Plug in Yotamaster via USB, verify it mounts read/write (e.g. at `/mnt/nas`)
3. Install Node.js, ffmpeg (`apt install ffmpeg`), pm2 (`npm i -g pm2`)
4. Clone repo (or copy `api/`), `npm install`, create `.env` with `ASSETS_ROOT=/mnt/nas`
5. `pm2 start src/server.js --name mayday-api`, then `pm2 startup && pm2 save`
6. Point Cloudflare tunnel to Pi's local IP — `cloud-api.maydaystudio.net` resolves to Pi
7. Test: web app, desktop app, and client all work without changes (same API URL)

**Config changes**:
- `ASSETS_ROOT=/mnt/nas` (was `/Volumes/May Server`)
- All Supabase keys, CORS origins, etc. copied from existing `api/.env`
- DNS/Cloudflare updated to point to Pi

**No code changes required** — purely an infrastructure move.

**Verify before committing**:
- Yotamaster mounts as standard USB mass storage on Linux (no special drivers)
- `fs.renameSync()` works atomically on the mounted filesystem (needed for TUS uploads)
- ffmpeg ARM64 handles all video formats used (mp4, mov, avi, mkv, webm)

## Known Issues

- Auth middleware drop-path check is fragile — coupling between mount ordering and path check should be documented

## Architecture Notes

### Architecture Decisions
| Date | Decision | Context |
|------|----------|---------|
| 2026-04-11 | Stabilization audit and phased roadmap | Addressed all critical/high/medium findings |
| 2026-04-12 | CORS origin allow-list | Replaced wildcard CORS with env-configurable origins |
| 2026-04-12 | Anon key for user auth | Service role reserved for admin ops only |
| 2026-06-25 | Dynamic VFS cache sizing from free disk | `df` under-reports on macOS; `diskutil` gives purgeable-aware free space |
| 2026-06-25 | WebDAV range responses report real size | Saves rclone an extra size-probe round-trip per file |

### Deployment
- Web deploys manually via `npx vercel --prod` (no auto-deploy)
- API deploys via `pm2 restart mayday-api`
- Desktop releases via `desktop-v*` git tags → GitHub Actions
- See [STATUS.md](./STATUS.md) for the full audit history and completed roadmap

## Open Risks

- Auth middleware drop-path check fragility could cause silent auth bypass if mount order changes
