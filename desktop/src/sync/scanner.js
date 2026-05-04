const fs = require('fs');
const path = require('path');

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
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dir, entry.name);

    try {
      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) continue;
    } catch {
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
      } catch {
        // Skip files we can't stat
      }
    }
  }
}

module.exports = { scan };
