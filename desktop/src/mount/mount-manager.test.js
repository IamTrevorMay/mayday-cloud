import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const { MountManager, _deps } = require('./mount-manager');

let origDeps;
let origPlatform;

function createFakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.spawnargs = ['rclone', 'serve', 'nfs', ':webdav:/'];
  return proc;
}

const defaultOpts = {
  apiUrl: 'https://cloud-api.example.com/api/webdav',
  apiKey: 'mck_test123',
  mountPoint: '/tmp/test-mount',
};

beforeEach(() => {
  origDeps = { ..._deps };
  origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  _deps.spawn = vi.fn();
  _deps.execSync = vi.fn();
  _deps.mkdirSync = vi.fn();
  _deps.accessSync = vi.fn();
  _deps.readdirSync = vi.fn(() => ['folder1', 'folder2']);
  _deps.findRclone = vi.fn(() => '/usr/local/bin/rclone');
  _deps.obscurePassword = vi.fn((p) => `obscured_${p}`);
  _deps.configLoad = vi.fn(() => null);
});

afterEach(() => {
  Object.assign(_deps, origDeps);
  if (origPlatform) {
    Object.defineProperty(process, 'platform', origPlatform);
  }
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

  it('mounts via NFS on macOS', async () => {
    // macOS is the default platform in this test env
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const states = [];
    mm.on('stateChange', (s) => states.push(s));

    const startPromise = mm.start(defaultOpts);

    // Simulate NFS server reporting ready via stderr
    proc.stderr.emit('data', Buffer.from('NFS Server running at 127.0.0.1:9049'));

    await startPromise;
    expect(states).toContain('starting');
    expect(states).toContain('mounted');
    expect(mm.mounted).toBe(true);

    // Should have called mount_nfs via execSync
    expect(_deps.execSync).toHaveBeenCalledWith(
      expect.stringContaining('mount_nfs'),
      expect.any(Object)
    );
  });

  it('sets error when NFS server fails to start', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);

    // Process exits immediately without emitting NFS ready
    proc.emit('close', 1);

    await startPromise;
    expect(mm.state).toBe('error');
  });

  it('sets error when mount_nfs fails', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);
    _deps.execSync.mockImplementation(() => { throw new Error('mount_nfs failed'); });

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);

    proc.stderr.emit('data', Buffer.from('NFS Server running at 127.0.0.1:9049'));

    await startPromise;
    expect(mm.state).toBe('error');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('sets error when mount verification (readdirSync) fails', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);
    _deps.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);

    proc.stderr.emit('data', Buffer.from('NFS Server running at 127.0.0.1:9049'));

    await startPromise;
    expect(mm.state).toBe('error');
  });

  it('stops gracefully by unmounting and killing process', async () => {
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);
    proc.stderr.emit('data', Buffer.from('NFS Server running at 127.0.0.1:9049'));
    await startPromise;

    const stopPromise = mm.stop();
    proc.emit('close', 0);
    await stopPromise;

    expect(mm.state).toBe('stopped');
    // Should have called umount
    expect(_deps.execSync).toHaveBeenCalledWith(
      expect.stringContaining('umount'),
      expect.any(Object)
    );
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('handles spawn error', async () => {
    vi.useFakeTimers();
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const states = [];
    mm.on('stateChange', (s) => states.push(s));

    const startPromise = mm.start(defaultOpts);
    proc.emit('error', new Error('spawn failed'));

    // Advance past the polling interval so the spawnErrored check fires
    vi.advanceTimersByTime(300);

    await startPromise;
    expect(states).toContain('error');
    vi.useRealTimers();
  });

  it('sets error state when restart attempt fails', async () => {
    vi.useFakeTimers();
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);

    // Advance timer so NFS ready check fires
    proc.stderr.emit('data', Buffer.from('NFS Server running at 127.0.0.1:9049'));
    vi.advanceTimersByTime(300);
    await startPromise;

    // Simulate rclone process crashing
    proc.emit('close', 1);

    // Now make findRclone return null so restart fails
    _deps.findRclone.mockReturnValue(null);

    // Advance past the restart delay (1s for first retry)
    vi.advanceTimersByTime(1100);

    await vi.waitFor(() => {
      expect(mm.state).toBe('error');
    });
    vi.useRealTimers();
  });

  it('reloads config on restart for fresh opts', async () => {
    vi.useFakeTimers();
    const proc = createFakeProcess();
    _deps.spawn.mockReturnValue(proc);

    const mm = new MountManager();
    const startPromise = mm.start(defaultOpts);

    proc.stderr.emit('data', Buffer.from('NFS Server running at 127.0.0.1:9049'));
    vi.advanceTimersByTime(300);
    await startPromise;

    // Simulate crash
    proc.emit('close', 1);

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
    vi.advanceTimersByTime(1100);

    await vi.waitFor(() => {
      expect(_deps.configLoad).toHaveBeenCalled();
    });
    vi.useRealTimers();
  });

  // FUSE-mode tests (non-macOS)
  describe('FUSE mode (non-macOS)', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    it('uses rclone mount on non-macOS', async () => {
      vi.useFakeTimers();
      const proc = createFakeProcess();
      _deps.spawn.mockReturnValue(proc);

      const mm = new MountManager();
      const startPromise = mm.start(defaultOpts);

      proc.stdout.emit('data', Buffer.from('Mounting on /tmp/test-mount'));

      await startPromise;
      expect(mm.state).toBe('mounted');

      // spawn should have been called with 'mount' subcommand
      const spawnArgs = _deps.spawn.mock.calls[0][1];
      expect(spawnArgs[0]).toBe('mount');
      vi.useRealTimers();
    });

    it('emits fuseError on FUSE-related stderr', async () => {
      vi.useFakeTimers();
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
      vi.useRealTimers();
    });
  });
});
