'use strict';

// Builds the Windows installer in one command: `npm run dist`.
//   1. Build the React frontend (frontend/dist)
//   2. Stage backend + frontend/dist + bundled Python service into resources/
//   3. Bundle analysis/stock_data.py with PyInstaller (no Python needed at runtime)
//   4. Package everything into a Windows NSIS installer with electron-builder

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const electronDir = __dirname;
const repoRoot = path.resolve(electronDir, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const backendDir = path.join(repoRoot, 'backend');
const analysisDir = path.join(repoRoot, 'analysis');
const resourcesDir = path.join(electronDir, 'resources');

function run(cmd, cwd) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function ensure(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copy(src, dest) {
  ensure(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true });
}

function quote(p) {
  return `"${p}"`;
}

function ensurePyinstaller() {
  try {
    execSync('python -m PyInstaller --version', { stdio: 'pipe' });
  } catch (_) {
    console.log('\nPyInstaller not found; installing it...');
    run('python -m pip install pyinstaller', repoRoot);
  }
}

// ── 1. Frontend build ────────────────────────────────────────────────────────
run('npm run build', frontendDir);

// ── 2. Stage resources ───────────────────────────────────────────────────────
rmrf(resourcesDir);
ensure(resourcesDir);

copy(path.join(frontendDir, 'dist'), path.join(resourcesDir, 'frontend', 'dist'));

// Stage only the backend files needed at runtime, then install production
// deps so clean builds never depend on the developer's node_modules.
const stagedBackend = path.join(resourcesDir, 'backend');
ensure(stagedBackend);
for (const file of ['server.js', 'chatSafety.js', 'settingsEnv.js', 'package.json', 'package-lock.json']) {
  copy(path.join(backendDir, file), path.join(stagedBackend, file));
}
run('npm ci --omit=dev', stagedBackend);

// ── 3. PyInstaller bundle (analysis service) ─────────────────────────────────
ensurePyinstaller();

const collect = [
  'fastapi',
  'uvicorn',
  'pydantic',
  'yfinance',
  'certifi',
  'requests',
  'sklearn',
  'scipy',
  'pandas',
  'numpy',
].map((pkg) => `--collect-all ${pkg}`).join(' ');

const pyArgs = [
  `--noconfirm --clean --onedir --name analysis-service`,
  collect,
  `--distpath ${quote(path.join(resourcesDir, 'analysis-service'))}`,
  `--workpath ${quote(path.join(electronDir, 'build', 'analysis-work'))}`,
  `--specpath ${quote(path.join(electronDir, 'build', 'analysis-spec'))}`,
  quote(path.join(analysisDir, 'stock_data.py')),
].join(' ');

// Install electron + electron-builder on first run so `npm run dist` is one shot.
if (!fs.existsSync(path.join(electronDir, 'node_modules', 'electron'))) {
  run('npm install', electronDir);
}

run(`python -m PyInstaller ${pyArgs}`, analysisDir);

// ── 4. electron-builder installer ────────────────────────────────────────────
run('npm run dist:installer', electronDir);

console.log('\nDone. Installer written to electron/dist/.');
