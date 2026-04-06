const chokidar = require('chokidar');
const path = require('path');
const logger = require('./logger');

function create(folder, callbacks) {
  const watcher = chokidar.watch(folder, {
    ignoreInitial: true,
    followSymlinks: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 200,
    },
    ignored: (filePath, stats) => {
      const base = path.basename(filePath);
      return base.startsWith('.');
    },
  });

  watcher.on('add', (filePath) => {
    const relPath = path.relative(folder, filePath);
    logger.debug(`Watch: add ${relPath}`);
    if (callbacks.onAdd) callbacks.onAdd(relPath, filePath);
  });

  watcher.on('change', (filePath) => {
    const relPath = path.relative(folder, filePath);
    logger.debug(`Watch: change ${relPath}`);
    if (callbacks.onChange) callbacks.onChange(relPath, filePath);
  });

  watcher.on('unlink', (filePath) => {
    const relPath = path.relative(folder, filePath);
    logger.debug(`Watch: unlink ${relPath}`);
    if (callbacks.onUnlink) callbacks.onUnlink(relPath);
  });

  watcher.on('error', (err) => {
    logger.error('Watcher error:', err.message);
  });

  return watcher;
}

module.exports = { create };
