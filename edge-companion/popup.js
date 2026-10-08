'use strict';

const pairingInput = document.getElementById('pairing');
const status = document.getElementById('status');

chrome.storage.local.get('pairing').then(({ pairing }) => {
  if (pairing) status.textContent = `已配对本机端口 ${pairing.port}。`;
});

document.getElementById('save').addEventListener('click', async () => {
  try {
    const value = JSON.parse(pairingInput.value);
    if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 ||
        !/^[0-9a-f]{64}$/.test(value.token)) throw new Error('配对信息格式不正确。');
    await chrome.storage.local.set({ pairing: { port: value.port, token: value.token } });
    pairingInput.value = '';
    status.textContent = `已配对本机端口 ${value.port}，正在检查待提交任务。`;
    const result = await chrome.runtime.sendMessage({ type: 'poll-now' });
    status.textContent = result?.message || '检查已完成。';
  } catch (error) { status.textContent = error.message; }
});

document.getElementById('import-current').addEventListener('click', async () => {
  status.textContent = '正在导入当前题目…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'import-current' });
    status.textContent = result?.message || '导入请求已完成。';
  } catch (error) { status.textContent = error.message; }
});
