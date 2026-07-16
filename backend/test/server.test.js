'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildChatIbContext, normalizeDraftOrder, parseChatResponse } = require('../chatSafety');

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

  it('uses environment configuration for the OpenAI-compatible chat endpoint', () => {
    const serverPath = path.resolve(__dirname, '..', 'server.js');
    const src = fs.readFileSync(serverPath, 'utf-8');

    assert.match(src, /process\.env\.OPENAI_BASE_URL/);
    assert.match(src, /process\.env\.OPENAI_API_KEY/);
    assert.match(src, /process\.env\.OPENAI_MODEL/);
    assert.match(src, /app\.get\('\/api\/chat\/models'/);
    assert.match(src, /\/models/);
    assert.match(src, /app\.post\('\/api\/chat'/);
    assert.match(src, /\/chat\/completions/);

    const envExample = fs.readFileSync(path.resolve(__dirname, '..', '.env.example'), 'utf-8');
    assert.match(envExample, /OPENAI_BASE_URL=https:\/\/opencode\.ai\/zen\/v1/);
    assert.match(envExample, /OPENAI_MODEL=deepseek-v4-flash/);
  });

  it('supplies only read-only, non-sensitive IB context to chat', () => {
    const portfolio = [{
      id: 'DU123:AAPL',
      account: 'DU123',
      symbol: 'AAPL',
      type: 'buy',
      quantity: 5,
      avgCost: 100,
      costBasis: 500,
      currency: 'USD',
      unrealizedPnL: 25,
      cashBalance: 1000,
      apiKey: 'secret',
    }];
    const orders = [{
      id: 'perm:123',
      orderId: 7,
      permId: 123,
      symbol: 'MSFT',
      action: 'SELL',
      orderType: 'LMT',
      quantity: 2,
      limitPrice: 450,
      status: 'Submitted',
      filled: 0,
      remaining: 2,
      tif: 'DAY',
      IB_HOST: '127.0.0.1',
    }];
    const original = structuredClone({ portfolio, orders });

    const context = buildChatIbContext(portfolio, orders);

    assert.deepEqual({ portfolio, orders }, original);
    assert.deepEqual(context, {
      positions: [{
        symbol: 'AAPL',
        type: 'buy',
        quantity: 5,
        avgCost: 100,
        costBasis: 500,
        currency: 'USD',
        unrealizedPnL: 25,
        cashBalance: 1000,
      }],
      pendingOrders: [{
        symbol: 'MSFT',
        action: 'SELL',
        orderType: 'LMT',
        quantity: 2,
        limitPrice: 450,
        status: 'Submitted',
        filled: 0,
        remaining: 2,
        tif: 'DAY',
      }],
    });
    assert.doesNotMatch(JSON.stringify(context), /DU123|secret|127\.0\.0\.1/);

    const src = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf-8');
    const chatRoute = src.slice(src.indexOf("app.post('/api/chat'"), src.indexOf("app.get('/api/model/status"));
    assert.doesNotMatch(chatRoute, /ib\.placeOrder|ib\.cancelOrder|\/api\/orders/);
  });

  it('normalizes valid AI order drafts', () => {
    assert.deepEqual(normalizeDraftOrder({
      symbol: ' aapl ',
      action: ' buy ',
      quantity: 5,
      orderType: 'lmt',
      limitPrice: 123.45,
      stopPrice: null,
    }), {
      symbol: 'AAPL',
      action: 'BUY',
      quantity: 5,
      orderType: 'LMT',
      limitPrice: 123.45,
      stopPrice: null,
    });
  });

  it('turns malformed or unsupported AI order drafts into null', () => {
    const valid = {
      symbol: 'AAPL',
      action: 'BUY',
      quantity: 5,
      orderType: 'LMT',
      limitPrice: 123.45,
      stopPrice: null,
    };
    const invalidDrafts = [
      { ...valid, tif: 'GTC' },
      { ...valid, action: 'HOLD' },
      { ...valid, quantity: '5' },
      { ...valid, quantity: true },
      { ...valid, quantity: 1.5 },
      { ...valid, orderType: 'STP', limitPrice: null, stopPrice: 120 },
      { ...valid, limitPrice: 0 },
      { ...valid, limitPrice: '123.45' },
      { ...valid, limitPrice: true },
      { ...valid, stopPrice: 120 },
      'BUY 5 AAPL',
    ];

    for (const draft of invalidDrafts) {
      assert.equal(normalizeDraftOrder(draft), null);
      assert.equal(parseChatResponse(JSON.stringify({ answer: 'Review this.', draftOrder: draft })).draftOrder, null);
    }
    assert.deepEqual(parseChatResponse('Plain answer only.'), {
      answer: 'Plain answer only.',
      draftOrder: null,
    });
  });
});
