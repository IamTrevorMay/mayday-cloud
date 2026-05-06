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
    target: [{ target: 'dmg', arch: ['universal'] }],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: process.env.APPLE_TEAM_ID
      ? { teamId: process.env.APPLE_TEAM_ID }
      : false,
  },
  dmg: {
    title: 'Mayday Cloud ${version}',
    contents: [
      { x: 130, y: 220, type: 'file' },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },
  publish: [
    {
      provider: 'github',
      owner: 'IamTrevorMay',
      repo: 'mayday-cloud',
    },
  ],
};
