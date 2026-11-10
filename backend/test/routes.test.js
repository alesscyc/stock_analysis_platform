'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

const IB_METHODS = [
  'connect', 'reqAccountSummary', 'cancelAccountSummary', 'reqAccountUpdates',
  'reqPositions', 'cancelPositions', 'reqManagedAccts', 'reqIds',
  'reqAllOpenOrders', 'reqOpenOrders', 'reqAutoOpenOrders',
];

// Run the actual route handlers with broker/process startup replaced, so no
// test can contact a broker, launch Python, or submit a real order.
function loadRoutes(fetch, env = {}) {
  const routes = new Map();
  const timers = new Set();
  const app = { use() {}, listen(_port, host) { assert.equal(host, '127.0.0.1'); } };
  for (const method of ['get', 'post', 'put', 'patch']) {
    app[method] = (url, handler) => routes.set(`${method} ${url}`, handler);
  }
  const express = Object.assign(() => app, { json() {}, static() {} });
  let ibInstance;
  class FakeIB extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.calls = [];
      ibInstance = this;
    }
  }
  for (const name of IB_METHODS) {
    FakeIB.prototype[name] = function (...args) {
      this.calls.push([name, ...args]);
      return this;
    };
  }
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
    process: { env: { DESKTOP_MODE: '1', BIND_HOST: '0.0.0.0', ...env }, on() {} },
    console: { log() {}, warn() {}, error() {} },
    fetch, AbortSignal, URL, setImmediate, clearImmediate,
    setTimeout(fn, ms, ...args) {
      const id = setTimeout((...inner) => {
        timers.delete(id);
        fn(...inner);
      }, ms, ...args);
      timers.add(id);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
      clearTimeout(id);
    },
  });
  const request = async (route, body = {}, extras = {}) => {
    const handler = routes.get(route);
    assert.ok(handler, `missing route ${route}`);
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; } };
    await handler({
      params: extras.params ?? { symbol: 'AAPL' },
      query: extras.query ?? {},
      headers: extras.headers ?? {},
      socket: { remoteAddress: extras.remoteAddress ?? '127.0.0.1' },
      body,
    }, response);
    return response;
  };
  request.ib = ibInstance;
  request.close = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };
  return request;
}

