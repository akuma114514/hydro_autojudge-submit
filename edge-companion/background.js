'use strict';

const ALLOWED_ORIGIN = 'https://frp-fan.com:36387';
let working = false;

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('hydro-poll', { periodInMinutes: 0.5 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('hydro-poll', { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'hydro-poll') poll().catch(() => {}); });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'poll-now' && message?.type !== 'import-current') return;
  const task = message.type === 'poll-now' ? poll() : importCurrentPage();
  task.then(result => sendResponse({ message: result })).catch(error => sendResponse({ message: error.message }));
  return true;
});

async function bridgeRequest(pairing, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${pairing.port}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${pairing.token}`, ...options.headers }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `本地桥接返回 HTTP ${response.status}`);
  return body;
}

async function poll() {
  if (working) return '已有提交任务正在处理。';
  working = true;
  try {
    const { pairing } = await chrome.storage.local.get('pairing');
    if (!pairing) return '尚未配对。';
    const job = await bridgeRequest(pairing, '/job');
    if (!job.id) return '目前没有待提交任务。';
    const url = new URL(job.url);
    if (url.origin !== ALLOWED_ORIGIN || !/^\/d\/[^/]+\/p\/[^/]+\/?$/.test(url.pathname) ||
        job.lang !== 'cc.cc17o2') {
      throw new Error('待提交任务的站点、题目或语言不受支持。');
    }
    const tabs = await chrome.tabs.query({ url: 'https://frp-fan.com/*' });
    const tab = tabs.find(item => item.url && new URL(item.url).origin === ALLOWED_ORIGIN &&
      new URL(item.url).pathname === url.pathname && item.status === 'complete');
    if (!tab) return '请在 Edge 中打开并登录待提交题目的页面，随后会自动继续。';
    const claimed = await bridgeRequest(pairing, `/claim?id=${encodeURIComponent(job.id)}`);
    if (typeof claimed.code !== 'string') throw new Error('待提交任务没有源代码。');

    let result;
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN',
        func: submitOnHydroPage,
        args: [{ pid: claimed.pid, lang: claimed.lang, code: claimed.code }]
      });
      result = injected[0]?.result || { ok: false, error: '未收到题目页的提交结果。' };
    } catch (error) { result = { ok: false, error: error.message }; }
    await bridgeRequest(pairing, '/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id, ...result })
    });
    return result.ok ? `已提交 ${job.pid}，请查看网站评测结果。` : `提交失败：${result.error}`;
  } finally { working = false; }
}

async function importCurrentPage() {
  const { pairing } = await chrome.storage.local.get('pairing');
  if (!pairing) throw new Error('请先配对 VS Code 插件。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('请先打开 Hydro 题目页。');
  const url = new URL(tab.url);
  if (url.origin !== ALLOWED_ORIGIN || !/^\/d\/[^/]+\/p\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('当前标签页不是支持的 Hydro 普通题目。');
  }
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN', func: readCurrentProblem
  });
  const context = injected[0]?.result;
  if (!context?.pdoc) throw new Error('题目页尚未加载题面。');
  const result = await bridgeRequest(pairing, '/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url.toString(), context })
  });
  return result.cancelled ? '已取消导入。' : `已将 ${result.pid} 的 ${result.count} 组样例导入 VS Code 当前 C++ 文件。`;
}

function readCurrentProblem() {
  const value = window.UiContextNew;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function submitOnHydroPage(job) {
  try {
    const readContext = value => {
      if (value == null) return {};
      if (typeof value === 'string') return JSON.parse(value);
      if (typeof value === 'object' && !Array.isArray(value)) return value;
      throw new Error('Hydro 页面数据格式无效。');
    };
    const context = readContext(window.UiContextNew);
    if (String(context.problemId) !== String(job.pid) || !context.postSubmitUrl) {
      throw new Error('题目页与待提交代码不匹配。');
    }
    const user = readContext(window.UserContext);
    if (!Number.isInteger(user._id) || user._id <= 0) throw new Error('尚未在 Hydro 登录。');
    const endpoint = new URL(context.postSubmitUrl, location.href);
    if (endpoint.origin !== location.origin || !endpoint.pathname.endsWith('/submit')) {
      throw new Error('Hydro 提交地址无效。');
    }
    const body = new FormData();
    body.append('lang', job.lang);
    body.append('code', job.code);
    const response = await fetch(endpoint, {
      method: 'POST', body, credentials: 'same-origin', redirect: 'follow',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error(`Hydro 返回 HTTP ${response.status}。`);
    const finalUrl = new URL(response.url);
    let recordUrl;
    if (finalUrl.origin === location.origin && /\/record\/[a-zA-Z0-9]+\/?$/.test(finalUrl.pathname)) {
      recordUrl = finalUrl.toString();
    } else {
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); } catch { /* non-JSON response */ }
      if (payload?.rid) {
        recordUrl = new URL(`/d/${location.pathname.split('/')[2]}/record/${payload.rid}`, location.origin).toString();
      }
    }
    if (!recordUrl) throw new Error('Hydro 未返回评测记录；请检查是否已登录或站点是否拒绝了提交。');
    let score;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const detail = await fetch(recordUrl, {
          credentials: 'same-origin',
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (detail.ok) {
          const body = await detail.text();
          let data;
          try { data = JSON.parse(body); } catch { /* HTML fallback below */ }
          if (!data) {
            const marker = "window.UiContextNew = '";
            const start = body.indexOf(marker);
            if (start >= 0) {
              let raw = '';
              for (let i = start + marker.length; i < body.length; i++) {
                if (body[i] === "'" && body[i - 1] !== '\\') break;
                raw += body[i];
              }
              const decoded = raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape) => {
                if (escape[0] === 'u' || escape[0] === 'x') return String.fromCharCode(parseInt(escape.slice(1), 16));
                return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[escape] ?? escape;
              });
              data = JSON.parse(decoded);
            }
          }
          const rdoc = data?.rdoc || data?.UiContext?.rdoc;
          if (rdoc && ![0, 20, 21, 22].includes(rdoc.status) &&
              typeof rdoc.score === 'number' && Number.isFinite(rdoc.score)) {
            score = rdoc.score;
            break;
          }
        }
      } catch { /* judge result may not be ready yet */ }
      if (attempt < 29) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return { ok: true, recordUrl, ...(score === undefined ? {} : { score }) };
  } catch (error) { return { ok: false, error: error.message }; }
}
