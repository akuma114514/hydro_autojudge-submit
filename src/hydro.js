'use strict';

const https = require('node:https');

function validateProblemUrl(value, allowedOrigin) {
  const url = new URL(value);
  const origin = new URL(allowedOrigin);
  if (url.protocol !== 'https:' || url.origin !== origin.origin ||
      !/^\/d\/[^/]+\/p\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('只允许配置站点上的 Hydro 普通题目链接。');
  }
  url.hash = '';
  url.search = '';
  return url;
}

function fetchPage(url, allowUntrustedCertificate = false) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      rejectUnauthorized: !allowUntrustedCertificate,
      timeout: 15000,
      headers: { 'User-Agent': 'Hydro-Sample-Runner/0.1' }
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`题目页返回 HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          request.destroy(new Error('题目页超过 2 MB。'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('题目页请求超时。')));
    request.on('error', reject);
  });
}

function readUiContext(html) {
  const marker = "window.UiContextNew = '";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('未找到 Hydro 题目数据。');
  let raw = '';
  for (let i = start + marker.length; i < html.length; i++) {
    if (html[i] === "'" && html[i - 1] !== '\\') break;
    raw += html[i];
  }
  const decoded = raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape) => {
    if (escape[0] === 'u' || escape[0] === 'x') return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[escape] ?? escape;
  });
  const context = JSON.parse(decoded);
  if (!context.pdoc || typeof context.pdoc.content !== 'string') {
    throw new Error('Hydro 题目数据中没有题面。');
  }
  return context;
}

// Fences are collected once, then re-matched by index so the two supported
// formats can never see each other's blocks.
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\n`]*)\r?\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm;

// "样例" / "样例 3" / "样例输入 3" / "样例 3 输入" ± an explicit marker.
// "样例说明" and "样例解释" are explanations, not sample groups, and must not match.
const SAMPLE_HEADING_PATTERN =
  /^[ \t]{0,3}#{1,6}[ \t]*(?:样例|示例|范例|Sample|Example)[ \t]*([0-9]+)?[ \t]*(输入|输出|input|output)?[ \t]*([0-9]+)?[ \t]*[:：]?[ \t]*$/i;

// Any heading that ends the sample region, whatever it says.
const ANY_HEADING_PATTERN = /^[ \t]{0,3}#{1,6}[ \t]*[^\n]*$/gm;

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, '\n');
}

function collectFences(markdown) {
  const fences = [];
  for (const match of markdown.matchAll(FENCE_PATTERN)) {
    fences.push({
      index: match.index,
      end: match.index + match[0].length,
      info: match[2].trim(),
      body: /^\r?\n*$/.test(match[3]) ? '' : normalizeLineEndings(match[3])
    });
  }
  return fences;
}

function extractNumberedSamples(fences) {
  const pairs = new Map();
  for (const fence of fences) {
    const tagged = /^(input|output)[ \t]*(\d+)$/i.exec(fence.info);
    if (!tagged) continue;
    const kind = tagged[1].toLowerCase();
    const id = Number(tagged[2]);
    const pair = pairs.get(id) || {};
    if (Object.hasOwn(pair, kind)) throw new Error(`样例 ${id} 有重复的 ${kind} 代码块。`);
    pair[kind] = fence.body;
    pair[kind === 'input' ? 'inputIndex' : 'outputIndex'] = fence.index;
    pairs.set(id, pair);
  }
  if (!pairs.size) return null;
  return [...pairs]
    .sort((a, b) => a[0] - b[0])
    .map(([id, pair]) => {
      if (!Object.hasOwn(pair, 'input') || !Object.hasOwn(pair, 'output')) {
        throw new Error(`样例 ${id} 缺少输入或输出代码块。`);
      }
      // Hydro renders a sample group side by side, so the input comes first.
      if (pair.outputIndex < pair.inputIndex) {
        throw new Error(`样例 ${id} 的输出代码块出现在输入之前，无法确认配对。`);
      }
      return { id, input: pair.input, output: pair.output };
    });
}

