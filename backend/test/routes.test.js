'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

// Run the actual route handlers with broker/process startup replaced, so no
// test can contact a broker, launch Python, or submit a real order.
function loadRoutes(fetch) {
  const routes = new Map();
  const app = { use() {}, listen(_port, host) { assert.equal(host, '127.0.0.1'); } };
  for (const method of ['get', 'post', 'put', 'patch']) {
    app[method] = (url, handler) => routes.set(`${method} ${url}`, handler);
  }
  const express = Object.assign(() => app, { json() {}, static() {} });
  class FakeIB extends EventEmitter { connect() {} }
  const localRequire = createRequire(path.join(__dirname, '../server.js'));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    __dirname: path.join(__dirname, '..'),
    require(name) {
      if (name === 'express') return express;
      if (name === 'ib') return FakeIB;
      if (name === 'dotenv') return { config() {} };
      if (name === 'child_process') return { spawn: () => Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(),
      }) };
      return localRequire(name);
    },
    process: { env: { DESKTOP_MODE: '1', BIND_HOST: '0.0.0.0' }, on() {} },
    console: { log() {}, warn() {}, error() {} },
    fetch, AbortSignal, URL, setTimeout, clearTimeout,
  });
  return async (route, body = {}) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; } };
    await routes.get(route)({ params: { symbol: 'AAPL' }, query: {}, body }, response);
    return response;
  };
}

it('rejects unsafe quantities before any broker activity', async () => {
  const request = loadRoutes(() => { throw new Error('Unexpected upstream request'); });
  for (const quantity of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await request('post /api/orders', { symbol: 'AAPL', quantity, price: 100 });
    assert.equal(result.statusCode, 400);
    assert.match(result.body.error, /Quantity/);
  }
});

it('invalidates prediction responses only after a successful retrain', async () => {
  let predictions = 0;
  let retrainOk = false;
  const request = loadRoutes(async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (url.includes('/model/retrain/')) {
      return { ok: retrainOk, json: async () => ({ detail: 'unavailable' }) };
    }
    predictions += 1;
    return { ok: true, json: async () => ({ status: 'success', confidence: predictions }) };
  });
  await request('get /api/prediction/:symbol');
  assert.equal((await request('post /api/model/retrain/:symbol')).statusCode, 502);
  await request('get /api/prediction/:symbol');
  assert.equal(predictions, 1);
  retrainOk = true;
  assert.equal((await request('post /api/model/retrain/:symbol')).statusCode, 200);
  await request('get /api/prediction/:symbol');
  assert.equal(predictions, 2);
});

it('propagates model status errors instead of reporting success', async () => {
  const request = loadRoutes(async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: false, json: async () => ({ detail: 'analysis unavailable' }) };
  });
  const result = await request('get /api/model/status/:symbol');
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error, 'analysis unavailable');
});
