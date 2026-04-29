const path = require('path');
const api = require('./api');
const logger = require('./logger');

const MAX_CONCURRENCY = 3;

/**
 * Scan remote folders via API, returning flat list of files.
 * Output format matches local scanner: [{ relPath, size, mtimeMs }]
 *
 * @param {object} config - API config (apiUrl, apiKey)
 * @param {string[]} syncFolders - folders to scan (relative to remoteFolder), empty = scan root
 * @param {string} remoteFolder - base remote path (e.g. '/')
 */
async function scanRemote(config, syncFolders, remoteFolder) {
  const results = [];
  // API expects relative paths (empty string for root, not '/')
  const apiRoot = (remoteFolder === '/') ? '' : remoteFolder;
  const roots = syncFolders.length > 0
    ? syncFolders.map(f => apiRoot ? path.posix.join(apiRoot, f) : f)
    : [apiRoot];

  const dirQueue = roots.map((r, i) => ({
    remotePath: r,
    prefix: syncFolders.length > 0 ? syncFolders[i] : '',
  }));

  let idx = 0;
  let active = 0;
  let resolve;
  const done = new Promise(r => { resolve = r; });

  function trySchedule() {
    while (active < MAX_CONCURRENCY && idx < dirQueue.length) {
      const item = dirQueue[idx++];
      active++;
      processDir(item);
    }
    if (active === 0 && idx >= dirQueue.length) {
      resolve();
    }
  }

  async function processDir(item) {
    try {
      const listing = await api.listRemote(config, item.remotePath);
      const items = listing.items || listing;

      for (const entry of items) {
        const relPath = item.prefix ? path.posix.join(item.prefix, entry.name) : entry.name;

        if (entry.type === 'directory') {
          dirQueue.push({
            remotePath: path.posix.join(item.remotePath, entry.name),
            prefix: relPath,
          });
        } else {
          results.push({
            relPath,
            size: entry.size || 0,
            mtimeMs: entry.modified ? new Date(entry.modified).getTime() : 0,
          });
        }
      }
    } catch (err) {
      logger.warn(`Remote scan error for ${item.remotePath}: ${err.message}`);
    } finally {
      active--;
      trySchedule();
    }
  }

  trySchedule();
  await done;

  logger.info(`Remote scan complete: ${results.length} files found`);
  return results;
}

module.exports = { scanRemote };
