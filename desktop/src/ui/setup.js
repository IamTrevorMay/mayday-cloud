const $ = (sel) => document.querySelector(sel);

let authResult = null;

// ─── Step navigation ───

function showStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  $(`#step-${id}`).classList.add('active');
}

// ─── Step 1: Login ───

$('#login-btn').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  const errorEl = $('#login-error');

  if (!email || !password) {
    errorEl.textContent = 'Please enter email and password';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  $('#login-btn').disabled = true;
  $('#login-btn').textContent = 'Signing in...';

  const result = await window.mayday.login(email, password);

  if (!result.success) {
    errorEl.textContent = result.error;
    errorEl.style.display = 'block';
    $('#login-btn').disabled = false;
    $('#login-btn').textContent = 'Sign In';
    return;
  }

  authResult = result;

  // Pre-fill default folder
  const homeDir = await getDefaultFolder();
  $('#folder-path').value = homeDir;

  showStep('folder');
});

// Allow Enter to submit login
$('#login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#login-btn').click();
});

$('#login-email').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#login-password').focus();
});

// ─── Step 1b: Studio Login ───

$('#show-studio-btn').addEventListener('click', () => {
  showStep('studio');
  $('#studio-email').focus();
});

$('#back-to-cloud').addEventListener('click', (e) => {
  e.preventDefault();
  showStep('login');
  $('#login-email').focus();
});

$('#studio-login-btn').addEventListener('click', async () => {
  const email = $('#studio-email').value.trim();
  const password = $('#studio-password').value;
  const errorEl = $('#studio-error');

  if (!email || !password) {
    errorEl.textContent = 'Please enter email and password';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  $('#studio-login-btn').disabled = true;
  $('#studio-login-btn').textContent = 'Signing in...';

  const result = await window.mayday.studioLogin(email, password);

  if (!result.success) {
    errorEl.textContent = result.error;
    errorEl.style.display = 'block';
    $('#studio-login-btn').disabled = false;
    $('#studio-login-btn').textContent = 'Sign in with Studio';
    return;
  }

  authResult = result;

  const homeDir = await getDefaultFolder();
  $('#folder-path').value = homeDir;

  showStep('folder');
});

$('#studio-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#studio-login-btn').click();
});

$('#studio-email').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#studio-password').focus();
});

// ─── Step 2: Folder picker ───

async function getDefaultFolder() {
  return '~/Mayday Cloud';
}

$('#pick-folder-btn').addEventListener('click', async () => {
  const folder = await window.mayday.pickFolder();
  if (folder) {
    $('#folder-path').value = folder;
  }
});

$('#next-to-remote-btn').addEventListener('click', async () => {
  let folderPath = $('#folder-path').value.trim();
  const errorEl = $('#folder-error');

  if (!folderPath) {
    errorEl.textContent = 'Please choose a folder';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  showStep('remote-folders');
  loadRemoteFolders();
});

// ─── Step 3: Remote folder selection ───

$('#sync-all-check').addEventListener('change', (e) => {
  const container = $('#folder-tree-container');
  if (e.target.checked) {
    container.style.display = 'none';
  } else {
    container.style.display = 'block';
    // Load tree if not already loaded
    if ($('#folder-tree').querySelector('.folder-tree-loading')) {
      loadRemoteFolders();
    }
  }
});

function getTempConfig() {
  if (!authResult) return undefined;
  return { apiUrl: authResult.apiUrl, apiKey: authResult.apiKey };
}

async function loadRemoteFolders() {
  const tree = $('#folder-tree');

  try {
    tree.innerHTML = '<div class="folder-tree-loading">Loading folders...</div>';
    const items = await window.mayday.listRemote('', getTempConfig());
    tree.innerHTML = '';

    if (!items || items.length === 0) {
      tree.innerHTML = '<div class="folder-tree-empty">No folders found</div>';
      return;
    }

    // Show only directories at the top level
    const dirs = (items.items || items).filter(i => i.type === 'directory');

    if (dirs.length === 0) {
      tree.innerHTML = '<div class="folder-tree-empty">No folders found</div>';
      return;
    }

    for (const dir of dirs) {
      tree.appendChild(createFolderNode(dir.name, dir.name));
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
  expander.textContent = '\u25B6'; // right triangle

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'folder-check';
  checkbox.dataset.path = name; // relPath from root (no leading /)

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

  // Check parent → check all children
  checkbox.addEventListener('change', () => {
    const childChecks = children.querySelectorAll('.folder-check');
    childChecks.forEach(c => { c.checked = checkbox.checked; });
  });

  // Click expander to expand/collapse
  expander.addEventListener('click', async () => {
    if (children.style.display === 'none') {
      children.style.display = 'block';
      expander.textContent = '\u25BC'; // down triangle

      if (!loaded) {
        loaded = true;
        children.innerHTML = '<div class="folder-tree-loading" style="padding-left:24px">Loading...</div>';

        try {
          const items = await window.mayday.listRemote(remotePath, getTempConfig());
          const dirs = (items.items || items).filter(i => i.type === 'directory');
          children.innerHTML = '';

          for (const dir of dirs) {
            const childPath = remotePath + '/' + dir.name;
            const childRel = name + '/' + dir.name;
            const childNode = createFolderNode(childRel, childPath);
            children.appendChild(childNode);

            // Inherit parent checked state
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

  // Click label also toggles expander
  label.addEventListener('click', () => expander.click());

  return node;
}

function getSelectedFolders() {
  const checks = document.querySelectorAll('#folder-tree .folder-check:checked');
  const paths = [];
  for (const c of checks) {
    paths.push(c.dataset.path);
  }

  // Remove children whose parent is already selected
  // (if "photos" is checked, no need for "photos/2024")
  const filtered = [];
  for (const p of paths) {
    const isChild = paths.some(other => other !== p && p.startsWith(other + '/'));
    if (!isChild) filtered.push(p);
  }
  return filtered;
}

// ─── Start sync button ───

$('#start-sync-btn').addEventListener('click', async () => {
  let folderPath = $('#folder-path').value.trim();
  const errorEl = $('#remote-error');

  const syncAll = $('#sync-all-check').checked;
  const syncFolders = syncAll ? [] : getSelectedFolders();
  const syncMode = 'bidirectional';

  if (!syncAll && syncFolders.length === 0) {
    errorEl.textContent = 'Please select at least one folder, or check "Sync everything"';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  $('#start-sync-btn').disabled = true;
  $('#start-sync-btn').textContent = 'Setting up...';

  const result = await window.mayday.completeSetup({
    apiUrl: authResult.apiUrl,
    apiKey: authResult.apiKey,
    localFolder: folderPath,
    email: authResult.email,
    syncMode,
    syncFolders,
  });

  if (!result.success) {
    errorEl.textContent = result.error;
    errorEl.style.display = 'block';
    $('#start-sync-btn').disabled = false;
    $('#start-sync-btn').textContent = 'Start Syncing';
    return;
  }

  showStep('done');

  // Close setup window after a moment
  setTimeout(() => {
    window.close();
  }, 3000);
});
