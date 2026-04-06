const inquirer = require('inquirer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const api = require('../api');
const logger = require('../logger');

async function init() {
  console.log('\n  Mayday Cloud Sync — Setup\n');

  const existing = config.load();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'apiUrl',
      message: 'API URL:',
      default: existing?.apiUrl || 'https://your-server.com',
      validate: (v) => v.startsWith('http') ? true : 'Must start with http:// or https://',
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API Key (mck_...):',
      default: existing?.apiKey || '',
      validate: (v) => v.startsWith('mck_') ? true : 'API key must start with mck_',
    },
    {
      type: 'input',
      name: 'localFolder',
      message: 'Local folder to sync:',
      default: existing?.localFolder || path.join(require('os').homedir(), 'MaydayCloud'),
      validate: (v) => {
        const resolved = path.resolve(v);
        if (!fs.existsSync(resolved)) {
          return `Folder does not exist: ${resolved}. Create it first.`;
        }
        return true;
      },
      filter: (v) => path.resolve(v),
    },
    {
      type: 'input',
      name: 'remoteFolder',
      message: 'Remote folder (destination on server):',
      default: existing?.remoteFolder || '/',
    },
  ]);

  // Strip trailing slash from apiUrl
  answers.apiUrl = answers.apiUrl.replace(/\/+$/, '');

  // Test connection
  console.log('\n  Testing connection...');
  try {
    const health = await api.checkHealth(answers);
    if (health.connected) {
      console.log('  Connected! Server storage available.\n');
    } else {
      console.log('  Warning: Server responded but storage may be unavailable.\n');
    }
  } catch (err) {
    console.error(`  Connection failed: ${err.message}`);
    console.error('  Config saved anyway — you can retry with `mayday-cloud status`.\n');
  }

  config.save(answers);
  console.log(`  Config saved to ${config.CONFIG_PATH}\n`);
}

module.exports = init;
