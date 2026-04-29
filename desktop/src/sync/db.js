const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const SCHEMA_VERSION = '2';

let SQL = null;
let db = null;
let dbPath = null;
let saveTimer = null;

const SAVE_DEBOUNCE = 2000; // Write to disk every 2s max

async function loadSqlJs() {
  if (SQL) return SQL;
  const initSqlJs = require('sql.js');

  // In packaged app, WASM is in resources; in dev, in node_modules
  let wasmPath;
  if (process.resourcesPath) {
    const resourceWasm = path.join(process.resourcesPath, 'sql-wasm.wasm');
    if (fs.existsSync(resourceWasm)) {
      wasmPath = resourceWasm;
    }
  }
  if (!wasmPath) {
    wasmPath = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  }

  SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });
  return SQL;
}

async function init(configDir) {
  fs.mkdirSync(configDir, { recursive: true });
  dbPath = path.join(configDir, 'sync.db');

  await loadSqlJs();

  // Load existing DB from disk or create new
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables (v2 schema)
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      rel_path TEXT PRIMARY KEY,
      size INTEGER,
      mtime_ms REAL,
      synced_at TEXT,
      status TEXT DEFAULT 'pending',
      base_size INTEGER,
      base_mtime_ms REAL,
      base_synced_at TEXT,
      local_size INTEGER,
      local_mtime_ms REAL,
      remote_size INTEGER,
      remote_mtime_ms REAL,
      sync_folder TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rel_path TEXT,
      action TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Check schema version and migrate if needed
  const rows = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
  const currentVersion = (rows.length && rows[0].values.length) ? rows[0].values[0][0] : null;

  if (!currentVersion) {
    db.run('INSERT INTO meta (key, value) VALUES (?, ?)', ['schema_version', SCHEMA_VERSION]);
  } else if (currentVersion === '1') {
    _migrateV1toV2();
    db.run("UPDATE meta SET value = ? WHERE key = 'schema_version'", [SCHEMA_VERSION]);
  }

  // Reset stale 'syncing' rows from killed process
  db.run("UPDATE files SET status = 'pending' WHERE status = 'syncing'");
  const changes = db.getRowsModified();
  if (changes > 0) {
    logger.warn(`Reset ${changes} stale syncing entries to pending`);
  }

  save();
  return db;
}

function save() {
  if (!db || !dbPath) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch (err) {
      logger.error('Failed to save DB:', err.message);
    }
  }, SAVE_DEBOUNCE);
}

function saveSync() {
  if (!db || !dbPath) return;
  if (saveTimer) clearTimeout(saveTimer);
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (err) {
    logger.error('Failed to save DB:', err.message);
  }
}

// ─── Helper to get single row ───
function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    result = {};
    cols.forEach((c, i) => { result[c] = vals[i]; });
  }
  stmt.free();
  return result;
}

// ─── Helper to get all rows ───
function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  const cols = stmt.getColumnNames();
  while (stmt.step()) {
    const vals = stmt.get();
    const row = {};
    cols.forEach((c, i) => { row[c] = vals[i]; });
    results.push(row);
  }
  stmt.free();
  return results;
}

function upsertFile(relPath, size, mtimeMs, status = 'pending') {
  db.run(`
    INSERT INTO files (rel_path, size, mtime_ms, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(rel_path) DO UPDATE SET size=?, mtime_ms=?, status=?
  `, [relPath, size, mtimeMs, status, size, mtimeMs, status]);
  save();
}

function markSyncing(relPath) {
  db.run("UPDATE files SET status = 'syncing' WHERE rel_path = ?", [relPath]);
  save();
}

function markSynced(relPath) {
  // Also update base snapshot so bidirectional diff considers this file in sync
  db.run(`
    UPDATE files SET
      status = 'synced',
      synced_at = datetime('now'),
      base_size = size,
      base_mtime_ms = mtime_ms,
      base_synced_at = datetime('now'),
      remote_size = size,
      remote_mtime_ms = mtime_ms
    WHERE rel_path = ?
  `, [relPath]);
  save();
}

function markError(relPath) {
  db.run("UPDATE files SET status = 'error' WHERE rel_path = ?", [relPath]);
  save();
}

function removeFile(relPath) {
  db.run('DELETE FROM files WHERE rel_path = ?', [relPath]);
  save();
}

