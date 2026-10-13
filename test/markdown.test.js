'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../src/markdown');

test('screenshot formulas render inequalities, variables and subscripts as MathML', () => {
  const html = renderMarkdown('第一行包含两个整数 $n$ 和 $m$。 $(1 \\leq n, m \\leq 100000)$\n\n$-1000 \\leq c \\leq 1000$，$a_i^2$');
  assert.ok(html.includes('<math'));
  assert.ok(html.includes('≤'));
  assert.ok(html.includes('<msubsup>'));
  assert.ok(!html.includes('katex-error'));
  assert.ok(!html.includes('$n$'));
});

test('display math and parenthesis delimiters render while code stays literal', () => {
  const html = renderMarkdown('$$\n\\frac{1}{2}\n$$\n\n\\(x \\leq y\\)\n\n`$n$`\n\n```text\n$x$\n```');
  assert.ok(html.includes('math-block'));
  assert.ok(html.includes('<mfrac>'));
  assert.ok(html.includes('<code>$n$</code>'));
  assert.ok(html.includes('$x$'));
});

test('statement previews headings, emphasis, lists, fences and tables', () => {
  const html = renderMarkdown('# 题目\n\n**描述**和 `代码`\n\n- 条件\n\n```cpp\nint x = 1;\n```\n\n| 输入 | 输出 |\n| --- | --- |\n| 1 | 2 |');
  for (const tag of ['<h1>', '<strong>', '<code>', '<ul>', '<pre>', '<table>']) assert.ok(html.includes(tag));
});

test('statement escapes raw HTML and rejects executable links and images', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert)\n\n![x](data:text/html,bad)\n\n[原题](/d/x/p/1)', 'https://example.com/d/x/p/2');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('src="data:'));
  assert.ok(html.includes('href="https://example.com/d/x/p/1"'));
});
