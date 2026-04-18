const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function scan(folder) {
  const results = [];
  _walk(folder, folder, results);
  return results;
}

function _walk(root, dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const relDir = path.relative(root, dir) || '.';
    logger.warn(`Cannot read directory "${relDir}": ${err.message} — skipping subtree`);
    return;
  }

  for (const entry of entries) {
    // Skip dotfiles/dotfolders
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dir, entry.name);

    // Skip symlinks
    try {
      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) continue;
    } catch (err) {
      logger.warn(`Cannot stat "${path.relative(root, fullPath)}": ${err.message} — skipping`);
      continue;
    }

    if (entry.isDirectory()) {
      _walk(root, fullPath, results);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        results.push({
          relPath: path.relative(root, fullPath),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch (err) {
        logger.warn(`Cannot stat file "${path.relative(root, fullPath)}": ${err.message} — skipping`);
      }
    }
  }
}

module.exports = { scan };
