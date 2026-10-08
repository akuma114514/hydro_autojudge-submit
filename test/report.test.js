'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyCase,
  firstDifference,
  formatFirstDifference,
  buildReport,
  summaryMessage
} = require('../src/report');

const RECORD = { pid: 'B2002', title: 'Hello, World!', url: 'https://example.test/d/x/p/B2002' };

function okResult(cases) {
  return {
    compile: { code: 0, stdout: '', stderr: '', timedOut: false },
    cases
  };
}

function reportText(result) {
  return buildReport(RECORD, 'C:\\ws\\main.cpp', result).lines.join('\n');
}

test('first difference ignores trailing blank lines like the runner', () => {
  assert.equal(firstDifference('answer\n\n', 'answer'), null);
});

test('a passing sample is reported as passed, never as site AC', () => {
  const text = reportText(okResult([
    { id: 1, input: '', expected: 'Hello,World!\n', stdout: 'Hello,World!\n', stderr: '', code: 0, timedOut: false, passed: true }
  ]));
  assert.match(text, /样例 1：通过/);
  assert.match(text, /结果：1\/1 组通过/);
  assert.match(text, /本地样例通过不等于网站 AC/);
  assert.doesNotMatch(text, /Accepted|AC：|网站通过/);
});

test('compile failure is distinguished and no sample is run', () => {
  const text = reportText({
    compile: { code: 1, stdout: '', stderr: "main.cpp:3:5: error: 'x' was not declared", timedOut: false },
    cases: []
  });
  assert.match(text, /编译：失败（退出码 1）/);
  assert.match(text, /was not declared/);
  assert.match(text, /编译失败，未运行任何样例/);
  assert.doesNotMatch(text, /组通过/);
});

test('compile timeout is reported separately from a compile error', () => {
  const text = reportText({ compile: { code: null, stdout: '', stderr: '', timedOut: true }, cases: [] });
  assert.match(text, /编译：超时/);
  assert.match(text, /编译未完成，未运行任何样例/);
});

test('timeout and runtime error are classified apart from a wrong answer', () => {
  const text = reportText(okResult([
    { id: 1, input: '5\n', expected: '6\n', stdout: '', stderr: '', code: null, timedOut: true, passed: false },
    { id: 2, input: '1\n', expected: '2\n', stdout: '', stderr: 'boom', code: 3, timedOut: false, passed: false },
    { id: 3, input: '2\n', expected: '3\n', stdout: '4\n', stderr: '', code: 0, timedOut: false, passed: false }
  ]));
  assert.match(text, /样例 1：超时（超出时间限制）/);
  assert.match(text, /样例 2：运行错误（退出码 3）/);
  assert.match(text, /样例 3：输出不符/);
  assert.match(text, /失败分类：输出不符 1，超时 1，运行错误 1。/);
});

test('the first difference ignores trailing spaces just like the comparison', () => {
  // Lines differ only by trailing whitespace, so they must be treated as equal.
  assert.equal(firstDifference('a  \nb\n', 'a\nb\t\n'), null);
});

test('first difference reports line, column and caret position', () => {
  const diff = firstDifference('abc\n', 'abd\n');
  assert.equal(diff.line, 1);
  assert.equal(diff.column, 3);
  const lines = formatFirstDifference(diff).join('\n');
  assert.match(lines, /第 1 行，第 3 列/);
  assert.match(lines, /\^/);
});

test('missing and extra trailing lines are explained in words', () => {
  const missing = firstDifference('a\n', 'a\nb\n');
  assert.equal(missing.reason, 'missing');
  assert.match(formatFirstDifference(missing).join('\n'), /实际输出多出了这一行/);

  const extra = firstDifference('a\nb\n', 'a\n');
  assert.equal(extra.reason, 'extra');
  assert.match(formatFirstDifference(extra).join('\n'), /期望输出中多出的一行/);
});

test('failure output keeps the full expected and actual content viewable', () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
  const text = reportText(okResult([
    { id: 1, input: '7\n', expected: `${long}\nX`, stdout: `${long}\nY`, stderr: '', code: 0, timedOut: false, passed: false }
  ]));
  assert.match(text, /样例 1（输出不符）/);
  assert.match(text, /完整内容：下面按失败样例列出样例输入、期望输出与实际输出/);
  // The full 40-line blocks are present, not just the first differing line.
  assert.match(text, /line 40/);
  assert.match(text, /样例输入：/);
  assert.match(text, /期望输出：/);
  assert.match(text, /实际输出：/);
});

test('an empty block is marked instead of printing a blank gap', () => {
  const text = reportText(okResult([
    { id: 1, input: '', expected: 'Hello', stdout: 'Nope', stderr: '', code: 0, timedOut: false, passed: false }
  ]));
  assert.match(text, /样例输入：\n  （空）/);
});

test('summary counts and message stay consistent', () => {
  const result = okResult([
    { id: 1, input: '', expected: 'a', stdout: 'a', stderr: '', code: 0, timedOut: false, passed: true },
    { id: 2, input: '', expected: 'b', stdout: 'c', stderr: '', code: 0, timedOut: false, passed: false }
  ]);
  const { summary } = buildReport(RECORD, 'C:\\ws\\main.cpp', result);
  assert.deepEqual(
    { total: summary.total, passed: summary.passed, failed: summary.failed, bad: summary.wrongAnswer },
    { total: 2, passed: 1, failed: 1, bad: 1 }
  );
  assert.match(summaryMessage(summary), /1\/2 组样例通过/);
  assert.match(summaryMessage(summary), /不代表网站 AC/);
  assert.match(summaryMessage({ compileFailed: true }), /编译未通过/);
});

test('classifyCase trusts the runner verdict rather than recomputing it', () => {
  // code 0 with matching-looking output, but the runner said it failed.
  assert.equal(classifyCase({ code: 0, timedOut: false, passed: false }).status, 'wrongAnswer');
  assert.equal(classifyCase({ code: 0, timedOut: false, passed: true }).status, 'passed');
  assert.equal(classifyCase({ code: null, timedOut: false, passed: false }).status, 'runtimeError');
});
