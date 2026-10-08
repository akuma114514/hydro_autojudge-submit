'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function recordPath(workspaceRoot, sourcePath) {
  const relative = path.relative(workspaceRoot, sourcePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('当前 C++ 文件不在打开的工作区内。');
  }
  const id = crypto.createHash('sha256').update(relative.toLowerCase()).digest('hex').slice(0, 16);
  return path.join(workspaceRoot, '.hydro-samples', `${id}.json`);
}

async function saveRecord(workspaceRoot, sourcePath, record) {
  const filename = recordPath(workspaceRoot, sourcePath);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify({
    schemaVersion: 1,
    source: path.relative(workspaceRoot, sourcePath),
    ...record
  }, null, 2) + '\n', { flag: 'w' });
  return filename;
}

async function loadRecord(workspaceRoot, sourcePath) {
  const filename = recordPath(workspaceRoot, sourcePath);
  const record = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (record.schemaVersion !== 1 || !Array.isArray(record.samples)) {
    throw new Error('样例文件格式不受支持，请重新导入。');
  }
  return record;
}

module.exports = { recordPath, saveRecord, loadRecord };