function getFile(relPath) {
  return getOne('SELECT * FROM files WHERE rel_path = ?', [relPath]);
}

function getAllFiles() {
  return getAll('SELECT * FROM files');
}

function getFilesByStatus(status) {
  return getAll('SELECT * FROM files WHERE status = ?', [status]);
}

function getCounts() {
  return getAll('SELECT status, COUNT(*) as count FROM files GROUP BY status');
}

function logAction(relPath, action, detail = '') {
  db.run('INSERT INTO sync_log (rel_path, action, detail) VALUES (?, ?, ?)', [relPath, action, detail]);
  save();
}

function getRecentLogs(limit = 10) {
  return getAll('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?', [limit]);
}

// ─── v1 → v2 migration ───
function _migrateV1toV2() {
  logger.info('Migrating DB schema v1 → v2...');

  // Add new columns (ignore if already exist)
  const newCols = [
    'base_size INTEGER', 'base_mtime_ms REAL', 'base_synced_at TEXT',
    'local_size INTEGER', 'local_mtime_ms REAL',
    'remote_size INTEGER', 'remote_mtime_ms REAL',
    'sync_folder TEXT',
  ];
  for (const col of newCols) {
    const name = col.split(' ')[0];
    try {
      db.run(`ALTER TABLE files ADD COLUMN ${col}`);
    } catch (err) {
      // Column already exists — safe to ignore
      if (!err.message.includes('duplicate column')) {
        logger.warn(`Migration: could not add ${name}: ${err.message}`);
      }
    }
  }

  // Synced rows: copy into base columns (both sides matched at last sync)
  db.run(`
    UPDATE files SET
      base_size = size,
      base_mtime_ms = mtime_ms,
      base_synced_at = synced_at,
      local_size = size,
      local_mtime_ms = mtime_ms
    WHERE status = 'synced'
  `);

  // Pending/error rows: set local-only columns
  db.run(`
    UPDATE files SET
      local_size = size,
      local_mtime_ms = mtime_ms
    WHERE status IN ('pending', 'error')
  `);

  save();
  logger.info('DB migration v1 → v2 complete');
}

// ─── Bidirectional helpers ───

function updateLocalState(relPath, size, mtimeMs) {
  db.run(`
    INSERT INTO files (rel_path, local_size, local_mtime_ms, status)
    VALUES (?, ?, ?, 'pending')
    ON CONFLICT(rel_path) DO UPDATE SET local_size=?, local_mtime_ms=?
  `, [relPath, size, mtimeMs, size, mtimeMs]);
  save();
}

function updateRemoteState(relPath, size, mtimeMs) {
  db.run(`
    INSERT INTO files (rel_path, remote_size, remote_mtime_ms, status)
    VALUES (?, ?, ?, 'pending')
    ON CONFLICT(rel_path) DO UPDATE SET remote_size=?, remote_mtime_ms=?
  `, [relPath, size, mtimeMs, size, mtimeMs]);
  save();
}

function markBaseSynced(relPath, size, mtimeMs) {
  db.run(`
    UPDATE files SET
      base_size = ?,
      base_mtime_ms = ?,
      base_synced_at = datetime('now'),
      local_size = ?,
      local_mtime_ms = ?,
      remote_size = ?,
      remote_mtime_ms = ?,
      status = 'synced',
      synced_at = datetime('now'),
      size = ?,
      mtime_ms = ?
    WHERE rel_path = ?
  `, [size, mtimeMs, size, mtimeMs, size, mtimeMs, size, mtimeMs, relPath]);
  save();
}

function getFilesBySyncFolder(syncFolder) {
  return getAll('SELECT * FROM files WHERE sync_folder = ?', [syncFolder]);
}

function getAllBaseFiles() {
  return getAll('SELECT * FROM files WHERE base_size IS NOT NULL');
}

function close() {
  if (db) {
    saveSync();
    db.close();
    db = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

module.exports = {
  init, upsertFile, markSyncing, markSynced, markError,
  removeFile, getFile, getAllFiles, getFilesByStatus, getCounts,
  logAction, getRecentLogs, close,
  updateLocalState, updateRemoteState, markBaseSynced,
  getFilesBySyncFolder, getAllBaseFiles,
};
