const config = require('../config');
const db = require('../db');
const logger = require('../logger');
const { SyncEngine } = require('../sync-engine');

async function sync() {
  const cfg = config.load();
  if (!config.isValid(cfg)) {
    console.error('No valid config found. Run `mayday-cloud init` first.');
    process.exit(1);
  }

  logger.enableFileLog(config.CONFIG_DIR);
  logger.info('Starting Mayday Cloud Sync...');
  logger.info(`Local:  ${cfg.localFolder}`);
  logger.info(`Remote: ${cfg.remoteFolder}`);
  logger.info(`Server: ${cfg.apiUrl}`);

  db.init(config.CONFIG_DIR);
  const engine = new SyncEngine(cfg);

  // Graceful shutdown
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await engine.stop();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await engine.start();
  } catch (err) {
    logger.error(`Fatal: ${err.message}`);
    db.close();
    process.exit(1);
  }
}

module.exports = sync;
