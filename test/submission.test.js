'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubmissionJob, SubmissionBridge } = require('../src/submission');

const record = { url: 'https://frp-fan.com:36387/d/shnu2026seed/p/B2002', pid: 'B2002', samples: [{ id: 1, input: '', output: 'Hello,World!' }] };
const passing = { compile: { code: 0, timedOut: false }, cases: [{ id: 1, passed: true }] };

test('only a fully passing normal problem can create a submission job', () => {
  const job = createSubmissionJob(record, 'int main() {}', passing);
  assert.equal(job.lang, 'cc.cc17o2');
  assert.equal(job.pid, 'B2002');
  assert.throws(() => createSubmissionJob(record, 'int main() {}', { ...passing, cases: [{ id: 1, passed: false }] }));
  assert.throws(() => createSubmissionJob(record, ' ', passing));
});

test('local bridge requires token and acknowledges one job once', async () => {
  const received = [];
  const bridge = new SubmissionBridge('test-secret', 0, async (job, result) => received.push({ job, result }));
  await bridge.start();
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  try {
    const job = createSubmissionJob(record, 'int main() {}', passing);
    bridge.queue(job);
    assert.equal((await fetch(`${base}/job`)).status, 401);
    const headers = { Authorization: 'Bearer test-secret' };
    const metadata = await (await fetch(`${base}/job`, { headers })).json();
    assert.equal(metadata.id, job.id);
    assert.equal(metadata.code, undefined);
    assert.equal((await (await fetch(`${base}/claim?id=${job.id}`, { headers })).json()).code, job.code);
    assert.equal((await fetch(`${base}/claim?id=${job.id}`, { headers })).status, 409);
    const result = await fetch(`${base}/result`, {
      method: 'POST', headers,
      body: JSON.stringify({ id: job.id, ok: true, recordUrl: 'https://frp-fan.com:36387/d/shnu2026seed/record/abc' })
    });
    assert.equal(result.status, 200);
    assert.equal(received.length, 1);
    assert.deepEqual(await (await fetch(`${base}/job`, { headers })).json(), { pending: false });
  } finally { bridge.close(); }
});

test('local bridge accepts a paired Edge page import and returns the VS Code result', async () => {
  const received = [];
  const bridge = new SubmissionBridge('test-secret', 0, async () => {}, async payload => {
    received.push(payload);
    return { pid: 'B2002', count: 1 };
  });
  await bridge.start();
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  try {
    const body = JSON.stringify({ url: record.url, context: { pdoc: { pid: 'B2002' } } });
    assert.equal((await fetch(`${base}/import`, { method: 'POST', body })).status, 401);
    const response = await fetch(`${base}/import`, {
      method: 'POST', headers: { Authorization: 'Bearer test-secret' }, body
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { pid: 'B2002', count: 1 });
    assert.equal(received[0].url, record.url);
  } finally { bridge.close(); }
});
