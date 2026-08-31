'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { saveSettings, updateEnvText, validateSettings } = require('../settingsEnv');

describe('desktop settings env', () => {
  it('updates managed values without dropping comments or unrelated settings', () => {
    const result = updateEnvText('# local settings\nOTHER=value\nIB_PORT=4001\n', {
      IB_PORT: '4002',
      OPENAI_API_KEY: 'key#with=symbols',
    });
    assert.match(result, /# local settings/);
    assert.match(result, /OTHER=value/);
    assert.match(result, /IB_PORT="4002"/);
    assert.match(result, /OPENAI_API_KEY="key#with=symbols"/);
  });

  it('rejects unknown, invalid, and multiline values', () => {
    assert.throws(() => validateSettings({ UNKNOWN: 'value' }), /Unsupported setting/);
    assert.throws(() => validateSettings({ IB_PORT: '70000' }), /Invalid value/);
    assert.throws(() => validateSettings({ OPENAI_API_KEY: 'one\ntwo' }), /Invalid value/);
  });

  it('writes settings atomically and does not return secret values', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-settings-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const envFile = path.join(directory, '.env');

    const result = saveSettings(envFile, { IB_PORT: '4002', OPENAI_API_KEY: 'private-key' });

    assert.match(fs.readFileSync(envFile, 'utf8'), /OPENAI_API_KEY="private-key"/);
    assert.equal(result.settings.OPENAI_API_KEY, '');
    assert.equal(result.configuredSecrets.OPENAI_API_KEY, true);
    assert.equal(fs.existsSync(`${envFile}.tmp`), false);
  });
});
