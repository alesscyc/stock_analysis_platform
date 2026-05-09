'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Backend', () => {
  it('server.js exists and is parseable', () => {
    const serverPath = path.resolve(__dirname, '..', 'server.js');
    assert.ok(fs.existsSync(serverPath), 'server.js not found');

    // Check that Node can parse it without syntax errors
    assert.doesNotThrow(() => {
      // Use acorn (bundled with Node) to check syntax
      const src = fs.readFileSync(serverPath, 'utf-8');
      new Function(src);
    });
  });

  it('package.json main points to an existing file', () => {
    const pkg = require('../package.json');
    const mainPath = path.resolve(__dirname, '..', pkg.main);
    assert.ok(fs.existsSync(mainPath), `Entry point "${pkg.main}" not found`);
  });

  it('all dependencies are installed', () => {
    const pkg = require('../package.json');
    const deps = { ...pkg.dependencies };

    for (const [name] of Object.entries(deps)) {
      const modPath = path.resolve(__dirname, '..', 'node_modules', name);
      assert.ok(fs.existsSync(modPath), `Dependency "${name}" is not installed`);
    }
  });

  it('.env.example or .env exists', () => {
    const envPath = path.resolve(__dirname, '..', '.env');
    const envExamplePath = path.resolve(__dirname, '..', '.env.example');
    assert.ok(
      fs.existsSync(envPath) || fs.existsSync(envExamplePath),
      'Neither .env nor .env.example found'
    );
  });

  it('no hardcoded localhost:3001 in route handlers (use env vars instead)', () => {
    const serverPath = path.resolve(__dirname, '..', 'server.js');
    const src = fs.readFileSync(serverPath, 'utf-8');

    // PYTHON_SERVICE_URL may appear once for config; actual fetch URLs use it via variable
    const hardcodedLocalhostMatches = src.match(/('|")\s*http:\/\/localhost:\d+/g);
    assert.ok(
      !hardcodedLocalhostMatches || hardcodedLocalhostMatches.length === 0,
      'Found hardcoded localhost URLs in server.js'
    );
  });
});
