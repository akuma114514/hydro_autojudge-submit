'use strict';

// Display-only helpers for the self-test output panel.
//
// This module deliberately has no VS Code dependency so the formatting and
// diff logic can be unit tested with `node --test`. It never decides whether a
// sample passed — that verdict comes from runner.js via `caseResult.passed` —
// it only renders the verdict that already exists.

const STATUS_LABELS = {
  passed: '通过',
  wrongAnswer: '输出不符',
  runtimeError: '运行错误',
  timedOut: '超时'
};

const MAX_DIFF_LINES = 8;
const MAX_INLINE_CHARS = 200;

function labelFor(status) {
  return STATUS_LABELS[status] || status;
}

function describeExitCode(code) {
  if (code === null || code === undefined) return '被信号终止';
  return `退出码 ${code}`;
}

// Classifies one runner case without re-deriving "passed": the runner owns that
// verdict, and a compile failure is reported separately by the caller.
function classifyCase(caseResult) {
  if (caseResult.outputLimitExceeded) return { status: 'runtimeError', exitText: '输出超过 2 MB 限制' };
  if (caseResult.timedOut) return { status: 'timedOut', exitText: '超出时间限制' };
  if (caseResult.code !== 0) return { status: 'runtimeError', exitText: describeExitCode(caseResult.code) };
  if (!caseResult.passed) return { status: 'wrongAnswer', exitText: describeExitCode(caseResult.code) };
  return { status: 'passed', exitText: describeExitCode(caseResult.code) };
}

// Finds the first differing line, and within it the first differing column.
// Comparison ignores trailing spaces per line and trailing blank lines, matching
// normalizeOutput in runner.js, so the reported difference is never an artifact
// of the ignored whitespace.
function firstDifference(expected, actual) {
  const expectedLines = comparableLines(expected);
  const actualLines = comparableLines(actual);

  const limit = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < limit; i++) {
    const expectedLine = i < expectedLines.length ? expectedLines[i].replace(/[ \t]+$/, '') : undefined;
    const actualLine = i < actualLines.length ? actualLines[i].replace(/[ \t]+$/, '') : undefined;

    if (expectedLine === actualLine) continue;

    if (expectedLine === undefined) {
      return { line: i + 1, column: 1, reason: 'missing', expectedLine: null, actualLine };
    }
    if (actualLine === undefined) {
      return { line: i + 1, column: 1, reason: 'extra', expectedLine, actualLine: null };
    }
    const shared = Math.min(expectedLine.length, actualLine.length);
    let column = 0;
    while (column < shared && expectedLine[column] === actualLine[column]) column++;
    return {
      line: i + 1,
      column: column + 1,
      reason: 'replaced',
      expectedLine,
      actualLine
    };
  }
  return null;
}

function comparableLines(value) {
  const lines = String(value).replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) lines[i] = lines[i].replace(/[ \t]+$/, '');
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

function clip(value) {
  if (value.length <= MAX_INLINE_CHARS) return value;
  return `${value.slice(0, MAX_INLINE_CHARS)}… (共 ${value.length} 字符)`;
}

// Renders the caret and the two lines around the first difference.
function formatFirstDifference(diff) {
  if (!diff) return ['期望输出与实际输出在忽略行末空格与末尾换行后一致。'];
  const lines = [`首处差异：第 ${diff.line} 行，第 ${diff.column} 列`];
  if (diff.reason === 'missing') {
    lines.push('期望输出在该行之后没有更多内容，实际输出多出了这一行。');
    lines.push(`  实际：${clip(diff.actualLine)}`);
  } else if (diff.reason === 'extra') {
    lines.push('实际输出在该行之后没有更多内容，这是期望输出中多出的一行。');
    lines.push(`  期望：${clip(diff.expectedLine)}`);
  } else {
    lines.push(`  期望：${clip(diff.expectedLine)}`);
    lines.push(`  实际：${clip(diff.actualLine)}`);
    const pad = ' '.repeat(8 + Math.max(0, diff.column - 1));
    lines.push(`${pad}^`);
  }
  return lines;
}

