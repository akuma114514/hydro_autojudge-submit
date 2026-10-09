'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('Edge page function submits only to matching Hydro problem with form fields', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'edge-companion', 'background.js'), 'utf8');
  const listeners = { addListener() {} };
  const calls = [];
  const context = {
    chrome: {
      runtime: { onInstalled: listeners, onStartup: listeners, onMessage: listeners },
      alarms: { onAlarm: listeners }
    },
    window: {
      UiContextNew: JSON.stringify({ problemId: 'B2002', postSubmitUrl: '/d/shnu2026seed/p/158/submit' }),
      UserContext: JSON.stringify({ _id: 123 })
    },
    location: { href: 'https://frp-fan.com:36387/d/shnu2026seed/p/B2002', origin: 'https://frp-fan.com:36387', pathname: '/d/shnu2026seed/p/B2002' },
    URL, FormData,
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/record/')) return { ok: true, text: async () => JSON.stringify({ rdoc: { status: 1, score: 100 } }) };
      return { ok: true, url: 'https://frp-fan.com:36387/d/shnu2026seed/record/abc' };
    }
  };
  vm.runInNewContext(`${source}\nthis.submit = submitOnHydroPage;`, context);
  const result = await context.submit({ pid: 'B2002', lang: 'cc.cc17o2', code: 'int main(){}' });
  assert.equal(result.ok, true);
  assert.equal(result.score, 100);
  assert.equal(calls[0].url, 'https://frp-fan.com:36387/d/shnu2026seed/p/158/submit');
  assert.equal(calls[0].options.body.get('lang'), 'cc.cc17o2');
  assert.equal(calls[0].options.body.get('code'), 'int main(){}');
  const mismatch = await context.submit({ pid: 'OTHER', lang: 'cc.cc17o2', code: 'x' });
  assert.equal(mismatch.ok, false);
  assert.equal(calls.length, 2);
});

test('Edge page function accepts already parsed Hydro contexts', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'edge-companion', 'background.js'), 'utf8');
  const listeners = { addListener() {} };
  const context = {
    chrome: {
      runtime: { onInstalled: listeners, onStartup: listeners, onMessage: listeners },
      alarms: { onAlarm: listeners }
    },
    window: {
      UiContextNew: { problemId: 'B2002', postSubmitUrl: '/d/shnu2026seed/p/B2002/submit' },
      UserContext: { _id: 123 }
    },
    location: { href: 'https://frp-fan.com:36387/d/shnu2026seed/p/B2002', origin: 'https://frp-fan.com:36387', pathname: '/d/shnu2026seed/p/B2002' },
    URL, FormData,
    fetch: async url => String(url).includes('/record/')
      ? { ok: true, text: async () => JSON.stringify({ rdoc: { status: 2, score: 0, testCases: [{ id: 7, status: 2, score: 0, input: '', output: 'expected', userOutput: 'actual', message: 'wrong' }] } }) }
      : { ok: true, url: 'https://frp-fan.com:36387/d/shnu2026seed/record/abc' }
  };
  vm.runInNewContext(`${source}\nthis.submit = submitOnHydroPage;`, context);
  const result = await context.submit({ pid: 'B2002', lang: 'cc.cc17o2', code: 'int main(){}' });
  assert.equal(result.ok, true);
  assert.equal(result.score, 0);
  assert.equal(result.failedCases[0].id, 7);
  assert.equal(result.failedCases[0].input, '');
  assert.equal(result.failedCases[0].expected, 'expected');
  assert.equal(result.failedCases[0].actual, 'actual');
});

test('Edge waits for judging before reporting a zero score', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'edge-companion', 'background.js'), 'utf8');
  const listeners = { addListener() {} };
  let reads = 0;
  const context = {
    chrome: { runtime: { onInstalled: listeners, onStartup: listeners, onMessage: listeners }, alarms: { onAlarm: listeners } },
    window: { UiContextNew: { problemId: 'B2002', postSubmitUrl: '/d/x/p/B2002/submit' }, UserContext: { _id: 1 } },
    location: { href: 'https://frp-fan.com:36387/d/x/p/B2002', origin: 'https://frp-fan.com:36387', pathname: '/d/x/p/B2002' },
    URL, FormData, setTimeout: resolve => resolve(),
    fetch: async url => String(url).includes('/record/')
      ? { ok: true, text: async () => JSON.stringify({ rdoc: { status: ++reads === 1 ? 20 : 2, score: 0 } }) }
      : { ok: true, url: 'https://frp-fan.com:36387/d/x/record/abc' }
  };
  vm.runInNewContext(`${source}\nthis.submit = submitOnHydroPage;`, context);
  const result = await context.submit({ pid: 'B2002', lang: 'cc.cc17o2', code: 'x' });
  assert.equal(reads, 2);
  assert.equal(result.score, 0);
});

test('Edge reads the score from a Hydro record HTML page', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'edge-companion', 'background.js'), 'utf8');
  const listeners = { addListener() {} };
  const html = `<script>window.UiContextNew = '${JSON.stringify({ rdoc: { status: 1, score: 85 } })}';</script>`;
  const context = {
    chrome: { runtime: { onInstalled: listeners, onStartup: listeners, onMessage: listeners }, alarms: { onAlarm: listeners } },
    window: { UiContextNew: { problemId: 'B2002', postSubmitUrl: '/d/x/p/B2002/submit' }, UserContext: { _id: 1 } },
    location: { href: 'https://frp-fan.com:36387/d/x/p/B2002', origin: 'https://frp-fan.com:36387', pathname: '/d/x/p/B2002' },
    URL, FormData,
    fetch: async url => String(url).includes('/record/')
      ? { ok: true, text: async () => html }
      : { ok: true, url: 'https://frp-fan.com:36387/d/x/record/abc' }
  };
  vm.runInNewContext(`${source}\nthis.submit = submitOnHydroPage;`, context);
  const result = await context.submit({ pid: 'B2002', lang: 'cc.cc17o2', code: 'x' });
  assert.equal(result.score, 85);
});

test('Edge imports only the active supported problem through the paired bridge', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'edge-companion', 'background.js'), 'utf8');
  const listeners = { addListener() {} };
  const requests = [];
  const context = {
    chrome: {
      runtime: { onInstalled: listeners, onStartup: listeners, onMessage: listeners },
      alarms: { onAlarm: listeners },
      storage: { local: { get: async () => ({ pairing: { port: 32167, token: 'test' } }) } },
      tabs: { query: async () => [{ id: 8, url: 'https://frp-fan.com:36387/d/x/p/B2002' }] },
      scripting: { executeScript: async () => [{ result: { pdoc: { pid: 'B2002', content: 'text' } } }] }
    },
    URL,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ pid: 'B2002', count: 1 }) };
    }
  };
  vm.runInNewContext(`${source}\nthis.importCurrent = importCurrentPage;`, context);
  assert.match(await context.importCurrent(), /B2002/);
  assert.equal(requests[0].url, 'http://127.0.0.1:32167/import');
  assert.equal(JSON.parse(requests[0].options.body).context.pdoc.pid, 'B2002');
});
