#!/usr/bin/env node

const { program } = require('commander');
const pkg = require('../package.json');

program
  .name('mayday-cloud')
  .description('Mayday Cloud desktop sync client')
  .version(pkg.version);

program
  .command('init')
  .description('Configure sync settings (API URL, key, folders)')
  .action(async () => {
    const init = require('../src/commands/init');
    await init();
  });

program
  .command('sync')
  .description('Start syncing local folder to Mayday Cloud')
  .action(async () => {
    const sync = require('../src/commands/sync');
    await sync();
  });

program
  .command('status')
  .description('Show current config, connection health, and sync stats')
  .action(async () => {
    const status = require('../src/commands/status');
    await status();
  });

program.parse();
