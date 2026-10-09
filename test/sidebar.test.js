'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSidebar } = require('../src/sidebar');

test('sidebar escapes imported text and shows local and zero-score case data', () => {
  const html = renderSidebar({
    record: { pid: 'P1', title: '<script>x</script>', content: '题面', samples: [{ id: 1, input: '2', output: '4' }] },
    result: { compile: { code: 0 }, cases: [{ id: 1, passed: false, stdout: '3', code: 0 }] },
    submission: { status: 'submitted', score: 0, failedCases: [{ id: 2, status: 2, input: '<img>', expected: '5', actual: '6' }] }
  }, 'nonce');
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(html.includes('失败 ✕'));
  assert.ok(html.includes('得分 0'));
  assert.ok(html.includes('零分测试点 2'));
  assert.ok(html.includes('&lt;img&gt;'));
  assert.ok(!html.includes('<img>'));
});

test('sidebar distinguishes missing judge data from an empty input', () => {
  const html = renderSidebar({ submission: { status: 'submitted', score: 0, failedCases: [{ id: 1, input: '' }] } }, 'nonce');
  assert.ok(html.includes('输入</div><pre></pre>'));
  assert.ok(html.includes('站点未返回测试数据'));
});