// Turns runSamples() output into the lines shown in the panel.
function buildReport(record, sourcePath, result, options = {}) {
  const lines = [];
  const comparisonNote = '比较时忽略每行末尾空格与最后的换行。本地样例通过不等于网站 AC。';
  lines.push(`题目：${record.pid} ${record.title}`.trim());
  if (record.url) lines.push(`来源：${record.url}`);
  lines.push(`源文件：${sourcePath}`);
  lines.push('');

  const compile = result.compile;
  if (compile.timedOut || compile.outputLimitExceeded) {
    lines.push(compile.timedOut ? '编译：超时' : '编译：输出超过 2 MB 限制');
    lines.push(`编译命令：${options.compileCommand || '（未提供）'}`);
    if (compile.stderr) lines.push('编译器输出：', indent(compile.stderr));
    lines.push('', '结果：编译未完成，未运行任何样例。');
    return { lines, summary: { total: 0, passed: 0, failed: 0, compileFailed: true } };
  }
  if (compile.code !== 0) {
    lines.push(`编译：失败（${describeExitCode(compile.code)}）`);
    lines.push(`编译命令：${options.compileCommand || '（未提供）'}`);
    lines.push('编译器输出：', indent(compile.stderr || compile.stdout || '（编译器未输出信息）'));
    lines.push('', '结果：编译失败，未运行任何样例。');
    return { lines, summary: { total: 0, passed: 0, failed: 0, compileFailed: true } };
  }

  lines.push('编译：成功');
  lines.push('');

  const cases = result.cases || [];
  let passed = 0;
  const counted = { passed: 0, wrongAnswer: 0, runtimeError: 0, timedOut: 0 };

  for (const caseResult of cases) {
    const { status, exitText } = classifyCase(caseResult);
    counted[status]++;
    if (caseResult.passed) passed++;
    lines.push(`样例 ${caseResult.id}：${labelFor(status)}（${exitText}）`);

    if (status === 'wrongAnswer') {
      for (const line of formatFirstDifference(firstDifference(caseResult.expected, caseResult.stdout))) {
        lines.push(indent(line));
      }
    }
    if (status === 'timedOut') {
      lines.push(`  程序在超时前未结束，已终止。`);
    }
    if (status === 'runtimeError' && caseResult.stderr) {
      lines.push('  标准错误：', indent(caseResult.stderr, '    '));
    }
  }

  const failed = cases.length - passed;
  lines.push('');
  lines.push(`结果：${passed}/${cases.length} 组通过。${comparisonNote}`);
  if (failed > 0) {
    const parts = [];
    if (counted.wrongAnswer) parts.push(`输出不符 ${counted.wrongAnswer}`);
    if (counted.timedOut) parts.push(`超时 ${counted.timedOut}`);
    if (counted.runtimeError) parts.push(`运行错误 ${counted.runtimeError}`);
    lines.push(`失败分类：${parts.join('，')}。`);
    lines.push('完整内容：下面按失败样例列出样例输入、期望输出与实际输出。');
    for (const caseResult of cases) {
      if (caseResult.passed) continue;
      const { status } = classifyCase(caseResult);
      lines.push('', `—— 样例 ${caseResult.id}（${labelFor(status)}）——`);
      lines.push('样例输入：', indent(caseResult.input ?? '（未记录）'));
      lines.push('期望输出：', indent(caseResult.expected ?? ''));
      lines.push('实际输出：', indent(caseResult.stdout ?? ''));
      if (caseResult.stderr) lines.push('标准错误：', indent(caseResult.stderr));
    }
  }

  return {
    lines,
    summary: { total: cases.length, passed, failed, compileFailed: false, ...counted }
  };
}

function indent(text, prefix = '  ') {
  const value = String(text ?? '');
  const body = value.endsWith('\n') ? value.slice(0, -1) : value;
  if (body === '') return `${prefix}（空）`;
  return body.split('\n').map(line => `${prefix}${line}`).join('\n');
}

// A short one-line summary for the VS Code status message.
function summaryMessage(summary) {
  if (summary.compileFailed) return '本地自测：编译未通过，未运行样例。';
  return `本地自测：${summary.passed}/${summary.total} 组样例通过（本地结果，不代表网站 AC）。`;
}

module.exports = {
  classifyCase,
  firstDifference,
  formatFirstDifference,
  buildReport,
  summaryMessage,
  labelFor,
  describeExitCode,
  indent,
  STATUS_LABELS
};
