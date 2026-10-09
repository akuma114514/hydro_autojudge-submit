'use strict';

const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { validateProblemUrl, fetchPage, parseProblem, parseProblemContext } = require('./hydro');
const { saveRecord, loadRecord } = require('./storage');
const { runSamples } = require('./runner');
const { buildReport, summaryMessage } = require('./report');
const { createSubmissionJob, SubmissionBridge } = require('./submission');
const { SidebarProvider } = require('./sidebar');

let extensionContext;
let bridge;
let sidebar;
let running = false;
let refreshVersion = 0;

async function refreshSidebar() {
  const version = ++refreshVersion;
  try {
    const { sourcePath, workspaceRoot } = activeSource();
    let record;
    try { record = await loadRecord(workspaceRoot, sourcePath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (version !== refreshVersion) return;
    sidebar.update({ source: sourcePath, record, result: extensionContext.workspaceState.get(`hydro.run.${sourcePath}`), submission: extensionContext.workspaceState.get(`hydro.latest.${sourcePath}`), busy: running, error: null });
  } catch (error) {
    if (version === refreshVersion) sidebar.update({ source: null, record: null, result: null, submission: null, busy: running, error: error.message });
  }
}

async function ensureBridge() {
  if (bridge) return bridge;
  let token = await extensionContext.secrets.get('hydro.bridgeToken');
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    await extensionContext.secrets.store('hydro.bridgeToken', token);
  }
  const instance = new SubmissionBridge(token, settings().get('bridgePort'), async (job, result) => {
    const submission = {
      status: result.ok ? 'submitted' : 'failed',
      recordUrl: result.recordUrl || null,
      error: result.error || null,
      score: result.score ?? null,
      failedCases: Array.isArray(result.failedCases) ? result.failedCases : []
    };
    await extensionContext.workspaceState.update(`hydro.submission.${job.digest}`, submission);
    await extensionContext.workspaceState.update(`hydro.latest.${job.sourcePath}`, submission);
    await refreshSidebar();
    if (result.ok) {
      const scoreText = typeof result.score === 'number' ? `，得分 ${result.score}` : '，得分暂未返回';
      vscode.window.showInformationMessage(`Hydro 已提交 ${job.pid}${scoreText}。评测记录：${result.recordUrl || '请到网站查看'}`);
    } else {
      vscode.window.showErrorMessage(`Hydro 自动提交失败：${result.error || '未知错误'}`);
    }
  }, importFromEdge);
  await instance.start();
  bridge = instance;
  extensionContext.subscriptions.push({ dispose: () => instance.close() });
  return bridge;
}

async function showPairing() {
  const instance = await ensureBridge();
  await vscode.env.clipboard.writeText(JSON.stringify({
    port: instance.port,
    token: instance.token
  }));
  vscode.window.showInformationMessage('Edge 配对信息已复制到剪贴板，请粘贴到伴随扩展的设置页。');
}

function activeSource() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'cpp' || editor.document.isUntitled) {
    throw new Error('请先打开并保存一个 C++ 源文件。');
  }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) throw new Error('请先在 VS Code 中打开包含该文件的工作区。');
  return { editor, sourcePath: editor.document.uri.fsPath, workspaceRoot: folder.uri.fsPath };
}

function settings() { return vscode.workspace.getConfiguration('hydroSamples'); }

async function importSamples() {
  const { sourcePath, workspaceRoot } = activeSource();
  const config = settings();
  const value = await vscode.window.showInputBox({
    prompt: '粘贴 Hydro 普通题目链接',
    ignoreFocusOut: true
  });
  if (!value) return;
  const url = validateProblemUrl(value, config.get('allowedOrigin'));
  const allowUntrusted = config.get('allowUntrustedCertificate');
  if (allowUntrusted) {
    const choice = await vscode.window.showWarningMessage(
      `将跳过 ${url.origin} 的证书验证以读取公开题面。`, '继续导入'
    );
    if (choice !== '继续导入') return;
  }
  const html = await fetchPage(url, allowUntrusted);
  const problem = parseProblem(html);
  await saveImportedProblem(url, problem, workspaceRoot, sourcePath);
}

async function saveImportedProblem(url, problem, workspaceRoot, sourcePath, { confirmNew = true } = {}) {
  let existing = false;
  try { await loadRecord(workspaceRoot, sourcePath); existing = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const action = existing ? '覆盖旧样例' : '保存样例';
  if (existing || confirmNew) {
    const choice = await vscode.window.showInformationMessage(
      `找到 ${problem.pid} ${problem.title} 的 ${problem.samples.length} 组样例。${existing ? '当前文件已有样例记录，是否覆盖？' : '保存并关联当前文件？'}`,
      action
    );
    if (choice !== action) return { cancelled: true };
  }
  const filename = await saveRecord(workspaceRoot, sourcePath, {
    url: url.toString(), pid: problem.pid, title: problem.title,
    content: problem.content,
    importedAt: new Date().toISOString(), samples: problem.samples
  });
  await extensionContext.workspaceState.update(`hydro.run.${sourcePath}`, undefined);
  await extensionContext.workspaceState.update(`hydro.latest.${sourcePath}`, undefined);
  await refreshSidebar();
  vscode.window.showInformationMessage(`已保存 ${problem.samples.length} 组样例：${filename}`);
  return { pid: problem.pid, count: problem.samples.length };
}

async function importFromEdge(payload) {
  const url = validateProblemUrl(payload?.url, settings().get('allowedOrigin'));
  const problem = parseProblemContext(payload?.context);
  if (String(problem.pid) !== decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1))) {
    throw new Error('题目页链接与题号不匹配。');
  }
  const { editor, sourcePath, workspaceRoot } = activeSource();
  if (editor.document.isDirty && !await editor.document.save()) {
    throw new Error('当前 C++ 文件未保存，已取消导入。');
  }
  return saveImportedProblem(url, problem, workspaceRoot, sourcePath, { confirmNew: false });
}

