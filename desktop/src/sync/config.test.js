import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const config = require('./config');

let tmpDir;

function makeTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  config._setTestDir(tmpDir);
  return tmpDir;
}

beforeEach(() => {
  makeTmpDir();
});

afterEach(() => {
  config._resetTestDir();
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('config.load', () => {
  it('returns null when config file does not exist', () => {
    expect(config.load()).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), 'not json!!', 'utf8');
    expect(config.load()).toBeNull();
  });

  it('merges defaults into loaded config', () => {
    const partial = { apiUrl: 'https://example.com', apiKey: 'mck_123' };
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(partial), 'utf8');
    const loaded = config.load();
    expect(loaded.apiUrl).toBe('https://example.com');
    expect(loaded.apiKey).toBe('mck_123');
    // Defaults should be merged in
    expect(loaded.syncMode).toBe('upload-only');
    expect(loaded.mountEnabled).toBe(false);
    expect(loaded.mountCacheSize).toBe('50G');
  });
});

describe('config.save', () => {
  it('creates config directory and writes JSON', () => {
    const nested = path.join(tmpDir, 'sub');
    config._setTestDir(nested);
    config.save({ apiUrl: 'https://test.com', apiKey: 'mck_key', localFolder: '/tmp' });
    const raw = fs.readFileSync(path.join(nested, 'config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.apiUrl).toBe('https://test.com');
  });
});

describe('config.load + save round-trip', () => {
  it('round-trips config correctly', () => {
    const original = { apiUrl: 'https://a.com', apiKey: 'mck_x', localFolder: '/f', extra: 42 };
    config.save(original);
    const loaded = config.load();
    expect(loaded.apiUrl).toBe('https://a.com');
    expect(loaded.apiKey).toBe('mck_x');
    expect(loaded.localFolder).toBe('/f');
    expect(loaded.extra).toBe(42);
  });
});

describe('config.isValid', () => {
  it('returns false for null', () => {
    expect(config.isValid(null)).toBeFalsy();
  });

  it('returns false when apiUrl is missing', () => {
    expect(config.isValid({ apiKey: 'k', localFolder: '/f' })).toBeFalsy();
  });

  it('returns false when apiKey is missing', () => {
    expect(config.isValid({ apiUrl: 'u', localFolder: '/f' })).toBeFalsy();
  });

  it('returns true when all required fields are present', () => {
    expect(config.isValid({ apiUrl: 'u', apiKey: 'k', localFolder: '/f' })).toBeTruthy();
  });
});
