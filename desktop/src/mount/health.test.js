import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { MountHealthMonitor, _deps } = require('./health');

let origDeps;

beforeEach(() => {
  origDeps = { ..._deps };
  _deps.accessSync = vi.fn();
  _deps.readdirSync = vi.fn(() => []);
  vi.useFakeTimers();
});

afterEach(() => {
  Object.assign(_deps, origDeps);
  vi.useRealTimers();
});

describe('MountHealthMonitor', () => {
  it('starts in stopped state', () => {
    const monitor = new MountHealthMonitor();
    expect(monitor.running).toBe(false);
  });

  it('sets running to true after start', () => {
    const monitor = new MountHealthMonitor(1000);
    monitor.start('/mnt/test');
    expect(monitor.running).toBe(true);
    monitor.stop();
  });

  it('emits healthCheckFailed when mount is inaccessible', () => {
    _deps.accessSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const monitor = new MountHealthMonitor(1000);
    const errors = [];
    monitor.on('healthCheckFailed', (e) => errors.push(e));

    monitor.start('/mnt/test');
    vi.advanceTimersByTime(1000);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ENOENT/);
    monitor.stop();
  });

  it('emits healthCheckFailed when readdirSync fails', () => {
    _deps.accessSync.mockImplementation(() => {});
    _deps.readdirSync.mockImplementation(() => { throw new Error('Permission denied'); });

    const monitor = new MountHealthMonitor(1000);
    const errors = [];
    monitor.on('healthCheckFailed', (e) => errors.push(e));

    monitor.start('/mnt/test');
    vi.advanceTimersByTime(1000);

    expect(errors).toHaveLength(1);
    monitor.stop();
  });

  it('does not emit when mount is healthy', () => {
    const monitor = new MountHealthMonitor(1000);
    const errors = [];
    monitor.on('healthCheckFailed', (e) => errors.push(e));

    monitor.start('/mnt/test');
    vi.advanceTimersByTime(3000);

    expect(errors).toHaveLength(0);
    monitor.stop();
  });

  it('stops monitoring after stop() is called', () => {
    _deps.accessSync.mockImplementation(() => { throw new Error('fail'); });

    const monitor = new MountHealthMonitor(1000);
    const errors = [];
    monitor.on('healthCheckFailed', (e) => errors.push(e));

    monitor.start('/mnt/test');
    vi.advanceTimersByTime(1000);
    expect(errors).toHaveLength(1);

    monitor.stop();
    expect(monitor.running).toBe(false);

    vi.advanceTimersByTime(5000);
    // No more errors after stop
    expect(errors).toHaveLength(1);
  });
});
