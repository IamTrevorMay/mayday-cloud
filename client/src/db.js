const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const SCHEMA_VERSION = '1';

let db;

function init(configDir) {
  fs.mkdirSync(configDir, { recursive: true });
  const dbPath = path.join(configDir, 'sync.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      rel_path TEXT PRIMARY KEY,
      size INTEGER,
      mtime_ms REAL,
      synced_at TEXT,
      status TEXT DEFAULT 'pending'
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

  // Set schema version if not present
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
  if (!row) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
  }

  // Reset stale 'syncing' rows from killed process
  const reset = db.prepare("UPDATE files SET status = 'pending' WHERE status = 'syncing'");
  const changes = reset.run().changes;
  if (changes > 0) {
    logger.warn(`Reset ${changes} stale syncing entries to pending`);
  }

  return db;
}

function upsertFile(relPath, size, mtimeMs, status = 'pending') {
  db.prepare(`
    INSERT INTO files (rel_path, size, mtime_ms, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(rel_path) DO UPDATE SET size=?, mtime_ms=?, status=?
  `).run(relPath, size, mtimeMs, status, size, mtimeMs, status);
}

function markSyncing(relPath) {
  db.prepare("UPDATE files SET status = 'syncing' WHERE rel_path = ?").run(relPath);
}

function markSynced(relPath) {
  db.prepare("UPDATE files SET status = 'synced', synced_at = datetime('now') WHERE rel_path = ?").run(relPath);
}

function markError(relPath) {
  db.prepare("UPDATE files SET status = 'error' WHERE rel_path = ?").run(relPath);
}

function removeFile(relPath) {
  db.prepare('DELETE FROM files WHERE rel_path = ?').run(relPath);
}

function getFile(relPath) {
  return db.prepare('SELECT * FROM files WHERE rel_path = ?').get(relPath);
}

function getAllFiles() {
  return db.prepare('SELECT * FROM files').all();
}

function getFilesByStatus(status) {
  return db.prepare('SELECT * FROM files WHERE status = ?').all(status);
}

function getCounts() {
  return db.prepare(`
    SELECT status, COUNT(*) as count FROM files GROUP BY status
  `).all();
}

function logAction(relPath, action, detail = '') {
  db.prepare('INSERT INTO sync_log (rel_path, action, detail) VALUES (?, ?, ?)').run(relPath, action, detail);
}

function getRecentLogs(limit = 10) {
  return db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?').all(limit);
}

function close() {
  if (db) db.close();
}

module.exports = {
  init, upsertFile, markSyncing, markSynced, markError,
  removeFile, getFile, getAllFiles, getFilesByStatus, getCounts,
  logAction, getRecentLogs, close,
};
