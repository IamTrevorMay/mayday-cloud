const $ = (sel) => document.querySelector(sel);

let isPaused = false;

// ─── Update display ───

function updateStatus(status) {
  const dot = $('#status-dot');
  const text = $('#status-text');
  const sub = $('#status-sub');

  if (status.state === 'not_configured') {
    dot.className = 'status-dot paused';
    text.textContent = 'Not configured';
    sub.textContent = 'Click to set up';
    return;
  }

  const counts = status.counts || {};
  const pending = (counts.pending || 0) + (counts.syncing || 0);

  if (status.paused) {
    dot.className = 'status-dot paused';
    text.textContent = 'Paused';
    sub.textContent = '';
    isPaused = true;
    $('#pause-btn').textContent = 'Resume';
  } else if (pending > 0) {
    dot.className = 'status-dot syncing';
    text.textContent = `Syncing ${pending} file${pending !== 1 ? 's' : ''}...`;
    sub.textContent = status.currentFile || '';
    isPaused = false;
    $('#pause-btn').textContent = 'Pause';
  } else if ((counts.error || 0) > 0) {
    dot.className = 'status-dot error';
    text.textContent = `${counts.error} file${counts.error !== 1 ? 's' : ''} failed`;
    sub.textContent = '';
    isPaused = false;
    $('#pause-btn').textContent = 'Pause';
  } else {
    dot.className = 'status-dot idle';
    text.textContent = 'All files synced';
    sub.textContent = '';
    isPaused = false;
    $('#pause-btn').textContent = 'Pause';
  }

  // Update counts
  $('#count-synced').textContent = counts.synced || 0;
  $('#count-pending').textContent = counts.pending || 0;
  $('#count-syncing').textContent = counts.syncing || 0;
  $('#count-errors').textContent = counts.error || 0;

  // Update logs
  if (status.recentLogs) {
    const logList = $('#log-list');
    logList.innerHTML = '';
    for (const log of status.recentLogs) {
      const el = document.createElement('div');
      el.className = 'log-entry';
      const filename = log.rel_path ? log.rel_path.split('/').pop() : '';
      el.innerHTML = `<span class="log-action">${log.action}</span> ${filename}`;
      logList.appendChild(el);
    }
    if (status.recentLogs.length === 0) {
      logList.innerHTML = '<div class="log-entry" style="color:rgba(255,255,255,0.3)">No activity yet</div>';
    }
  }
}

// ─── Initial load ───

async function refresh() {
  const status = await window.mayday.getStatus();
  updateStatus(status);
}

refresh();

// Refresh every 3 seconds
setInterval(refresh, 3000);

// ─── Push updates from main process ───

window.mayday.onStatusUpdate((status) => {
  // Merge push update with a full refresh
  refresh();
});

// ─── Actions ───

$('#open-folder-btn').addEventListener('click', () => {
  window.mayday.openSyncFolder();
});

$('#pause-btn').addEventListener('click', async () => {
  if (isPaused) {
    await window.mayday.resume();
  } else {
    await window.mayday.pause();
  }
  // Refresh after a tick
  setTimeout(refresh, 500);
});
