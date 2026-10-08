'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

function createSubmissionJob(record, sourceCode, result) {
  if (!record || !Array.isArray(record.samples) || record.samples.length === 0) {
    throw new Error('没有完整样例，不能自动提交。');
  }
  if (!result || result.compile.code !== 0 || result.compile.timedOut ||
      result.compile.outputLimitExceeded || result.cases.length !== record.samples.length ||
      result.cases.some(item => !item.passed)) {
    throw new Error('只有全部公开样例通过后才能自动提交。');
  }
  const url = new URL(record.url);
  if (!/^\/d\/[^/]+\/p\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('自动提交仅支持普通题目链接。');
  }
  if (!sourceCode.trim()) throw new Error('源代码为空，不能提交。');
  const digest = crypto.createHash('sha256').update(url.toString()).update('\0').update(sourceCode).digest('hex');
  return {
    id: crypto.randomUUID(),
    url: url.toString(),
    pid: record.pid,
    lang: 'cc.cc17o2',
    code: sourceCode,
    digest,
    createdAt: new Date().toISOString()
  };
}

class SubmissionBridge {
  constructor(token, port, onResult, onImport) {
    this.token = token;
    this.port = port;
    this.onResult = onResult;
    this.onImport = onImport;
    this.pending = null;
    this.server = null;
  }

  async start() {
    if (this.server) return;
    this.server = http.createServer((request, response) => this.handle(request, response));
    try {
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(this.port, '127.0.0.1', resolve);
      });
    } catch (error) {
      this.server = null;
      throw error;
    }
  }

  close() { this.server?.close(); this.server = null; }

  queue(job) {
    if (this.pending) throw new Error('已有待提交的代码，请等待 Edge 完成。');
    this.pending = job;
    this.claimed = false;
  }

  reply(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  }

  async readJson(request, maxBytes) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('请求内容过大。');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async handle(request, response) {
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      this.reply(response, 401, { error: 'unauthorized' });
      return;
    }
    if (request.method === 'GET' && request.url === '/job') {
      this.reply(response, 200, this.pending && !this.claimed ? {
        id: this.pending.id,
        url: this.pending.url,
        pid: this.pending.pid,
        lang: this.pending.lang
      } : { pending: false });
      return;
    }
    if (request.method === 'GET' && request.url?.startsWith('/claim?id=')) {
      const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('id');
      if (!this.pending || this.claimed || id !== this.pending.id) {
        this.reply(response, 409, { error: '提交任务已领取或不存在。' });
        return;
      }
      this.claimed = true;
      this.reply(response, 200, this.pending);
      return;
    }
    if (request.method === 'POST' && request.url === '/result') {
      try {
        const result = await this.readJson(request, 4096);
        if (!this.pending || !this.claimed || result.id !== this.pending.id || typeof result.ok !== 'boolean') {
          throw new Error('没有对应的待提交任务。');
        }
        const job = this.pending;
        this.pending = null;
        await this.onResult(job, result);
        this.reply(response, 200, { received: true });
      } catch (error) {
        this.reply(response, 400, { error: error.message });
      }
      return;
    }
    if (request.method === 'POST' && request.url === '/import') {
      try {
        if (!this.onImport) throw new Error('当前插件不支持网页导入。');
        const payload = await this.readJson(request, 2 * 1024 * 1024);
        const result = await this.onImport(payload);
        this.reply(response, 200, result);
      } catch (error) {
        this.reply(response, 400, { error: error.message });
      }
      return;
    }
    this.reply(response, 404, { error: 'not found' });
  }
}

module.exports = { createSubmissionJob, SubmissionBridge };
