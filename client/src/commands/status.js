const config = require('../config');
const db = require('../db');
const api = require('../api');

async function status() {
  const cfg = config.load();
  if (!cfg) {
    console.log('\n  No config found. Run `mayday-cloud init` first.\n');
    return;
  }

  console.log('\n  Mayday Cloud Sync — Status\n');
  console.log(`  API URL:       ${cfg.apiUrl}`);
  console.log(`  API Key:       ${cfg.apiKey.slice(0, 12)}...`);
  console.log(`  Local Folder:  ${cfg.localFolder}`);
  console.log(`  Remote Folder: ${cfg.remoteFolder}`);

  // Connection check
  console.log('');
  try {
    const health = await api.checkHealth(cfg);
    if (health.connected) {
      console.log('  Connection:    Connected');
    } else {
      console.log('  Connection:    Server reachable but storage unavailable');
    }
  } catch (err) {
    console.log(`  Connection:    Failed (${err.message})`);
  }

  // DB stats
  try {
    db.init(config.CONFIG_DIR);
    const counts = db.getCounts();
    console.log('');
    console.log('  File Stats:');
    if (counts.length === 0) {
      console.log('    No files tracked yet');
    } else {
      for (const { status: s, count } of counts) {
        console.log(`    ${s}: ${count}`);
      }
    }

    // Recent log
    const logs = db.getRecentLogs(10);
    if (logs.length > 0) {
      console.log('');
      console.log('  Recent Activity:');
      for (const log of logs) {
        console.log(`    [${log.created_at}] ${log.action} ${log.rel_path} ${log.detail || ''}`);
      }
    }

    db.close();
  } catch {
    console.log('  (No sync database yet — run sync first)');
  }

  console.log('');
}

module.exports = status;
