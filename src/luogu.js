'use strict';

const normalize = value => value.replace(/\r\n?/g, '\n');

function parseProblem(html) {
  const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .find(match => /\bid\s*=\s*["']lentille-context["']/i.test(match[1]));
  if (!script) throw new Error('未找到洛谷公开题目数据。页面可能需要登录或验证，或站点格式已变化，请在浏览器中检查原题。');
  let context;
  try { context = JSON.parse(script[2]); }
  catch { throw new Error('洛谷题目数据格式无效，请稍后重试。'); }
  const problem = context.data?.problem;
  const statement = problem?.contenu;
  if (context.status !== 200 || !problem || typeof problem.pid !== 'string' ||
      !statement || typeof statement.description !== 'string') {
    throw new Error('洛谷未返回可读取的公开题面，请检查题目访问权限。');
  }
  if (!Array.isArray(problem.samples) || !problem.samples.length) {
    throw new Error('洛谷题目没有公开样例，无法进行样例自测。');
  }
  const samples = problem.samples.map((pair, index) => {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(value => typeof value !== 'string')) {
      throw new Error(`洛谷样例 ${index + 1} 缺少有效的输入或输出。`);
    }
    return { id: index + 1, input: normalize(pair[0]), output: normalize(pair[1]) };
  });
  const sections = [['background', '题目背景'], ['description', '题目描述'], ['formatI', '输入格式'], ['formatO', '输出格式']];
  const content = sections.filter(([key]) => typeof statement[key] === 'string' && statement[key])
    .map(([key, label]) => `## ${label}\n\n${normalize(statement[key])}`);
  // A longer fence preserves sample text even when it contains backticks.
  for (const sample of samples) {
    const runs = (sample.input + sample.output).match(/`+/g) || [];
    const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
    content.push(`## 样例 ${sample.id}\n\n${fence}input${sample.id}\n${sample.input}\n${fence}\n\n${fence}output${sample.id}\n${sample.output}\n${fence}`);
  }
  if (typeof statement.hint === 'string' && statement.hint) content.push(`## 说明/提示\n\n${normalize(statement.hint)}`);
  return { pid: problem.pid, title: String(statement.name || problem.name || ''), content: content.join('\n\n'), samples };
}

module.exports = { parseProblem };
