'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProblemUrl, extractSamples, parseProblem } = require('../src/hydro');
const { normalizeOutput } = require('../src/runner');

test('URL must stay on configured Hydro origin', () => {
  assert.equal(validateProblemUrl('https://frp-fan.com:36387/d/shnu2026seed/p/B2002', 'https://frp-fan.com:36387').pathname,
    '/d/shnu2026seed/p/B2002');
  assert.throws(() => validateProblemUrl('https://elsewhere.test/d/x/p/1', 'https://frp-fan.com:36387'));
});

test('numbered samples preserve empty input and pair by id', () => {
  const samples = extractSamples('## 样例\n\n```input2\n5\n```\n```output2\n6\n```\n```input1\n\n```\n```output1\nHello,World!\n```');
  assert.deepEqual(samples, [
    { id: 1, input: '', output: 'Hello,World!\n' },
    { id: 2, input: '5\n', output: '6\n' }
  ]);
});

test('unpaired sample fails visibly', () => {
  assert.throws(() => extractSamples('```input1\n1\n```'), /缺少输入或输出/);
});

test('Hydro context extracts localized markdown', () => {
  const context = { pdoc: { pid: 'B2002', title: 'Hello', content: JSON.stringify({ zh: '```input1\n\n```\n```output1\nHello,World!\n```' }) } };
  const html = `<script>window.UiContextNew = '${JSON.stringify(context).replace(/\\/g, '\\\\')}';</script>`;
  assert.equal(parseProblem(html).samples[0].output, 'Hello,World!\n');
});

test('normalization follows selected comparison rule', () => {
  assert.equal(normalizeOutput('a  \r\nb\t\n\n'), 'a\nb');
  assert.notEqual(normalizeOutput('a b'), normalizeOutput('ab'));
});

// --- Task A: additional clearly-paired public sample formats ---
// Shapes below are transcribed from real problems on the configured Hydro
// site (frp-fan.com:36387). See docs/sample-format-research.md.

test('CRLF sample bodies are normalized, not left with stray carriage returns', () => {
  const samples = extractSamples('```input1\r\n23 11\r\n```\r\n```output1\r\n3\r\n```');
  assert.deepEqual(samples, [{ id: 1, input: '23 11\n', output: '3\n' }]);
});

test('numbered format still pairs multiple groups in id order', () => {
  const samples = extractSamples(
    '```input2\n-2 1\n```\n```output2\nZero\n```\n```input1\n1 3\n```\n```output1\nPositive\n```'
  );
  assert.deepEqual(samples.map(sample => sample.id), [1, 2]);
  assert.equal(samples[1].output, 'Zero\n');
});

test('titled format reads paired untagged fences under 样例 headings', () => {
  const samples = extractSamples([
    '## 样例 1', '', '```text', '5', '1001', '```', '', '```text', '10', '```', '',
    '## 样例 2', '', '```text', '5', '5001', '```', '', '```text', '27', '```', '',
    '## 数据范围', ''
  ].join('\n'));
  assert.deepEqual(samples, [
    { id: 1, input: '5\n1001\n', output: '10\n' },
    { id: 2, input: '5\n5001\n', output: '27\n' }
  ]);
});

test('样例说明 heading does not open a new sample group', () => {
  const samples = extractSamples([
    '## 样例', '', '```text', '6', '?L', '```', '', '```text', '4.0', '```', '',
    '## 样例说明', '', '队伍从左到右依次是第 3,1,5 名同学。', ''
  ].join('\n'));
  assert.deepEqual(samples, [{ id: 1, input: '6\n?L\n', output: '4.0\n' }]);
});

test('titled format with an unnumbered heading keeps id 1', () => {
  const samples = extractSamples('## 样例\n\n```text\n1 2\n```\n\n```text\n3\n```\n');
  assert.deepEqual(samples, [{ id: 1, input: '1 2\n', output: '3\n' }]);
});

test('titled format recognizes an empty input block', () => {
  const samples = extractSamples('## 样例\n\n```text\n\n```\n\n```text\nHello,World!\n```\n');
  assert.deepEqual(samples, [{ id: 1, input: '', output: 'Hello,World!\n' }]);
});

test('explicit 样例输入/样例输出 headings are paired', () => {
  const samples = extractSamples(
    '### 样例输入 1\n\n```\n7 8\n```\n\n### 样例输出 1\n\n```\n15\n```\n'
  );
  assert.deepEqual(samples, [{ id: 1, input: '7 8\n', output: '15\n' }]);
});

test('numbered fences win over unrelated titled fences in the same statement', () => {
  const samples = extractSamples([
    '## 样例', '', '```input1', '1 2', '```', '', '```output1', '3', '```', '',
    '## 提示', '', '```text', 'not a sample', '```', ''
  ].join('\n'));
  assert.deepEqual(samples, [{ id: 1, input: '1 2\n', output: '3\n' }]);
});

test('an odd fence count in a sample region is reported, not guessed', () => {
  assert.throws(
    () => extractSamples('## 样例\n\n```text\n1 2\n```\n\n```text\n3\n```\n\n```text\n4\n```\n'),
    /实际找到 3 个/
  );
});

test('a lone untagged fence is not accepted as a sample', () => {
  assert.throws(() => extractSamples('## 样例\n\n```text\n1 2\n```\n'), /实际找到 1 个/);
});

test('statements with no recognizable sample report the supported formats', () => {
  assert.throws(() => extractSamples('# 题目描述\n\n这里没有样例。\n'), /没有可识别的样例/);
});

test('non-string markdown is rejected instead of throwing a type error', () => {
  assert.throws(() => extractSamples(undefined), /不是文本/);
});

test('real B2002 statement imports the empty-input sample end to end', () => {
  const markdown = [
    '## 输出格式', '', '输出一行，内容为 `Hello,World!`。', '',
    '## 样例', '', '```input1', '', '```', '', '```output1', 'Hello,World!', '```', '',
    '## 数据范围与约定', '', '- 本题没有输入数据。', ''
  ].join('\n');
  const context = { pdoc: { pid: 'B2002', title: 'Hello, World!', content: markdown } };
  const html = `<script>window.UiContextNew = '${JSON.stringify(context).replace(/\\/g, '\\\\')}';</script>`;
  const problem = parseProblem(html);
  assert.equal(problem.pid, 'B2002');
  assert.deepEqual(problem.samples, [{ id: 1, input: '', output: 'Hello,World!\n' }]);
});

test('title sample positions remain correct with CRLF before headings', () => {
  const markdown = '## 描述\r\n文字\r\n\r\n## 样例 1\r\n```text\r\n3\r\n```\r\n```text\r\n4\r\n```\r\n## 说明\r\n结束';
  assert.deepEqual(extractSamples(markdown), [{ id: 1, input: '3\n', output: '4\n' }]);
});
