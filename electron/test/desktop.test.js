'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
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
    const env = buildBackendEnv(paths, { PATH: 'C:\\bin' }, userDataDir);
    assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(env.DESKTOP_MODE, '1');
    assert.equal(env.BIND_HOST, '127.0.0.1');
    assert.equal(env.PYTHON_SERVICE_EXE, paths.analysisServiceExe);
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