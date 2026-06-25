const path = require('path');
const fs = require('fs');

module.exports = {
  appId: 'systems.mayday.cloud',
  productName: 'Mayday Cloud',
  copyright: 'Copyright © 2026 Mayday Studio',
  directories: {
    output: 'dist',
    buildResources: 'build',
  },
  files: ['src/**/*', 'assets/**/*', 'package.json'],
  extraResources: [
    {
      from: 'node_modules/sql.js/dist/sql-wasm.wasm',
      to: 'sql-wasm.wasm',
    },
  ],
  mac: {
    category: 'public.app-category.productivity',
    icon: 'assets/icon.icns',
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: !!process.env.APPLE_TEAM_ID,
  },
  dmg: {
    title: 'Mayday Cloud ${version}',
    contents: [
      { x: 130, y: 220, type: 'file' },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },
  afterPack: async (context) => {
    // Copy the arch-specific rclone binary into the app bundle.
    // electron-builder Arch enum: 1 = x64, 3 = arm64
    const arch = context.arch === 3 ? 'arm64' : 'x64';
    const src = path.join(__dirname, 'vendor', `rclone-darwin-${arch}`);
    if (!fs.existsSync(src)) {
      console.warn(`rclone binary not found at ${src} — skipping bundle`);
      return;
    }
    const dest = path.join(
      context.appOutDir,
      'Mayday Cloud.app',
      'Contents',
      'Resources',
      'rclone'
    );
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    console.log(`Bundled rclone (${arch}) → ${dest}`);
  },
  publish: [
    {
      provider: 'github',
      owner: 'IamTrevorMay',
      repo: 'mayday-cloud',
      releaseType: 'draft',
    },
  ],
};
