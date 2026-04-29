const path = require('path');
const logger = require('./logger');

const MTIME_TOLERANCE_MS = 2000; // 2 seconds

// ─── Upload-only diff (original behavior) ───

function diffUploadOnly(scanned, dbFiles) {
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
      toUpload.push(file);
      _collectDirs(file.relPath, dirsNeeded);
    } else if (
      file.size !== dbEntry.size ||
      file.mtimeMs !== dbEntry.mtime_ms ||
      dbEntry.status === 'error' ||
      dbEntry.status === 'pending'
    ) {
      toUpload.push(file);
      _collectDirs(file.relPath, dirsNeeded);
    }
  }

  const toDelete = [];
  for (const [relPath] of dbMap) {
    if (!scannedSet.has(relPath)) {
      toDelete.push(relPath);
    }
  }

  const toMkdir = _sortDirs(dirsNeeded);

  return { toUpload, toDelete, toMkdir };
}

// Keep `diff` as alias for backwards compat
const diff = diffUploadOnly;

// ─── Bidirectional diff ───

/**
 * Three-way diff: local scan vs remote scan vs base (last-synced snapshot).
 *
 * @param {Array} localFiles  - [{ relPath, size, mtimeMs }]
 * @param {Array} remoteFiles - [{ relPath, size, mtimeMs }]
 * @param {Array} baseFiles   - DB rows with base_size, base_mtime_ms
 * @returns {{ toUpload, toDownload, toDeleteLocal, toDeleteRemote, toMkdirRemote, toMkdirLocal }}
 */
function diffBidirectional(localFiles, remoteFiles, baseFiles) {
  const localMap = new Map();
  for (const f of localFiles) localMap.set(f.relPath, f);

  const remoteMap = new Map();
  for (const f of remoteFiles) remoteMap.set(f.relPath, f);

  const baseMap = new Map();
  for (const f of baseFiles) {
    baseMap.set(f.rel_path, {
      size: f.base_size,
      mtimeMs: f.base_mtime_ms,
    });
  }

  const toUpload = [];
  const toDownload = [];
  const toDeleteLocal = [];
  const toDeleteRemote = [];
  const remoteDirsNeeded = new Set();
  const localDirsNeeded = new Set();

  // Collect all known paths
  const allPaths = new Set([
    ...localMap.keys(),
    ...remoteMap.keys(),
    ...baseMap.keys(),
  ]);

  for (const relPath of allPaths) {
    const local = localMap.get(relPath);
    const remote = remoteMap.get(relPath);
    const base = baseMap.get(relPath);

    const localExists = !!local;
    const remoteExists = !!remote;
    const baseExists = !!base;

    if (localExists && remoteExists) {
      // Both exist — check changes against base
      const localChanged = !baseExists || _changed(local, base);
      const remoteChanged = !baseExists || _changed(remote, base);

      if (!localChanged && !remoteChanged) {
        // Skip — both unchanged
        continue;
      }

      if (localChanged && !remoteChanged) {
        // Local changed, remote unchanged → upload
        toUpload.push(local);
        _collectDirs(relPath, remoteDirsNeeded);
      } else if (!localChanged && remoteChanged) {
        // Remote changed, local unchanged → download
        toDownload.push(remote);
        _collectDirs(relPath, localDirsNeeded);
      } else {
        // Both changed → conflict, newest mtime wins
        _resolveConflict(relPath, local, remote, toUpload, toDownload, remoteDirsNeeded, localDirsNeeded);
      }
    } else if (localExists && !remoteExists) {
      if (!baseExists) {
        // New local file, never synced → upload
        toUpload.push(local);
        _collectDirs(relPath, remoteDirsNeeded);
      } else {
        // Was in base, now gone from remote → remote deleted it
        const localChanged = _changed(local, base);
        if (localChanged) {
          // Local also changed — keep local, re-upload
          toUpload.push(local);
          _collectDirs(relPath, remoteDirsNeeded);
        } else {
          // Local unchanged — delete local to match remote
          toDeleteLocal.push(relPath);
        }
      }
    } else if (!localExists && remoteExists) {
      if (!baseExists) {
        // New remote file, never synced → download
        toDownload.push(remote);
        _collectDirs(relPath, localDirsNeeded);
      } else {
        // Was in base, now gone locally → local deleted it
        const remoteChanged = _changed(remote, base);
        if (remoteChanged) {
          // Remote also changed — keep remote, re-download
          toDownload.push(remote);
          _collectDirs(relPath, localDirsNeeded);
        } else {
          // Remote unchanged — delete remote to match local
          toDeleteRemote.push(relPath);
        }
      }
    } else {
      // Neither exists now but was in base → both deleted, just clean up
      // (handled by caller removing from DB)
    }
  }

  return {
    toUpload,
    toDownload,
    toDeleteLocal,
    toDeleteRemote,
    toMkdirRemote: _sortDirs(remoteDirsNeeded),
    toMkdirLocal: _sortDirs(localDirsNeeded),
  };
}

function _changed(current, base) {
  // Size-only comparison: mtime is unreliable because local and remote
  // filesystems assign different timestamps for the same content.
  return current.size !== base.size;
}

function _resolveConflict(relPath, local, remote, toUpload, toDownload, remoteDirs, localDirs) {
  const diff = local.mtimeMs - remote.mtimeMs;

  if (Math.abs(diff) <= MTIME_TOLERANCE_MS) {
    // Mtimes within tolerance — if sizes differ, keep local (upload) and warn
    if (local.size !== remote.size) {
      logger.warn(`Conflict (same mtime, different size): ${relPath} — keeping local`);
      toUpload.push(local);
      _collectDirs(relPath, remoteDirs);
    }
    // Same mtime, same size — skip (identical)
    return;
  }

  if (diff > 0) {
    // Local is newer → upload
    logger.debug(`Conflict resolved: ${relPath} — local is newer, uploading`);
    toUpload.push(local);
    _collectDirs(relPath, remoteDirs);
  } else {
    // Remote is newer → download
    logger.debug(`Conflict resolved: ${relPath} — remote is newer, downloading`);
    toDownload.push(remote);
    _collectDirs(relPath, localDirs);
  }
}

function _collectDirs(relPath, dirsSet) {
  let dir = path.dirname(relPath);
  while (dir && dir !== '.') {
    dirsSet.add(dir);
    dir = path.dirname(dir);
  }
}

function _sortDirs(dirsSet) {
  return [...dirsSet].sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    return depthA - depthB || a.localeCompare(b);
  });
}

module.exports = { diff, diffUploadOnly, diffBidirectional };
