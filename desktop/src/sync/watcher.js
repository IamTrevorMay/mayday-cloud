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
      // Never ignore the watch root itself — chokidar tests it against this
      // predicate, so a sync folder like ~/.mydata would otherwise be dropped
      // and nothing would sync.
      if (path.resolve(filePath) === path.resolve(folder)) return false;
      const base = path.basename(filePath);
      return base.startsWith('.') || filePath.endsWith('.mck-tmp');
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
