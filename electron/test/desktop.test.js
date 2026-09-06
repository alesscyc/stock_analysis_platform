'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { resolvePaths, buildBackendEnv, BACKEND_PORT, PYTHON_PORT } = require('../desktop-paths');

const execDir = __dirname;
const userDataDir = 'C:\\Users\\Test\\AppData\\Roaming\\Stock Analysis Platform';

describe('desktop-paths (packaged mode)', () => {
  const paths = resolvePaths({
    isPackaged: true,
    resourcesPath: 'C:\\Stock Platform\\resources',
    execDir,
  });

  it('points the backend at the bundled resources', () => {
    assert.equal(paths.mode, 'packaged');
    assert.equal(paths.backendDir, path.join('C:\\Stock Platform\\resources', 'backend'));
    assert.equal(paths.backendEntry, path.join('C:\\Stock Platform\\resources', 'backend', 'server.js'));
  });

  it('points at the PyInstaller analysis-service.exe', () => {
    assert.equal(
      paths.analysisServiceExe,
      path.join('C:\\Stock Platform\\resources', 'analysis-service', 'analysis-service', 'analysis-service.exe')
    );
  });

  it('loads the UI from the bundled Express server', () => {
    assert.equal(paths.frontendUrl, `http://127.0.0.1:${BACKEND_PORT}/`);
  });

  it('sets node-mode, desktop-mode, bundled python, and userData paths', () => {
    const baseEnv = { PATH: 'C:\\bin', PYTHON_SERVICE_URL: 'http://remote.example:9000' };
    const env = buildBackendEnv(paths, baseEnv, userDataDir);
    assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(env.DESKTOP_MODE, '1');
    assert.equal(env.BIND_HOST, '127.0.0.1');
    assert.equal(env.PYTHON_SERVICE_EXE, paths.analysisServiceExe);
    assert.equal(env.PYTHON_SERVICE_URL, `http://127.0.0.1:${PYTHON_PORT}`);
    assert.equal(baseEnv.PYTHON_SERVICE_URL, 'http://remote.example:9000');
    assert.equal(env.ENV_FILE, path.join(userDataDir, '.env'));
    assert.equal(env.MODEL_CACHE_DIR, path.join(userDataDir, 'model_cache'));
    assert.equal(env.PATH, 'C:\\bin');
  });
});

describe('desktop-paths (dev mode)', () => {
  const paths = resolvePaths({
    isPackaged: false,
    resourcesPath: '',
    execDir,
  });

  it('points the backend at the repo backend/ folder', () => {
    assert.equal(paths.mode, 'dev');
    assert.equal(paths.backendDir, path.resolve(execDir, '..', 'backend'));
    assert.equal(paths.backendEntry, path.resolve(execDir, '..', 'backend', 'server.js'));
  });

  it('does not use a bundled analysis service in dev', () => {
    assert.equal(paths.analysisServiceExe, null);
  });

  it('keeps dev backend on defaults (web workflow untouched)', () => {
    const env = buildBackendEnv(paths, {}, userDataDir);
    assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
    for (const key of ['DESKTOP_MODE', 'BIND_HOST', 'PYTHON_SERVICE_EXE', 'ENV_FILE', 'MODEL_CACHE_DIR']) {
      assert.equal(key in env, false, `dev env must not set ${key}`);
    }
  });
});

describe('desktop constants', () => {
  it('backend and analysis ports are stable for the BrowserWindow URL', () => {
    assert.equal(BACKEND_PORT, 3001);
    assert.equal(PYTHON_PORT, 8000);
  });
});

it('sandboxes the window and blocks external navigation and popups', async () => {
  let window;
  let probes = 0;
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      window = this;
    }
    loadURL() {}
    on() {}
  }
  const desktop = {
    app: {
      requestSingleInstanceLock: () => true,
      on() {},
      whenReady: () => Promise.resolve(),
      getPath: () => userDataDir,
    },
    BrowserWindow: FakeWindow,
    dialog: { showErrorBox() { assert.fail('Unexpected startup error'); } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
    __dirname: path.join(__dirname, '..'),
    require(name) {
      if (name === 'electron') return desktop;
      if (name === 'child_process') return { spawn: () => new EventEmitter() };
      if (name === 'fs') return { mkdirSync() {} };
      if (name === './desktop-paths') return require('../desktop-paths');
      throw new Error(`Unexpected require: ${name}`);
    },
    process: { env: {}, execPath: 'electron.exe' },
    fetch: async () => ({ ok: ++probes > 2 }),
    AbortSignal, URL, console, setTimeout,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.openHandler().action, 'deny');
  for (const eventName of ['will-navigate', 'will-redirect']) {
    for (const [url, blocked] of [
      [`http://127.0.0.1:${BACKEND_PORT}/`, false],
      [`http://127.0.0.1:${BACKEND_PORT}/chart?symbol=AAPL`, false],
      ['https://external.example/', true],
      ['http://127.0.0.1:9000/', true],
      ['file:///C:/test.html', true],
      ['not a valid URL', true],
    ]) {
      let prevented = false;
      const event = { preventDefault() { prevented = true; } };
      assert.doesNotThrow(() => window.webContents.emit(eventName, event, url));
      assert.equal(prevented, blocked, `${eventName}: ${url}`);
    }
  }
});
