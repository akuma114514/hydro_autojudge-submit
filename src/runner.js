'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

function normalizeOutput(value) {
  return value.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n').replace(/\n+$/g, '');
}

function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env, windowsHide: true, shell: false
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let capturedBytes = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs || 15000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    function capture(chunks, chunk) {
      capturedBytes += chunk.length;
      if (capturedBytes > 2 * 1024 * 1024) {
        outputLimitExceeded = true;
        child.kill();
      } else chunks.push(chunk);
    }
    child.stdout.on('data', chunk => capture(stdoutChunks, chunk));
    child.stderr.on('data', chunk => capture(stderrChunks, chunk));
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        outputLimitExceeded
      });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function runSamples(sourcePath, samples, compilerPath, timeoutMs) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hydro-samples-'));
  const binary = path.join(tempDir, process.platform === 'win32' ? 'program.exe' : 'program');
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
  const env = {
    ...process.env,
    [pathKey]: `${path.dirname(compilerPath)}${path.delimiter}${process.env[pathKey] || ''}`
  };
  try {
    const compile = await execute(compilerPath, ['-std=c++17', sourcePath, '-o', binary], {
      cwd: path.dirname(sourcePath), env, timeoutMs: 30000
    });
    if (compile.code !== 0 || compile.timedOut || compile.outputLimitExceeded) return { compile, cases: [] };
    const cases = [];
    for (const sample of samples) {
      const result = await execute(binary, [], {
        cwd: path.dirname(sourcePath), env, input: sample.input, timeoutMs
      });
      cases.push({
        id: sample.id,
        input: sample.input,
        expected: sample.output,
        ...result,
        passed: result.code === 0 && !result.timedOut && !result.outputLimitExceeded &&
          normalizeOutput(result.stdout) === normalizeOutput(sample.output)
      });
    }
    return { compile, cases };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { normalizeOutput, execute, runSamples };