// Splits the markdown into the region under each sample heading. Only headings
// that actually introduce a sample group open a region; everything else ends
// the current one.
function findSampleRegions(markdown) {
  const headings = [...markdown.matchAll(ANY_HEADING_PATTERN)].map(match => {
    const sample = SAMPLE_HEADING_PATTERN.exec(match[0]);
    // The number may precede or follow the 输入/输出 marker.
    const number = sample ? (sample[1] ?? sample[3]) : null;
    return {
      index: match.index,
      index0: match.index + match[0].length,
      isSample: Boolean(sample),
      number: number ? Number(number) : null,
      marker: sample && sample[2] ? sample[2].toLowerCase() : null
    };
  });
  const regions = [];
  for (let i = 0; i < headings.length; i++) {
    if (!headings[i].isSample) continue;
    regions.push({
      start: headings[i].index0,
      end: i + 1 < headings.length ? headings[i + 1].index : markdown.length,
      number: headings[i].number,
      marker: headings[i].marker
    });
  }
  return regions;
}

function extractTitleSamples(markdown, fences) {
  let regions = findSampleRegions(markdown);
  if (!regions.length) return null;

  const cases = [];
  for (const region of regions) {
    const inner = fences.filter(fence => fence.index >= region.start && fence.end <= region.end);
    // An explicit 输入/输出 marker means the region holds exactly one block.
    if (region.marker) {
      const kind = region.marker.startsWith('输') && region.marker !== '输出' ? 'input'
        : region.marker === '输出' ? 'output'
          : region.marker;
      if (inner.length !== 1) {
        throw new Error(`样例标题标注了${kind === 'input' ? '输入' : '输出'}，但其下不是恰好一个代码块。`);
      }
      cases.push({ kind, body: inner[0].body, number: region.number });
      continue;
    }
    // Otherwise the region must hold exactly one input/output pair.
    if (inner.length !== 2) {
      throw new Error(`样例区应包含一组输入和输出代码块，实际找到 ${inner.length} 个。`);
    }
    cases.push({ kind: 'input', body: inner[0].body, number: region.number });
    cases.push({ kind: 'output', body: inner[1].body, number: region.number });
  }

  // Pair sequentially: each input takes the next output after it.
  const samples = [];
  const pending = [];
  for (const item of cases) {
    if (item.kind === 'input') {
      if (pending.length) throw new Error('题面有未配对的输入代码块。');
      pending.push(item);
      continue;
    }
    if (!pending.length) throw new Error('题面有未配对的输出代码块。');
    const input = pending.pop();
    if (input.number !== null && item.number !== null && input.number !== item.number) {
      throw new Error(`样例 ${input.number} 的输入与样例 ${item.number} 的输出无法配对。`);
    }
    samples.push({ id: item.number ?? input.number ?? samples.length + 1, input: input.body, output: item.body });
  }
  if (pending.length) throw new Error('题面有未配对的输入代码块。');
  if (!samples.length) return null;

  // A lone group carrying no number keeps id 1; numbered groups win outright.
  const numbered = samples.some(sample => sample.id !== undefined && sample.id !== null);
  return samples.map((sample, position) => ({
    id: numbered ? sample.id : position + 1,
    input: sample.input,
    output: sample.output
  }));
}

function extractSamples(markdown) {
  if (typeof markdown !== 'string') throw new Error('题面内容不是文本，无法解析样例。');
  const normalized = normalizeLineEndings(markdown);
  const fences = collectFences(normalized);
  const numbered = extractNumberedSamples(fences);
  if (numbered) return numbered;
  const titled = extractTitleSamples(normalized, fences);
  if (titled) return titled;
  throw new Error(
    '题面没有可识别的样例。支持的写法：带编号的 ```inputN```/```outputN``` 代码块，' +
    '或“样例”标题下成对出现的输入/输出代码块。'
  );
}

function parseProblem(html) {
  return parseProblemContext(readUiContext(html));
}

function parseProblemContext(context) {
  if (!context || typeof context !== 'object' || !context.pdoc || typeof context.pdoc.content !== 'string') {
    throw new Error('Hydro 题目数据中没有题面。');
  }
  let content = context.pdoc.content;
  try {
    const languages = JSON.parse(content);
    if (typeof languages === 'object' && languages !== null) {
      content = languages.zh || languages.en || Object.values(languages).find(v => typeof v === 'string');
    }
  } catch { /* plain Markdown */ }
  if (typeof content !== 'string') throw new Error('无法读取题面文本。');
  return {
    pid: String(context.pdoc.pid || context.problemId || ''),
    title: String(context.pdoc.title || ''),
    content,
    samples: extractSamples(content)
  };
}

module.exports = { validateProblemUrl, fetchPage, readUiContext, extractSamples, parseProblem, parseProblemContext };
