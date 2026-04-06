const fs = require('fs');
const path = require('path');
const { Upload } = require('tus-js-client');
const logger = require('./logger');

const TUS_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

function headers(config) {
  return { Authorization: `Bearer ${config.apiKey}` };
}

async function checkHealth(config) {
  const res = await fetch(`${config.apiUrl}/api/nas/health`, { headers: headers(config) });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

async function listRemote(config, remotePath) {
  const url = new URL(`${config.apiUrl}/api/nas/list`);
  url.searchParams.set('path', remotePath);
  const res = await fetch(url, { headers: headers(config) });
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  return res.json();
}

async function mkdirRemote(config, remotePath) {
  const res = await fetch(`${config.apiUrl}/api/nas/mkdir`, {
    method: 'POST',
    headers: { ...headers(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: remotePath }),
  });
  if (!res.ok) {
    const text = await res.text();
    // Ignore "already exists" errors
    if (res.status === 409 || text.includes('already exists') || text.includes('EEXIST')) return;
    throw new Error(`Mkdir failed (${res.status}): ${text}`);
  }
}

async function uploadSmall(config, localPath, remoteDirPath) {
  const fileBuffer = fs.readFileSync(localPath);
  const fileName = path.basename(localPath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), fileName);
  formData.append('path', remoteDirPath);

  const res = await fetch(`${config.apiUrl}/api/nas/upload`, {
    method: 'POST',
    headers: headers(config),
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return res.json();
}

function uploadTus(config, localPath, remoteDirPath, callbacks = {}) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(localPath);
    const fileSize = fs.statSync(localPath).size;
    const fileName = path.basename(localPath);

    const upload = new Upload(fileStream, {
      endpoint: `${config.apiUrl}/api/nas/tus`,
      chunkSize: TUS_CHUNK_SIZE,
      retryDelays: [0, 1000, 3000, 5000],
      uploadSize: fileSize,
      metadata: {
        filename: fileName,
        targetPath: remoteDirPath,
      },
      headers: headers(config),
      onProgress: (bytesUploaded, bytesTotal) => {
        const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(1);
        if (callbacks.onProgress) callbacks.onProgress(bytesUploaded, bytesTotal, pct);
      },
      onSuccess: () => resolve(),
      onError: (err) => reject(err),
    });

    // Allow caller to abort
    if (callbacks.onUploadCreated) callbacks.onUploadCreated(upload);

    upload.findPreviousUploads().then((prev) => {
      if (prev.length > 0) upload.resumeUpload(prev[0]);
      else upload.start();
    });
  });
}

async function deleteRemote(config, remotePath) {
  const res = await fetch(`${config.apiUrl}/api/nas/delete`, {
    method: 'DELETE',
    headers: { ...headers(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: remotePath }),
  });
  if (!res.ok) {
    const text = await res.text();
    // Ignore "not found" — file may already be gone
    if (res.status === 404) return;
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }
}

module.exports = {
  checkHealth, listRemote, mkdirRemote,
  uploadSmall, uploadTus, deleteRemote,
  SMALL_FILE_THRESHOLD,
};