async function run() {
  const { editor, sourcePath, workspaceRoot } = activeSource();
  if (editor.document.isDirty && !await editor.document.save()) {
    throw new Error('当前 C++ 文件未保存，已取消自测。');
  }
  const config = settings();
  let record;
  try {
    record = await loadRecord(workspaceRoot, sourcePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const choice = await vscode.window.showWarningMessage(
      '当前 C++ 文件还没有导入 Hydro 样例。请先导入题目链接。',
      '现在导入'
    );
    if (choice !== '现在导入') return;
    await importSamples();
    try { record = await loadRecord(workspaceRoot, sourcePath); }
    catch (importError) {
      if (importError.code === 'ENOENT') return;
      throw importError;
    }
  }
  if (!record.samples.length) throw new Error('没有可运行的样例。');
  const compilerPath = config.get('compilerPath');
  const timeoutMs = config.get('timeoutMs');
  const output = vscode.window.createOutputChannel('Hydro 样例自测');
  output.clear();
  output.show(true);
  output.appendLine(`${record.pid} ${record.title}`.trim());
  output.appendLine(`源文件：${sourcePath}`);
  output.appendLine('编译中…');
  const result = await runSamples(sourcePath, record.samples, compilerPath, timeoutMs);
  await extensionContext.workspaceState.update(`hydro.run.${sourcePath}`, result);
  await refreshSidebar();
  const report = buildReport(record, sourcePath, result, {
    compileCommand: `${compilerPath} -std=c++17 ${path.basename(sourcePath)}`
  });
  output.clear();
  for (const line of report.lines) output.appendLine(line);
  const summary = report.summary;
  if (summary.compileFailed) {
    vscode.window.showWarningMessage('Hydro 本地自测：编译未通过，未运行样例。');
    return;
  }
  if (summary.failed === 0) {
    vscode.window.showInformationMessage(summaryMessage(summary));
    if (config.get('autoSubmit')) {
      validateProblemUrl(record.url, config.get('allowedOrigin'));
      const sourceCode = await fs.readFile(sourcePath, 'utf8');
      const job = createSubmissionJob(record, sourceCode, result);
      job.sourcePath = sourcePath;
      const key = `hydro.submission.${job.digest}`;
      const previous = extensionContext.workspaceState.get(key);
      if (previous && previous.status !== 'failed') {
        vscode.window.showInformationMessage(`Hydro 自动提交已跳过：此题同一份代码曾排队或提交（${previous.status}）。`);
      } else {
        const instance = await ensureBridge();
        instance.queue(job);
        await extensionContext.workspaceState.update(key, { status: 'queued', createdAt: job.createdAt });
        await extensionContext.workspaceState.update(`hydro.latest.${sourcePath}`, { status: 'queued', createdAt: job.createdAt });
        await refreshSidebar();
        vscode.window.showInformationMessage('全部本地样例通过；已排队。请在已登录的 Edge 中打开对应题目页，等待伴随扩展提交。');
      }
    }
  } else {
    vscode.window.showWarningMessage(summaryMessage(summary));
  }
}

function activate(context) {
  extensionContext = context;
  sidebar = new SidebarProvider(async action => {
    if (['import', 'run'].includes(action)) return vscode.commands.executeCommand(`hydroSamples.${action}`);
    if (action === 'pair') return vscode.commands.executeCommand('hydroSamples.showPairing');
    const value = action === 'problem' ? sidebar.state.record?.url : action === 'record' ? sidebar.state.submission?.recordUrl : null;
    if (value) {
      try {
        const url = new URL(value);
        if (url.protocol === 'https:' && url.origin === new URL(settings().get('allowedOrigin')).origin) await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
      } catch (error) { vscode.window.showErrorMessage(error.message); }
    }
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('hydroSamples.sidebar', sidebar));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => refreshSidebar()));
  refreshSidebar();
  ensureBridge().catch(error => vscode.window.showWarningMessage(`Hydro 本地桥接启动失败：${error.message}`));
  for (const [command, callback] of [
    ['hydroSamples.import', importSamples],
    ['hydroSamples.run', run],
    ['hydroSamples.showPairing', showPairing]
  ]) {
    context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
      if (running) return;
      try {
        if (command === 'hydroSamples.run') { running = true; sidebar.update({ busy: true }); }
        await callback();
      }
      catch (error) { sidebar.update({ error: error.message }); vscode.window.showErrorMessage(`Hydro: ${error.message}`); }
      finally { running = false; sidebar.update({ busy: false }); }
    }));
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
