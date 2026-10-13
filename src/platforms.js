'use strict';

const hydro = require('./hydro');
const luogu = require('./luogu');

function resolveProblemUrl(value, allowedOrigin) {
  const url = new URL(value);
  if (url.hostname === 'www.luogu.com.cn') {
    if (url.origin !== 'https://www.luogu.com.cn' || url.username || url.password ||
        !/^\/problem\/(?:P\d+|B\d+|U\d+|T\d+|CF\d+[A-Z]\d*|AT_[A-Za-z0-9_]+|SP\d+)\/?$/.test(url.pathname)) {
      throw new Error('请使用洛谷普通题目链接：https://www.luogu.com.cn/problem/P1001。');
    }
    url.search = '';
    url.hash = '';
    return { platform: 'luogu', url };
  }
  if (url.username || url.password) throw new Error('题目链接不能包含登录凭据。');
  return { platform: 'hydro', url: hydro.validateProblemUrl(value, allowedOrigin) };
}

async function importProblem(target, allowUntrustedCertificate = false) {
  const html = await hydro.fetchPage(target.url, target.platform === 'hydro' && allowUntrustedCertificate);
  const problem = target.platform === 'luogu' ? luogu.parseProblem(html) : hydro.parseProblem(html);
  if (problem.pid !== decodeURIComponent(target.url.pathname.split('/').filter(Boolean).at(-1))) {
    throw new Error('题目页链接与题号不匹配。');
  }
  return { ...problem, platform: target.platform };
}

module.exports = { resolveProblemUrl, importProblem };