function ibCalls(ib, name) {
  return ib.calls.filter((call) => call[0] === name);
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function connectBroker(request, accounts = 'DU1234567') {
  request.ib.emit('connected');
  await flush();
  request.ib.emit('managedAccounts', accounts);
}

function summaryReqId(ib) {
  const call = ibCalls(ib, 'reqAccountSummary').at(-1);
  assert.ok(call, 'reqAccountSummary was not invoked');
  return call[1];
}

function emitSummary(ib, reqId, rows) {
  for (const [account, tag, value, currency] of rows) {
    ib.emit('accountSummary', reqId, account, tag, value, currency);
  }
  ib.emit('accountSummaryEnd', reqId);
}

function overview(request, account) {
  return request('get /api/account/overview', {}, { query: account ? { account } : {} });
}

const stock = (symbol, extra = {}) => ({ symbol, secType: 'STK', currency: 'USD', exchange: 'SMART', ...extra });

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

describe('IB account overview', () => {
  it('groups account-summary values per account/currency as finite numbers or null', async () => {
    const request = loadRoutes(() => { throw new Error('Unexpected upstream request'); });
    try {
      await connectBroker(request, 'DU1111111,DU2222222');
      const summaryCall = ibCalls(request.ib, 'reqAccountSummary').at(-1);
      assert.equal(summaryCall[2], 'All');
      assert.match(String(summaryCall[3]), /NetLiquidation/);
      assert.match(String(summaryCall[3]), /ExcessLiquidity/);
      assert.match(String(summaryCall[3]), /MaintMarginReq/);
      const reqId = summaryCall[1];

      const before = await overview(request, 'DU1111111');
      assert.equal(before.statusCode, 200);
      assert.equal(before.body.summaryReady, false);
      assert.equal(before.body.summaryUpdatedAt, null);
      assert.equal(before.body.connected, true);

      request.ib.emit('accountSummary', 1, 'DU1111111', 'NetLiquidation', '999999', 'USD');
      emitSummary(request.ib, reqId, [
        ['DU1111111', 'AccountType', 'PAPER', ''],
        ['DU1111111', 'NetLiquidation', '100000.5', 'USD'],
        ['DU1111111', 'ExcessLiquidity', 'NaN', 'USD'],
        ['DU1111111', 'BuyingPower', 'Infinity', 'USD'],
        ['DU1111111', 'AvailableFunds', '', 'USD'],
        ['DU1111111', 'MaintMarginReq', 'n/a', 'USD'],
        ['DU1111111', 'NetLiquidation', '20000', 'EUR'],
        ['DU2222222', 'NetLiquidation', '77777', 'USD'],
        ['DU2222222', 'ExcessLiquidity', '40000', 'USD'],
      ]);

      const du1 = await overview(request, 'DU1111111');
      assert.equal(du1.body.summaryReady, true);
      assert.equal(du1.body.selectedAccount, 'DU1111111');
      assert.equal(du1.body.accountType, 'PAPER');
      assert.equal(Number.isNaN(Date.parse(du1.body.summaryUpdatedAt)), false);
      assert.equal(du1.body.metrics.USD.NetLiquidation, 100000.5);
      assert.equal(du1.body.metrics.EUR.NetLiquidation, 20000);
      assert.equal(du1.body.metrics.USD.ExcessLiquidity, null);
      assert.equal(du1.body.metrics.USD.BuyingPower, null);
      assert.equal(du1.body.metrics.USD.AvailableFunds, null);
      assert.equal(du1.body.metrics.USD.MaintMarginReq, null);
      assert.notEqual(du1.body.metrics.USD.NetLiquidation, 177777.5);

      const du2 = await overview(request, 'DU2222222');
      assert.equal(du2.body.selectedAccount, 'DU2222222');
      assert.equal(du2.body.metrics.USD.NetLiquidation, 77777);
      assert.equal(du2.body.metrics.USD.ExcessLiquidity, 40000);
      assert.equal(du2.body.metrics.EUR, undefined);

      const summaryCallsBeforeError = ibCalls(request.ib, 'reqAccountSummary').length;
      request.ib.emit('error', new Error('summary rejected'), { id: reqId, code: 322 });
      const recovered = await overview(request, 'DU2222222');
      assert.equal(recovered.body.summaryError, 'summary rejected');
      assert.equal(ibCalls(request.ib, 'reqAccountSummary').length, summaryCallsBeforeError + 1);
    } finally {
      request.close();
    }
  });

  it('keeps the last overview snapshot after disconnect', async () => {
    const request = loadRoutes(() => { throw new Error('Unexpected upstream request'); });
    try {
      await connectBroker(request, 'DU1111111');
      const reqId = summaryReqId(request.ib);
      emitSummary(request.ib, reqId, [
        ['DU1111111', 'NetLiquidation', '88000', 'USD'],
        ['DU1111111', 'ExcessLiquidity', '22000', 'USD'],
      ]);
      await overview(request, 'DU1111111');
      request.ib.emit('updatePortfolio', stock('AAPL'), 10, 100, 1000, 90, 100, 0, 'DU1111111');
      request.ib.emit('accountDownloadEnd', 'DU1111111');

      const live = await overview(request);
      assert.equal(live.body.connected, true);
      assert.equal(live.body.metrics.USD.NetLiquidation, 88000);
      assert.equal(live.body.holdings[0].symbol, 'AAPL');
      const updatedAt = live.body.summaryUpdatedAt;

      request.ib.emit('disconnected');
      const stale = await overview(request, 'DU1111111');
      assert.equal(stale.statusCode, 200);
      assert.equal(stale.body.connected, false);
      assert.equal(stale.body.metrics.USD.NetLiquidation, 88000);
      assert.equal(stale.body.metrics.USD.ExcessLiquidity, 22000);
      assert.equal(stale.body.holdings[0].symbol, 'AAPL');
      assert.equal(stale.body.summaryUpdatedAt, updatedAt);

      await request('post /api/account/release');
      const updateCallsBeforeReconnect = ibCalls(request.ib, 'reqAccountUpdates').length;
      request.ib.emit('connected');
      await flush();
      request.ib.emit('managedAccounts', 'DU1111111');
      assert.equal(ibCalls(request.ib, 'reqAccountUpdates').length, updateCallsBeforeReconnect);
    } finally {
      request.close();
    }
  });

  it('subscribes per selected account, rejects invalid ids, and leaves GET /api/portfolio unchanged', async () => {
    const request = loadRoutes(() => { throw new Error('Unexpected upstream request'); });
    try {
      await connectBroker(request, 'DU1111111,DU2222222');
      request.ib.emit('position', 'DU1111111', stock('MSFT'), 4, 50);
      request.ib.emit('positionEnd');

      const first = await overview(request, 'DU1111111');
      assert.equal(first.body.selectedAccount, 'DU1111111');
      assert.deepEqual(ibCalls(request.ib, 'reqAccountUpdates').at(-1), ['reqAccountUpdates', true, 'DU1111111']);

      request.ib.emit('updatePortfolio', stock('AAPL'), 2, 150, 300, 140, 20, 0, 'DU1111111');
      request.ib.emit('updatePortfolio', stock('TSLA'), -1, 200, -200, 210, -10, 0, 'DU2222222');
      request.ib.emit('accountDownloadEnd', 'DU1111111');
      const du1Holdings = await overview(request, 'DU1111111');
      assert.deepEqual(Array.from(du1Holdings.body.holdings, (row) => row.symbol), ['AAPL']);

      const switched = await overview(request, 'DU2222222');
      assert.equal(switched.body.selectedAccount, 'DU2222222');
      const updateCalls = ibCalls(request.ib, 'reqAccountUpdates');
      assert.deepEqual(updateCalls.at(-2), ['reqAccountUpdates', false, 'DU1111111']);
      assert.deepEqual(updateCalls.at(-1), ['reqAccountUpdates', true, 'DU2222222']);
      assert.equal(switched.body.holdings.length, 0);

      request.ib.emit('updatePortfolio', stock('TSLA'), -3, 250, -750, 240, 30, 0, 'DU2222222');
      request.ib.emit('updatePortfolio', stock('AAPL'), 8, 180, 1440, 100, 40, 0, 'DU2222222');
      request.ib.emit('updatePortfolio', stock('MSFT'), 1, 400, 400, 390, 10, 0, 'DU1111111');
      request.ib.emit('accountDownloadEnd', 'DU2222222');
      const ranked = await overview(request, 'DU2222222');
      assert.deepEqual(Array.from(ranked.body.holdings, (row) => row.symbol), ['AAPL', 'TSLA']);
      assert.equal(ranked.body.holdings[0].marketValue, 1440);
      assert.equal(ranked.body.holdings[1].quantity, -3);

      request.ib.emit('updatePortfolio', stock('AAPL'), 0, 180, 0, 100, 0, 0, 'DU2222222');
      const afterClose = await overview(request, 'DU2222222');
      assert.deepEqual(Array.from(afterClose.body.holdings, (row) => row.symbol), ['TSLA']);

      const rejected = await overview(request, 'NOT-AN-ACCOUNT');
      assert.equal(rejected.statusCode, 400);
      assert.equal(rejected.body.error, 'Unknown IB account');
      assert.equal(
        ibCalls(request.ib, 'reqAccountUpdates').some((call) => call[2] === 'NOT-AN-ACCOUNT'),
        false,
      );

      const released = await request('post /api/account/release');
      assert.equal(released.statusCode, 200);
      assert.deepEqual(ibCalls(request.ib, 'reqAccountUpdates').at(-1), ['reqAccountUpdates', false, 'DU2222222']);
      request.ib.emit('updatePortfolio', stock('NVDA'), 1, 100, 100, 90, 10, 0, 'DU2222222');
      const afterRelease = await overview(request);
      assert.equal(afterRelease.body.holdings.some((row) => row.symbol === 'NVDA'), false);
      request.ib.emit('accountDownloadEnd', 'DU2222222');
      const afterLateMarker = await overview(request);
      assert.deepEqual(Array.from(afterLateMarker.body.holdings, (row) => row.symbol), ['TSLA']);
      request.ib.emit('updateAccountValue', 'Currency', 'USD', 'BASE', 'DU2222222');
      request.ib.emit('accountDownloadEnd', 'DU2222222');
      const replacement = await overview(request);
      assert.equal(replacement.body.holdings.length, 0);

      const portfolio = await request('get /api/portfolio');
      assert.equal(portfolio.statusCode, 200);
      assert.equal(Array.isArray(portfolio.body), true);
      assert.equal(portfolio.body[0].symbol, 'MSFT');
      assert.equal(portfolio.body[0].quantity, 4);
      assert.equal(portfolio.body[0].avgCost, 50);
      assert.equal(Object.hasOwn(portfolio.body[0], 'marketValue'), false);
    } finally {
      request.close();
    }
  });

  it('converts mixed-currency holdings before computing allocation and P&L', async () => {
    const request = loadRoutes(() => { throw new Error('Unexpected upstream request'); });
    try {
      await connectBroker(request, 'DU1111111');
      await overview(request, 'DU1111111');
      emitSummary(request.ib, summaryReqId(request.ib), [
        ['DU1111111', 'GrossPositionValue', '1630', 'BASE'],
        ['DU1111111', 'GrossPositionValue', '100', 'USD'],
      ]);
      request.ib.emit('updateAccountValue', 'Currency', 'HKD', 'BASE', 'DU1111111');
      request.ib.emit('updateAccountValue', 'ExchangeRate', '7.8', 'USD', 'DU1111111');
      request.ib.emit('updateAccountValue', 'ExchangeRate', '8.5', 'EUR', 'DU1111111');
      request.ib.emit('updatePortfolio', stock('AAPL'), 1, 100, 100, 90, 10, 0, 'DU1111111');
      request.ib.emit('updatePortfolio', { ...stock('SAP'), currency: 'EUR' }, 1, 100, 100, 90, 10, 0, 'DU1111111');
      request.ib.emit('accountDownloadEnd', 'DU1111111');

      const result = await overview(request, 'DU1111111');
      assert.equal(result.body.baseCurrency, 'HKD');
      assert.equal(result.body.grossMarketValue, 1630);
      assert.equal(result.body.unrealizedPnl, 163);
      assert.equal(Math.round(result.body.holdings.find((row) => row.symbol === 'SAP').weight), 52);
    } finally {
      request.close();
    }
  });
});

describe('AI chat connection settings', () => {
  const os = require('node:os');
  const local = { headers: { host: 'localhost:3001', origin: 'http://localhost:5173' } };
  const desktop = { headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' } };

  function setup(t, fetch = () => { throw new Error('Unexpected upstream request'); }) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-connection-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const envFile = path.join(directory, '.env');
    fs.writeFileSync(envFile, 'IB_PORT=4002\nOPENAI_BASE_URL=http://old.test/v1\nOPENAI_API_KEY=old-key\n');
    const request = loadRoutes(fetch, {
      DESKTOP_MODE: '',
      BIND_HOST: '127.0.0.1',
      ENV_FILE: envFile,
      OPENAI_BASE_URL: 'http://old.test/v1',
      OPENAI_API_KEY: 'old-key',
      OPENAI_MODEL: 'deepseek-test',
    });
    t.after(() => request.close());
    return { request, envFile };
  }

  it('reads the connection in browser and desktop clients without returning the key', async (t) => {
    const { request } = setup(t);
    for (const extras of [local, desktop, { headers: { host: 'localhost:3001' } }]) {
      const result = await request('get /api/settings/ai-connection', {}, extras);
      assert.equal(result.statusCode, 200);
      assert.deepEqual(JSON.parse(JSON.stringify(result.body)), {
        settings: { OPENAI_BASE_URL: 'http://old.test/v1' },
        configuredSecrets: { OPENAI_API_KEY: true },
      });
    }
  });

  it('rejects untrusted origins, rebinding hosts, and non-local clients', async (t) => {
    const { request, envFile } = setup(t);
    const before = fs.readFileSync(envFile, 'utf8');
    const attempts = [
      { headers: { host: 'localhost:3001', origin: 'https://evil.example' } },
      { headers: { host: 'localhost:3001', origin: 'null' } },
      { headers: { host: 'evil.example:3001' } },
      { headers: { host: 'localhost:3001', origin: 'http://localhost:5173' }, remoteAddress: '192.168.1.5' },
    ];
    for (const extras of attempts) {
      for (const route of ['get /api/settings/ai-connection', 'put /api/settings/ai-connection']) {
        const result = await request(route, { OPENAI_BASE_URL: 'https://evil.example/v1' }, extras);
        assert.equal(result.statusCode, 403, `${route} ${JSON.stringify(extras)}`);
        assert.doesNotMatch(JSON.stringify(result.body), /old-key/);
      }
    }
    assert.equal(fs.readFileSync(envFile, 'utf8'), before);
  });

  it('rejects unrelated or invalid settings without changing the running connection', async (t) => {
    const urls = [];
    const { request, envFile } = setup(t, async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'deepseek-test' }] }) };
    });
    const before = fs.readFileSync(envFile, 'utf8');
    for (const body of [
      { IB_PORT: '7497' },
      { OPENAI_MODEL: 'other' },
      { OPENAI_BASE_URL: 'ftp://new.test' },
      { OPENAI_BASE_URL: 42 },
      ['OPENAI_BASE_URL'],
    ]) {
      const result = await request('put /api/settings/ai-connection', body, local);
      assert.equal(result.statusCode, 400, JSON.stringify(body));
      assert.ok(result.body.error);
    }
    assert.equal(fs.readFileSync(envFile, 'utf8'), before);
    await request('get /api/chat/models');
    assert.deepEqual(urls, ['http://old.test/v1/models']);
  });

  it('persists and applies saves immediately while in-flight chat keeps its connection', async (t) => {
    const calls = [];
    let releaseFirst;
    const { request, envFile } = setup(t, async (url, options) => {
      calls.push({ url, auth: options.headers.Authorization });
      if (calls.length === 1) {
        await new Promise((resolve) => { releaseFirst = resolve; });
        return { ok: false, status: 400, json: async () => ({ error: { message: 'no json mode' } }) };
      }
      return url.endsWith('/models')
        ? { ok: true, status: 200, json: async () => ({ data: [{ id: 'new-model' }] }) }
        : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hello' } }] }) };
    });

    const chat = request('post /api/chat', {
      symbol: 'AAPL',
      interval: '1d',
      messages: [{ role: 'user', content: 'Hi' }],
      stockData: [{ Date: '2024-01-02', Close: 100 }],
      accountContext: { mode: 'paper', portfolio: [], pendingOrders: [] },
    });
    await flush();
    assert.equal(calls.length, 1);

    const saved = await request('put /api/settings/ai-connection', {
      OPENAI_BASE_URL: ' http://new.test/v1/ ',
      OPENAI_API_KEY: 'new-key',
    }, desktop);
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.body)), {
      settings: { OPENAI_BASE_URL: 'http://new.test/v1' },
      configuredSecrets: { OPENAI_API_KEY: true },
    });
    const text = fs.readFileSync(envFile, 'utf8');
    assert.match(text, /IB_PORT=4002/);
    assert.match(text, /OPENAI_BASE_URL="http:\/\/new\.test\/v1\/?"/);
    assert.match(text, /OPENAI_API_KEY="new-key"/);

    releaseFirst();
    assert.equal((await chat).body.answer, 'hello');
    assert.deepEqual(calls.slice(0, 2), [
      { url: 'http://old.test/v1/chat/completions', auth: 'Bearer old-key' },
      { url: 'http://old.test/v1/chat/completions', auth: 'Bearer old-key' },
    ]);

    const models = await request('get /api/chat/models');
    assert.deepEqual(JSON.parse(JSON.stringify(models.body)), { models: ['new-model'], defaultModel: 'deepseek-test' });
    assert.deepEqual(calls.at(-1), { url: 'http://new.test/v1/models', auth: 'Bearer new-key' });

    const blankKey = await request('put /api/settings/ai-connection', {
      OPENAI_BASE_URL: 'http://newer.test/v1',
      OPENAI_API_KEY: '',
    }, local);
    assert.equal(blankKey.statusCode, 200);
    assert.match(fs.readFileSync(envFile, 'utf8'), /OPENAI_API_KEY="new-key"/);
    await request('get /api/chat/models');
    assert.deepEqual(calls.at(-1), { url: 'http://newer.test/v1/models', auth: 'Bearer new-key' });
  });

  it('keeps the general settings API desktop-only', async (t) => {
    const { request } = setup(t);
    assert.equal((await request('get /api/settings', {}, local)).statusCode, 404);
    assert.equal((await request('put /api/settings', { IB_PORT: '1' }, local)).statusCode, 404);
  });
});
