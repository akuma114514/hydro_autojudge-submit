'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveProblemUrl } = require('../src/platforms');
const { parseProblem } = require('../src/luogu');
const { renderSidebar } = require('../src/sidebar');
const origin = 'https://frp-fan.com:36387';
const page = problem => `<script type="application/json" id="lentille-context">${JSON.stringify({ status: 200, data: { problem } })}</script>`;
const fixture = () => ({ pid: 'P1001', name: 'A+B', contenu: { description: '计算 $a+b$。', formatI: '两个整数', formatO: '和' }, samples: [['20 30\r\n', '50\r\n'], ['', 'hello\n']] });

test('platform routing preserves Hydro and canonicalizes Luogu', () => {
  assert.equal(resolveProblemUrl(`${origin}/d/demo/p/1`, origin).platform, 'hydro');
  const target = resolveProblemUrl('https://www.luogu.com.cn/problem/P1001?lang=zh#submit', origin);
  assert.equal(target.platform, 'luogu');
  assert.equal(target.url.href, 'https://www.luogu.com.cn/problem/P1001');
  for (const url of ['http://www.luogu.com.cn/problem/P1001', 'https://www.luogu.com.cn:444/problem/P1001', 'https://www.luogu.com.cn.evil.test/problem/P1001', 'https://www.luogu.com.cn/problem/P1001/solution', 'https://user:pass@www.luogu.com.cn/problem/P1001', 'https://www.luogu.com.cn/contest/1']) {
    assert.throws(() => resolveProblemUrl(url, origin));
  }
});

test('Luogu structured samples preserve whitespace, empty input and order', () => {
  const problem = parseProblem(page(fixture()));
  assert.equal(problem.pid, 'P1001');
  assert.deepEqual(problem.samples, [{ id: 1, input: '20 30\n', output: '50\n' }, { id: 2, input: '', output: 'hello\n' }]);
  assert.match(problem.content, /## 输入格式/);
  assert.match(problem.content, /计算 \$a\+b\$/);
});

test('Luogu rejects challenge pages, missing samples and malformed pairs', () => {
  assert.throws(() => parseProblem('<html>验证</html>'), /未找到/);
  assert.throws(() => parseProblem('<script id="lentille-context">oops</script>'), /格式无效/);
  assert.throws(() => parseProblem(page({ ...fixture(), samples: [] })), /没有公开样例/);
  assert.throws(() => parseProblem(page({ ...fixture(), samples: [['input']] })), /缺少有效/);
  assert.throws(() => parseProblem(page({ ...fixture(), contenu: null })), /访问权限/);
});

test('Luogu sidebar explains manual submission', () => {
  const record = { ...parseProblem(page(fixture())), platform: 'luogu', url: 'https://www.luogu.com.cn/problem/P1001' };
  const html = renderSidebar({ record }, 'test');
  assert.match(html, /洛谷暂不支持自动提交/);
  assert.match(html, /data-action="problem"/);
  assert.doesNotMatch(html, /全部样例通过且开启自动提交后/);
});
