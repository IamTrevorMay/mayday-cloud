const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(require('os').homedir(), '.mayday-cloud');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  apiUrl: '',
  apiKey: '',
  localFolder: '',
  remoteFolder: '/',
};

function load() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

function save(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

function isValid(cfg) {
  return cfg && cfg.apiUrl && cfg.apiKey && cfg.localFolder;
}

module.exports = { CONFIG_DIR, CONFIG_PATH, load, save, isValid };
