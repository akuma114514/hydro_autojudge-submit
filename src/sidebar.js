'use strict';

const crypto = require('node:crypto');
const { renderMarkdown } = require('./markdown');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const block = (label, value) => `<div class="label">${escape(label)}</div><pre>${escape(value ?? '站点未返回测试数据')}</pre>`;

function renderSidebar(state, nonce) {
  const { record, result, submission, busy, error, source } = state;
  const cases = record?.samples.map(sample => {
    const actual = result?.cases.find(item => item.id === sample.id);
    return `<details><summary>样例 ${escape(sample.id)} · ${actual ? actual.passed ? '通过 ✓' : '失败 ✕' : '未运行'}</summary>${block('输入', sample.input)}${block('预期输出', sample.output)}${actual ? block('实际输出', actual.stdout) + (actual.stderr ? block('错误输出', actual.stderr) : '') + `<p>${actual.timedOut ? '运行超时' : actual.outputLimitExceeded ? '输出超限' : `退出码：${escape(actual.code)}`}</p>` : ''}</details>`;
  }).join('') || '<p>请先导入当前文件的题目样例。</p>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px;font-size:13px}h2{font-size:16px}h3{font-size:14px;margin-top:24px}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:8px 12px;margin:3px;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,summary:focus-visible{outline:1px solid var(--vscode-focusBorder)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--vscode-textCodeBlock-background);padding:8px;max-height:300px;overflow:auto}details{border-bottom:1px solid var(--vscode-panel-border);padding:10px 0}summary{cursor:pointer}.label{opacity:.7;margin-top:10px}.error{color:var(--vscode-errorForeground)}.file{overflow-wrap:anywhere;opacity:.7}
.statement{line-height:1.65;overflow-wrap:anywhere}.statement h1{font-size:1.6em}.statement h2{font-size:1.35em}.statement h3{font-size:1.15em;margin-top:18px}.statement pre{max-height:none;white-space:pre;overflow-wrap:normal;overflow:auto}.statement code{font-family:var(--vscode-editor-font-family);background:var(--vscode-textCodeBlock-background)}.statement :not(pre)>code{padding:2px 4px;border-radius:3px}.statement img{max-width:100%;height:auto}.statement table{display:block;overflow:auto;border-collapse:collapse}.statement th,.statement td{border:1px solid var(--vscode-panel-border);padding:6px 10px}.statement blockquote{margin:12px 0;padding:0 12px;border-left:3px solid var(--vscode-textBlockQuote-border);background:var(--vscode-textBlockQuote-background)}.statement a{color:var(--vscode-textLink-foreground)}
.statement math{font-size:1.1em}.math-block{overflow-x:auto;margin:12px 0;padding:4px 0}.statement .katex-error{color:var(--vscode-errorForeground)}
</style></head><body><h2>${escape(record ? `${record.pid} ${record.title}` : 'Hydro 题目与自测')}</h2><p class="file">${escape(source || '打开工作区内已保存的 C++ 文件')}</p><button data-action="import" ${busy ? 'disabled' : ''}>导入题目</button><button data-action="run" ${busy ? 'disabled' : ''}>${busy ? '自测中…' : '▶ 运行自测'}</button><button data-action="pair">Edge 配对</button>${error ? `<p class="error">${escape(error)}</p>` : ''}
${record ? `<button data-action="problem">打开原题</button><details open><summary>题面</summary><div class="statement">${renderMarkdown(record.content || '旧记录未保存题面，请重新导入。', record.url)}</div></details>` : ''}
<h3>自测数据与结果</h3>${result ? `<p>${result.cases.filter(c => c.passed).length} / ${record?.samples.length || 0} 通过</p>${result.compile.code !== 0 || result.compile.timedOut || result.compile.outputLimitExceeded ? block('编译失败', result.compile.stderr || result.compile.stdout || '编译超时或输出超限') : ''}` : ''}${cases}
<h3>提交结果</h3>${submission ? `<p>${escape(submission.status)}${submission.score != null ? ` · 得分 ${escape(submission.score)}` : ' · 得分暂未返回'}</p>${submission.error ? block('提交错误', submission.error) : ''}${submission.recordUrl ? '<button data-action="record">打开评测记录</button>' : ''}${(submission.failedCases || []).map(c => `<details open><summary>零分测试点 ${escape(c.id)} · 状态 ${escape(c.status)}</summary>${block('输入', c.input)}${block('预期输出', c.expected)}${block('实际输出', c.actual)}${c.message ? block('错误信息', c.message) : ''}</details>`).join('')}${submission.score === 0 && !submission.failedCases?.length ? '<p>站点未返回错误案例内容，请打开评测记录查看。</p>' : ''}` : record?.platform === 'luogu' ? '<p>洛谷暂不支持自动提交。请点击“打开原题”，在网站手动提交。</p>' : '<p>暂无提交记录。全部样例通过且开启自动提交后，会显示提交结果。</p>'}
<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({action:b.dataset.action})));</script></body></html>`;
}

class SidebarProvider {
  constructor(onAction) { this.state = {}; this.onAction = onAction; }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(message => this.onAction(message?.action));
    this.update({});
  }
  update(value) {
    Object.assign(this.state, value);
    if (this.view) this.view.webview.html = renderSidebar(this.state, crypto.randomBytes(16).toString('hex'));
  }
}

module.exports = { SidebarProvider, renderSidebar };
