'use strict';

const path = require('path');

const BACKEND_PORT = 3001;
const PYTHON_PORT = 8000;

const PYTHON_SCRIPT_REL = ['analysis', 'stock_data.py'];
const ANALYSIS_EXE_REL = ['analysis-service', 'analysis-service', 'analysis-service.exe'];

function resolvePaths({ isPackaged, resourcesPath, execDir }) {
  if (isPackaged) {
    return {
      mode: 'packaged',
      backendDir: path.join(resourcesPath, 'backend'),
      backendEntry: path.join(resourcesPath, 'backend', 'server.js'),
      analysisServiceExe: path.join(resourcesPath, ...ANALYSIS_EXE_REL),
      frontendUrl: `http://127.0.0.1:${BACKEND_PORT}/`,
    };
  }

  const repoRoot = path.resolve(execDir, '..');
  return {
    mode: 'dev',
    backendDir: path.join(repoRoot, 'backend'),
    backendEntry: path.join(repoRoot, 'backend', 'server.js'),
    analysisServiceExe: null,
    frontendUrl: `http://127.0.0.1:${BACKEND_PORT}/`,
  };
}

// Builds the environment for the spawned Express child. ELECTRON_RUN_AS_NODE
// lets the packaged Electron binary act as a plain Node process, so users do
// not need Node installed. In desktop mode the app binds loopback, disables the
// permissive CORS, and routes settings/model cache into Electron's userData.
function buildBackendEnv(paths, baseEnv, userDataDir) {
  const env = { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' };
  if (paths.mode === 'packaged') {
    env.DESKTOP_MODE = '1';
    env.BIND_HOST = '127.0.0.1';
    env.PYTHON_SERVICE_EXE = paths.analysisServiceExe;
    env.ENV_FILE = path.join(userDataDir, '.env');
    env.MODEL_CACHE_DIR = path.join(userDataDir, 'model_cache');
  }
  return env;
}

module.exports = {
  BACKEND_PORT,
  PYTHON_PORT,
  PYTHON_SCRIPT_REL,
  resolvePaths,
  buildBackendEnv,
};