const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Check if a FUSE implementation is installed.
 * Returns { installed: bool, name: string|null, installUrl: string }
 */
function checkFuse() {
  if (process.platform === 'darwin') {
    return checkMacFuse();
  } else if (process.platform === 'win32') {
    return checkWinFsp();
  }
  // Linux usually has FUSE built in via kernel module
  return checkLinuxFuse();
}

function checkMacFuse() {
  // Check for macFUSE (kext-based)
  try {
    const kext = execSync('kextstat 2>/dev/null | grep -i macfuse', { encoding: 'utf8', timeout: 5000 });
    if (kext.trim()) {
      return { installed: true, name: 'macFUSE', installUrl: 'https://osxfuse.github.io/' };
    }
  } catch {
    // Not loaded
  }

  // Check for macFUSE via filesystem presence
  if (fs.existsSync('/Library/Filesystems/macfuse.fs') || fs.existsSync('/usr/local/lib/libfuse.dylib')) {
    return { installed: true, name: 'macFUSE', installUrl: 'https://osxfuse.github.io/' };
  }

  // Check for FUSE-T (newer, userspace-based alternative)
  if (fs.existsSync('/Library/Filesystems/fuse-t.fs') || fs.existsSync('/usr/local/lib/libfuse-t.dylib')) {
    return { installed: true, name: 'FUSE-T', installUrl: 'https://www.fuse-t.org/' };
  }

  // Check via homebrew
  try {
    const brew = execSync('brew list --cask 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
    if (brew.includes('macfuse')) {
      return { installed: true, name: 'macFUSE', installUrl: 'https://osxfuse.github.io/' };
    }
    if (brew.includes('fuse-t')) {
      return { installed: true, name: 'FUSE-T', installUrl: 'https://www.fuse-t.org/' };
    }
  } catch {
    // brew not available or failed
  }

  return {
    installed: false,
    name: null,
    installUrl: 'https://osxfuse.github.io/',
    installInstructions: [
      { label: 'macFUSE (recommended)', url: 'https://osxfuse.github.io/', command: 'brew install --cask macfuse' },
      { label: 'FUSE-T (alternative)', url: 'https://www.fuse-t.org/', command: 'brew install --cask fuse-t' },
    ],
  };
}

function checkWinFsp() {
  // Check WinFsp via registry
  try {
    const reg = execSync('reg query "HKLM\\SOFTWARE\\WinFsp" /v InstallDir 2>nul', { encoding: 'utf8', timeout: 5000 });
    if (reg.includes('InstallDir')) {
      return { installed: true, name: 'WinFsp', installUrl: 'https://winfsp.dev/' };
    }
  } catch {
    // Not in registry
  }

  // Check common install path
  const winfspDll = 'C:\\Program Files (x86)\\WinFsp\\bin\\winfsp-x64.dll';
  if (fs.existsSync(winfspDll)) {
    return { installed: true, name: 'WinFsp', installUrl: 'https://winfsp.dev/' };
  }

  return {
    installed: false,
    name: null,
    installUrl: 'https://winfsp.dev/',
    installInstructions: [
      { label: 'WinFsp', url: 'https://winfsp.dev/', command: 'winget install WinFsp.WinFsp' },
    ],
  };
}

function checkLinuxFuse() {
  // Check if fuse kernel module is available
  try {
    if (fs.existsSync('/dev/fuse')) {
      return { installed: true, name: 'FUSE', installUrl: null };
    }
    const modinfo = execSync('modinfo fuse 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    if (modinfo.includes('filename')) {
      return { installed: true, name: 'FUSE', installUrl: null };
    }
  } catch {
    // Module check failed
  }

  return {
    installed: false,
    name: null,
    installUrl: null,
    installInstructions: [
      { label: 'Install FUSE', command: 'sudo apt install fuse3  # or your distro equivalent' },
    ],
  };
}

module.exports = { checkFuse };
