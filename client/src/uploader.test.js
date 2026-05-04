const path = require('path');
const api = require('./api');
const db = require('./db');
const logger = require('./logger');
const { UploadQueue } = require('./uploader');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
});

describe('UploadQueue', () => {
  describe('has()', () => {
    it('returns false for empty queue', () => {
      const q = new UploadQueue({ apiKey: 'k' }, '/remote');
      expect(q.has('file.txt')).toBe(false);
    });

    it('returns true for queued upload', () => {
      const q = new UploadQueue({ apiKey: 'k' }, '/remote');
      q.active = 3; // prevent auto-processing
      q.queue.push({ localRoot: '/local', relPath: 'file.txt', size: 100, attempt: 0 });
      expect(q.has('file.txt')).toBe(true);
    });

    it('returns false for queued delete (different semantics)', () => {
      const q = new UploadQueue({ apiKey: 'k' }, '/remote');
      q.active = 3;
      q.queue.push({ relPath: 'file.txt', isDelete: true, attempt: 0 });
      expect(q.has('file.txt')).toBe(false);
    });

    it('returns true for actively uploading file', () => {
      const q = new UploadQueue({ apiKey: 'k' }, '/remote');
      q.activeUploads.set('file.txt', {});
      expect(q.has('file.txt')).toBe(true);
    });
  });

  describe('ENOENT handling in _processUpload', () => {
    it('skips retries and removes from DB on ENOENT', async () => {
      vi.spyOn(db, 'markSyncing').mockImplementation(() => {});
      vi.spyOn(db, 'removeFile').mockImplementation(() => {});
      vi.spyOn(db, 'markError').mockImplementation(() => {});
      vi.spyOn(db, 'logAction').mockImplementation(() => {});
      vi.spyOn(api, 'uploadSmall').mockRejectedValue(
        Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      );

      const q = new UploadQueue({ apiKey: 'k' }, '/remote');
      const job = { localRoot: '/local', relPath: 'gone.txt', size: 100, attempt: 0 };

      await q._processUpload(job);

      expect(db.removeFile).toHaveBeenCalledWith('gone.txt');
      expect(db.markError).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('File vanished'));
    });

    it('skips retries on ENOENT in error message (no code)', async () => {
      vi.spyOn(db, 'markSyncing').mockImplementation(() => {});
      vi.spyOn(db, 'removeFile').mockImplementation(() => {});
      vi.spyOn(db, 'markError').mockImplementation(() => {});
      vi.spyOn(db, 'logAction').mockImplementation(() => {});
      vi.spyOn(api, 'uploadSmall').mockRejectedValue(
        new Error('ENOENT: no such file or directory')
      );

      const q = new UploadQueue({ apiKey: 'k' }, '/remote');
      const job = { localRoot: '/local', relPath: 'gone.txt', size: 100, attempt: 0 };

      await q._processUpload(job);

      expect(db.removeFile).toHaveBeenCalledWith('gone.txt');
      expect(job.attempt).toBe(0); // not incremented
    });

    it('retries non-ENOENT errors normally', async () => {
      vi.spyOn(db, 'markSyncing').mockImplementation(() => {});
      vi.spyOn(db, 'removeFile').mockImplementation(() => {});
      vi.spyOn(db, 'markError').mockImplementation(() => {});
      vi.spyOn(db, 'logAction').mockImplementation(() => {});
      vi.spyOn(api, 'uploadSmall').mockRejectedValue(new Error('Network timeout'));

      const q = new UploadQueue({ apiKey: 'k' }, '/remote');
      q.active = 3; // prevent _tick from processing retries
      const job = { localRoot: '/local', relPath: 'net.txt', size: 100, attempt: 0 };

      await q._processUpload(job);

      expect(db.removeFile).not.toHaveBeenCalled();
      expect(job.attempt).toBe(1);
    });
  });
});
