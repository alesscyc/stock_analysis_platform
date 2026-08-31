'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const SETTINGS_FIELDS = {
  IB_HOST: { default: '127.0.0.1', validate: value => /^[A-Za-z0-9.:-]{1,255}$/.test(value) },
  IB_PORT: { default: '4002', validate: value => isInteger(value, 1, 65535) },
  IB_CLIENT_ID: { default: '1', validate: value => isInteger(value, 0, 2147483647) },
  IB_PORTFOLIO_SYNC_TIMEOUT_MS: { default: '30000', validate: value => isInteger(value, 1000, 300000) },
  IB_ORDER_ID_WAIT_TIMEOUT_MS: { default: '15000', validate: value => isInteger(value, 1000, 300000) },
  IB_OPEN_ORDERS_SYNC_TIMEOUT_MS: { default: '15000', validate: value => isInteger(value, 1000, 300000) },
  FINNHUB_KEY: { default: '', secret: true, validate: isSafeValue },
  OPENAI_BASE_URL: { default: '', validate: value => value === '' || isHttpUrl(value) },
  OPENAI_API_KEY: { default: '', secret: true, validate: isSafeValue },
  OPENAI_MODEL: { default: '', validate: value => value.length <= 200 && isSafeValue(value) },
};

function isInteger(value, min, max) {
  return /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
}

function isSafeValue(value) {
  return value.length <= 4096 && !/[\r\n]/.test(value);
}

function isHttpUrl(value) {
  if (!isSafeValue(value)) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function readSettings(envFile, fallbackEnv = {}) {
  const parsed = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile, 'utf8')) : {};
  const settings = {};
  const configuredSecrets = {};

  for (const [key, field] of Object.entries(SETTINGS_FIELDS)) {
    const value = String(parsed[key] ?? fallbackEnv[key] ?? field.default);
    if (field.secret) {
      settings[key] = '';
      configuredSecrets[key] = value.length > 0;
    } else {
      settings[key] = value;
    }
  }

  return { settings, configuredSecrets };
}

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Settings must be an object');
  }

  const normalized = {};
  for (const [key, value] of Object.entries(input)) {
    const field = SETTINGS_FIELDS[key];
    if (!field) throw new Error(`Unsupported setting: ${key}`);
    if (typeof value !== 'string') throw new Error(`${key} must be text`);
    const trimmed = field.secret ? value : value.trim();
    if (field.secret && trimmed === '') continue;
    if (!field.validate(trimmed)) throw new Error(`Invalid value for ${key}`);
    normalized[key] = trimmed;
  }

  return normalized;
}

function updateEnvText(existingText, updates) {
  const remaining = new Map(Object.entries(updates));
  const lines = existingText ? existingText.replace(/\r\n/g, '\n').split('\n') : [];
  const updated = lines.map(line => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (!match || !Object.hasOwn(updates, match[1])) return line;
    const value = updates[match[1]];
    remaining.delete(match[1]);
    return `${match[1]}=${JSON.stringify(value)}`;
  });

  if (updated.length && updated.at(-1) !== '') updated.push('');
  for (const [key, value] of remaining) updated.push(`${key}=${JSON.stringify(value)}`);
  return `${updated.join('\n').replace(/\n+$/, '')}\n`;
}

function saveSettings(envFile, input) {
  const updates = validateSettings(input);
  const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  const next = updateEnvText(existing, updates);
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  const tempFile = `${envFile}.tmp`;
  fs.writeFileSync(tempFile, next, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempFile, envFile);
  return readSettings(envFile);
}

module.exports = { readSettings, saveSettings, updateEnvText, validateSettings };
