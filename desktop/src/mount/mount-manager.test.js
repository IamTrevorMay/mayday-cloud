import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const { MountManager, _deps } = require('./mount-manager');

let origDeps;

function createFakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.spawnargs = ['rclone', 'mount', ':webdav:/', '/tmp/test-mount'];
  return proc;
}

const defaultOpts = {
  apiUrl: 'https://cloud-api.example.com/api/webdav',
  apiKey: 'mck_test123',
  mountPoint: '/tmp/test-mount',
};

beforeEach(() => {
  origDeps = { ..._deps };
  _deps.spawn = vi.fn();
  _deps.execSync = vi.fn();
  _deps.mkdirSync = vi.fn();
  _deps.accessSync = vi.fn();
  _deps.findRclone = vi.fn(() => '/usr/local/bin/rclone');
  _deps.obscurePassword = vi.fn((p) => `obscured_${p}`);
  _deps.configLoad = vi.fn(() => null);
  vi.useFakeTimers();
});

afterEach(() => {
  Object.assign(_deps, origDeps);
  vi.useRealTimers();
});

describe('MountManager', () => {
  it('starts in stopped state', () => {
    const mm = new MountManager();
    expect(mm.state).toBe('stopped');
    expect(mm.mounted).toBe(false);
  });

  it('throws if rclone is not found', async () => {
    _deps.findRclone.mockReturnValue(null);
    const mm = new MountManager();
    await expect(mm.start(defaultOpts)).rejects.toThrow(/rclone not found/);
  });

  it('transitions to starting then mounted on rclone log', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const states = [];
    mm.on('stateChange', (s) => states.push(s));

    const startPromise = mm.start(defaultOpts);

    proc.stdout.emit('data', Buffer.from('Mounting on /tmp/test-mount'));

    await startPromise;
    expect(states).toContain('starting');
    expect(states).toContain('mounted');
    expect(mm.mounted).toBe(true);
  });

  it('sets state to mounted on "vfs cache" log line', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);

    proc.stdout.emit('data', Buffer.from('vfs cache: initialized'));

    await startPromise;
    expect(mm.state).toBe('mounted');
  });

  it('emits fuseError on FUSE-related stderr', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const fuseErrors = [];
    mm.on('fuseError', (line) => fuseErrors.push(line));

    const startPromise = mm.start(defaultOpts);

    proc.stderr.emit('data', Buffer.from('mount helper error: FUSE not found'));
    proc.stdout.emit('data', Buffer.from('Mounting on /test'));

    await startPromise;
    expect(fuseErrors).toHaveLength(1);
    expect(fuseErrors[0]).toMatch(/FUSE/);
  });

  // Bug 2: Timeout should verify mount point accessibility
  it('sets error state on timeout when mount point is inaccessible', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);
    _deps.accessSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);

    // Advance past the 10s timeout without any log output
    vi.advanceTimersByTime(10000);

    await startPromise;
    expect(mm.state).toBe('error');
  });

  it('sets mounted state on timeout when mount point IS accessible', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);
    _deps.accessSync.mockImplementation(() => {}); // accessible

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);

    vi.advanceTimersByTime(10000);

    await startPromise;
    expect(mm.state).toBe('mounted');
  });

  it('sets error state when process exits with non-zero code', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);

    proc.emit('close', 1);

    await startPromise;
    expect(mm.state).toBe('error');
  });

  it('schedules restart on non-zero exit', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const logs = [];
    mm.on('log', (l) => logs.push(l));

    const startPromise = mm.start(defaultOpts);
    proc.emit('close', 1);
    await startPromise;

    expect(logs.some((l) => l.includes('Restarting in'))).toBe(true);
  });

  it('stops gracefully', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);
    proc.stdout.emit('data', Buffer.from('Mounting on /test'));
    await startPromise;

    const stopPromise = mm.stop();
    proc.emit('close', 0);
    await stopPromise;

    expect(mm.state).toBe('stopped');
  });

  it('handles spawn error', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const states = [];
    mm.on('stateChange', (s) => states.push(s));

    const startPromise = mm.start(defaultOpts);

    // The 'error' event sets state to 'error', which resolves the await
    proc.emit('error', new Error('spawn failed'));

    await startPromise;
    expect(states).toContain('error');
  });

  // Bug 4: Restart failure should set error state
  it('sets error state when restart attempt fails', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);
    proc.emit('close', 1);
    await startPromise;

    // Now make findRclone return null so restart fails
    _deps.findRclone.mockReturnValue(null);

    // Advance past the restart delay (1s for first retry)
    vi.advanceTimersByTime(1000);

    // Wait for the restart promise to settle
    await vi.waitFor(() => {
      expect(mm.state).toBe('error');
    });
  });

  // Bug 9: Restart should reload config
  it('reloads config on restart for fresh opts', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);
    proc.emit('close', 1);
    await startPromise;

    // Set up fresh config to be loaded on restart
    _deps.configLoad.mockReturnValue({
      apiUrl: 'https://new-api.example.com',
      apiKey: 'mck_newkey',
      mountPoint: '/Volumes/NewMount',
      mountCacheSize: '100G',
      mountRemotePath: '/sub',
    });

    const proc2 = createFakeProcess();
    _deps.spawn.mockReturnValue(proc2);

    // Advance past restart delay
    vi.advanceTimersByTime(1000);

    // Verify config.load was called during restart
    await vi.waitFor(() => {
      expect(_deps.configLoad).toHaveBeenCalled();
    });
  });
});
