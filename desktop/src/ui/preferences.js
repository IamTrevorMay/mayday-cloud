const $ = (sel) => document.querySelector(sel);

let currentSyncFolders = [];

// ─── Load current config state ───

(async function init() {
  const status = await window.mayday.getStatus();

  // Determine current sync folder state from status
  // We'll load the folder tree and check the appropriate boxes
  await loadRemoteFolders();

  // Check "sync all" if no specific folders are configured
  // (The main process will tell us via status, but we check the tree state)
})();

$('#sync-all-check').addEventListener('change', (e) => {
  const container = $('#folder-tree-container');
  if (e.target.checked) {
    container.style.display = 'none';
  } else {
    container.style.display = 'block';
  }
});

async function loadRemoteFolders() {
  const tree = $('#folder-tree');

  try {
    tree.innerHTML = '<div class="folder-tree-loading">Loading folders...</div>';
    const items = await window.mayday.listRemote('/');
    tree.innerHTML = '';

    const dirs = (items.items || items).filter(i => i.type === 'directory');

    if (dirs.length === 0) {
      tree.innerHTML = '<div class="folder-tree-empty">No folders found</div>';
      return;
    }

    for (const dir of dirs) {
      tree.appendChild(createFolderNode(dir.name, '/' + dir.name));
    }
  } catch (err) {
    tree.innerHTML = `<div class="folder-tree-empty">Failed to load: ${err.message}</div>`;
  }
}

function createFolderNode(name, remotePath) {
  const node = document.createElement('div');
  node.className = 'folder-node';

  const row = document.createElement('div');
  row.className = 'folder-row';

  const expander = document.createElement('span');
  expander.className = 'folder-expander';
  expander.textContent = '\u25B6';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'folder-check';
  checkbox.dataset.path = name;

  const label = document.createElement('span');
  label.className = 'folder-label';
  label.textContent = name.split('/').pop();

  row.appendChild(expander);
  row.appendChild(checkbox);
  row.appendChild(label);
  node.appendChild(row);

  const children = document.createElement('div');
  children.className = 'folder-children';
  children.style.display = 'none';
  node.appendChild(children);

  let loaded = false;

  checkbox.addEventListener('change', () => {
    const childChecks = children.querySelectorAll('.folder-check');
    childChecks.forEach(c => { c.checked = checkbox.checked; });
  });

  expander.addEventListener('click', async () => {
    if (children.style.display === 'none') {
      children.style.display = 'block';
      expander.textContent = '\u25BC';

      if (!loaded) {
        loaded = true;
        children.innerHTML = '<div class="folder-tree-loading" style="padding-left:24px">Loading...</div>';

        try {
          const items = await window.mayday.listRemote(remotePath);
          const dirs = (items.items || items).filter(i => i.type === 'directory');
          children.innerHTML = '';

          for (const dir of dirs) {
            const childPath = remotePath + '/' + dir.name;
            const childRel = name + '/' + dir.name;
            const childNode = createFolderNode(childRel, childPath);
            children.appendChild(childNode);

            if (checkbox.checked) {
              childNode.querySelector('.folder-check').checked = true;
            }
          }

          if (dirs.length === 0) {
            children.innerHTML = '<div class="folder-tree-empty" style="padding-left:24px">No subfolders</div>';
          }
        } catch (err) {
          children.innerHTML = `<div class="folder-tree-empty" style="padding-left:24px">Error: ${err.message}</div>`;
        }
      }
    } else {
      children.style.display = 'none';
      expander.textContent = '\u25B6';
    }
  });

  label.addEventListener('click', () => expander.click());

  return node;
}

function getSelectedFolders() {
  const checks = document.querySelectorAll('#folder-tree .folder-check:checked');
  const paths = [];
  for (const c of checks) {
    paths.push(c.dataset.path);
  }

  const filtered = [];
  for (const p of paths) {
    const isChild = paths.some(other => other !== p && p.startsWith(other + '/'));
    if (!isChild) filtered.push(p);
  }
  return filtered;
}

$('#save-btn').addEventListener('click', async () => {
  const statusEl = $('#save-status');
  const syncAll = $('#sync-all-check').checked;
  const folders = syncAll ? [] : getSelectedFolders();

  if (!syncAll && folders.length === 0) {
    statusEl.textContent = 'Please select at least one folder, or check "Sync everything"';
    statusEl.style.display = 'block';
    statusEl.style.color = '#fca5a5';
    return;
  }

  $('#save-btn').disabled = true;
  $('#save-btn').textContent = 'Saving...';

  try {
    const result = await window.mayday.updateSyncFolders(folders);

    if (result.success) {
      statusEl.textContent = 'Saved! Sync restarting with new folders.';
      statusEl.style.display = 'block';
      statusEl.style.color = '#4ade80';

      setTimeout(() => {
        window.close();
      }, 2000);
    } else {
      statusEl.textContent = result.error || 'Failed to save';
      statusEl.style.display = 'block';
      statusEl.style.color = '#fca5a5';
    }
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.display = 'block';
    statusEl.style.color = '#fca5a5';
  }

  $('#save-btn').disabled = false;
  $('#save-btn').textContent = 'Save';
});
