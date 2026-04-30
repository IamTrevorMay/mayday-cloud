# Desktop App — Build & Release

How the macOS desktop app is packaged, signed, and shipped.

## Architecture

- Built with `electron-builder` from `desktop/`
- Universal binary (Intel + Apple Silicon), `.dmg` only
- Code-signed with Developer ID Application + notarized via `notarytool` (electron-builder handles both with `mac.notarize: true`)
- Auto-updates via `electron-updater` against GitHub Releases
- Built and published by GitHub Actions on `desktop-v*` tag push (`.github/workflows/desktop-release.yml`)
- Hardened runtime entitlements in `desktop/build/entitlements.mac.plist`

## Identity (do not change)

- **Bundle ID**: `systems.mayday.cloud` — registered at developer.apple.com. Changing this orphans every existing install (auto-updates break, keychain entries reset).
- **Product name**: `Mayday Cloud`
- **Repo for releases**: `IamTrevorMay/mayday-cloud`

## Required GitHub repository secrets

Set at github.com/IamTrevorMay/mayday-cloud/settings/secrets/actions:

| Secret | Source |
|---|---|
| `MAC_CERT_P12_BASE64` | `base64 -i DeveloperID.p12 \| pbcopy` |
| `MAC_CERT_PASSWORD` | password set when exporting the .p12 |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com → App-Specific Passwords |
| `APPLE_TEAM_ID` | 10-char Team ID from developer.apple.com membership page |

`GITHUB_TOKEN` is auto-provided.

## Cutting a release

```bash
# bump desktop/package.json version, commit
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

GitHub Actions takes ~15 min to build, sign, notarize, and publish. The release will contain `Mayday-Cloud-<version>-universal.dmg`, `.dmg.blockmap`, and `latest-mac.yml` (the auto-updater feed).

The web UI's "Download for Mac" button (in `web/src/pages/Drive.js` Sidebar) reads from `api.github.com/.../releases/latest`, picks the `.dmg` asset, and caches it in localStorage for 1 hour. It hides itself entirely if no release exists.

## Local dev/build

```bash
cd desktop
npm install
npm start                                  # run unpackaged in dev
npm run dist                               # local universal DMG, unsigned (skips notarize)
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist   # explicitly skip signing for fast iteration
```

`npm run release` is what CI calls — don't run it locally without all the env vars set.

## Native dependency notes

- `sql.js` ships a `.wasm` file. `package.json` has it in `extraResources`, so in the packaged app it's at `process.resourcesPath/sql-wasm.wasm`. `desktop/src/sync/db.js` resolves it from there in production. Don't move or remove this entry.
- No native node modules currently — `chokidar`, `tus-js-client`, `menubar` are all pure JS. If anything native is added later, electron-builder will need `nativeRebuild` enabled and the CI runner may need additional setup.

## Auto-updater behavior

`desktop/src/auto-updater.js` (called from `main.js:342`):

- No-op when `!app.isPackaged` (dev)
- 8s delay after launch before first check
- Re-checks every 4 hours
- Auto-downloads on update available
- Shows a system notification on `update-downloaded`
- Installs on app quit (`autoInstallOnAppQuit: true`)

## Icons

- `desktop/assets/icon.icns` — Dock/Finder icon. Generated from `icon.png` (1024×1024) via `sips` + `iconutil`.
- `desktop/assets/iconTemplate.png` + `iconTemplate@2x.png` — menubar tray glyph (single-color silhouette, transparent bg). macOS auto-tints based on light/dark menubar.
- If `iconTemplate.png` is missing, `desktop/src/main.js:42-44` falls back to an inline base64 placeholder.

To regenerate `icon.icns` from a 1024×1024 source:

```bash
cd desktop/assets
mkdir -p icon.iconset
for s in 16 32 64 128 256 512 1024; do
  sips -z $s $s icon.png --out icon.iconset/icon_${s}x${s}.png
done
for s in 16 32 128 256 512; do
  cp icon.iconset/icon_$((s*2))x$((s*2)).png icon.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns icon.iconset
rm -rf icon.iconset
```

## Known blockers

`desktop/src/main.js` requires two modules that don't exist yet:

- `./auth` (line 10) — used at `main.js:166,175` for `auth.login()` and `auth.studioLogin()` against the Cloud Supabase + Studio Hub SSO bridge
- `./sync/logger` (line 8) — referenced from `main.js`

The build pipeline produces a working DMG, but launching it crashes on `require()` until both files are written. These are pre-release work, separate from the build/distribution setup.
