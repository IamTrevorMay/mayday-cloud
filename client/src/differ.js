const path = require('path');

function diff(scanned, dbFiles) {
  const dbMap = new Map();
  for (const f of dbFiles) {
    dbMap.set(f.rel_path, f);
  }

  const scannedSet = new Set();
  const toUpload = [];
  const dirsNeeded = new Set();

  for (const file of scanned) {
    scannedSet.add(file.relPath);
    const dbEntry = dbMap.get(file.relPath);

    if (!dbEntry) {
      // New file
      toUpload.push(file);
      _collectDirs(file.relPath, dirsNeeded);
    } else if (
      file.size !== dbEntry.size ||
      file.mtimeMs !== dbEntry.mtime_ms ||
      dbEntry.status === 'error' ||
      dbEntry.status === 'pending'
    ) {
      // Modified or previously failed
      toUpload.push(file);
      _collectDirs(file.relPath, dirsNeeded);
    }
  }

  // Files in DB but not on disk → delete
  const toDelete = [];
  for (const [relPath] of dbMap) {
    if (!scannedSet.has(relPath)) {
      toDelete.push(relPath);
    }
  }

  // Sort dirs parent-first (by depth)
  const toMkdir = [...dirsNeeded].sort((a, b) => {
    const depthA = a.split(path.sep).length;
    const depthB = b.split(path.sep).length;
    return depthA - depthB || a.localeCompare(b);
  });

  return { toUpload, toDelete, toMkdir };
}

function _collectDirs(relPath, dirsSet) {
  let dir = path.dirname(relPath);
  while (dir && dir !== '.') {
    dirsSet.add(dir);
    dir = path.dirname(dir);
  }
}

module.exports = { diff };
