const fs = require('fs');
const api = require('./api');
const db = require('./db');
const logger = require('./logger');
const { SyncEngine } = require('./sync-engine');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
  vi.spyOn(api, 'mkdirRemote').mockResolvedValue();
  vi.spyOn(db, 'upsertFile').mockImplementation(() => {});
  vi.spyOn(db, 'markSyncing').mockImplementation(() => {});
  vi.spyOn(db, 'markSynced').mockImplementation(() => {});
  vi.spyOn(db, 'markError').mockImplementation(() => {});
  vi.spyOn(db, 'removeFile').mockImplementation(() => {});
  vi.spyOn(db, 'logAction').mockImplementation(() => {});
});

describe('SyncEngine', () => {
  describe('_handleAddChange deduplication', () => {
    it('skips enqueue when file is already queued', async () => {
      const engine = new SyncEngine({
        localFolder: '/local',
        remoteFolder: '/remote',
        apiKey: 'k',
        apiUrl: 'http://localhost:4000',
      });
      engine.running = true;

      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100, mtimeMs: 1000 });

      // Pre-fill queue to simulate startup sync having enqueued this file
      engine.queue.active = 3; // block processing
      engine.queue.queue.push({ localRoot: '/local', relPath: 'photo.jpg', size: 100, attempt: 0 });

      await engine._handleAddChange('photo.jpg', '/local/photo.jpg');

      expect(db.upsertFile).not.toHaveBeenCalled();
    });

    it('skips enqueue when file is actively uploading', async () => {
      const engine = new SyncEngine({
        localFolder: '/local',
        remoteFolder: '/remote',
        apiKey: 'k',
        apiUrl: 'http://localhost:4000',
      });
      engine.running = true;

      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100, mtimeMs: 1000 });

      engine.queue.activeUploads.set('photo.jpg', {});

      await engine._handleAddChange('photo.jpg', '/local/photo.jpg');

      expect(db.upsertFile).not.toHaveBeenCalled();
    });

    it('enqueues when file is not in queue', async () => {
      const engine = new SyncEngine({
        localFolder: '/local',
        remoteFolder: '/remote',
        apiKey: 'k',
        apiUrl: 'http://localhost:4000',
      });
      engine.running = true;

      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100, mtimeMs: 1000 });
      vi.spyOn(api, 'uploadSmall').mockResolvedValue({});

      // Block processing so we can inspect the queue
      engine.queue.active = 3;

      await engine._handleAddChange('new.txt', '/local/new.txt');

      expect(db.upsertFile).toHaveBeenCalledWith('new.txt', 100, 1000, 'pending');
    });

    it('handles ENOENT from statSync gracefully', async () => {
      const engine = new SyncEngine({
        localFolder: '/local',
        remoteFolder: '/remote',
        apiKey: 'k',
        apiUrl: 'http://localhost:4000',
      });
      engine.running = true;

      vi.spyOn(fs, 'statSync').mockImplementation(() => {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      });

      await engine._handleAddChange('deleted.txt', '/local/deleted.txt');

      expect(db.upsertFile).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error handling file'));
    });
  });
});
