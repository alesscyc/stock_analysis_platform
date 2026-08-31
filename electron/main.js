'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const { resolvePaths, buildBackendEnv, BACKEND_PORT, PYTHON_PORT } = require('./desktop-paths');

const BACKEND_ROOT = `http://127.0.0.1:${BACKEND_PORT}/api/ib/status`;
const PYTHON_HEALTH = `http://127.0.0.1:${PYTHON_PORT}/health`;

let mainWindow = null;
let backendChild = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  async function probeUrl(url, timeoutMs = 1500) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  async function waitForUrl(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await probeUrl(url)) return true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  function showFatalError(message) {
    dialog.showErrorBox('Stock Analysis Platform could not start', message);
  }

  // On Windows, child.kill() force-terminates without running the child's
  // SIGTERM handler, orphaning the analysis service. taskkill /T kills the
  // whole tree (Express -> Python service) so both stop with the app.
  // Runs synchronously so the app is fully torn down before it quits.
  function killProcessTreeSync(pid) {
    if (!pid) return;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } catch (_) {}
    } else {
      try { process.kill(pid, 'SIGTERM'); } catch (_) {}
    }
  }

  // Spawn our own Express backend. An existing process on the port is never
  // adopted: if the port is occupied the child exits and this resolves false.
  async function startBackend(paths, userDataDir) {
    if (await probeUrl(BACKEND_ROOT) || await probeUrl(PYTHON_HEALTH)) {
      console.error('[desktop] Required port is already occupied; refusing to adopt another process.');
      return false;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };

      backendChild = spawn(process.execPath, [paths.backendEntry], {
        cwd: paths.backendDir,
        env: buildBackendEnv(paths, process.env, userDataDir),
        stdio: 'inherit',
        windowsHide: true,
      });

      backendChild.on('error', (err) => {
        console.error('[desktop] Failed to start backend:', err.message);
        finish(false);
      });

      backendChild.on('exit', (code) => {
        if (!settled) {
          console.error(`[desktop] Backend exited before becoming ready (code ${code}). Port ${BACKEND_PORT} may be in use.`);
          finish(false);
        }
      });

      waitForUrl(BACKEND_ROOT, 30000).then(finish);
    });
  }

  function createWindow(paths) {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    mainWindow.loadURL(paths.frontendUrl);
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    if (backendChild) {
      killProcessTreeSync(backendChild.pid);
    }
  });

  app.whenReady().then(async () => {
    const paths = resolvePaths({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      execDir: __dirname,
    });
    const userDataDir = app.getPath('userData');
    fs.mkdirSync(userDataDir, { recursive: true });

    const backendUp = await startBackend(paths, userDataDir);
    if (!backendUp) {
      showFatalError(
        `The Express backend did not start on port ${BACKEND_PORT}.\n\n` +
        `Another process may already be using port ${BACKEND_PORT} or ${PYTHON_PORT}. ` +
        'Close it and try again.'
      );
      app.quit();
      return;
    }

    const pythonUp = await waitForUrl(PYTHON_HEALTH, 45000);
    if (!pythonUp) {
      showFatalError(
        `The analysis service did not become ready on port ${PYTHON_PORT}. ` +
        `Another process may already be using it. Close it and try again.`
      );
      app.quit();
      return;
    }

    createWindow(paths);
  });
}
