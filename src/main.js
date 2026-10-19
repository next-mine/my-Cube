/**
 * @file 入口
 * @brief 启动 Cubo：解码内嵌的 WASM、创建 App、挂到 window.cubo 方便调试和自动化测试。
 */

import { App } from './app.js';
import wasmBase64 from './generated/manifold-wasm.js';

/**
 * @brief base64 → Uint8Array。
 * @param {string} b64 base64 文本。
 * @retval {Uint8Array} 解码后的字节。
 * @note 不用 fetch(dataURL)，是因为 file:// 下有些浏览器会拒绝 data: 请求；
 *       纯 JS 解码在哪都能跑，单文件版才稳。
 */
function decodeBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * @brief 初始化失败时给用户一个能看懂的界面，而不是白屏。
 * @param {Error} err 错误。
 * @retval {void}
 */
function showFatal(err) {
  console.error(err);
  const root = document.getElementById('viewport-stage') || document.body;
  const box = document.createElement('div');
  box.style.cssText =
    'position:absolute;inset:0;display:grid;place-items:center;padding:32px;text-align:center;color:#ffb4b4;font:14px/1.8 "Microsoft YaHei UI",sans-serif;background:#15191f;z-index:99';
  box.innerHTML = `<div><h2 style="color:#ff8a8a">启动失败</h2>
    <p style="max-width:560px;color:#9aa6b6">几何内核没有加载成功。可以把下面的信息发给我：</p>
    <pre style="text-align:left;max-width:640px;overflow:auto;background:#0d1014;padding:14px;border-radius:8px;color:#ffbcbc">${String(
      err?.stack || err,
    )}</pre></div>`;
  root.appendChild(box);
}

try {
  const app = new App();
  window.cubo = app;
  app
    .init({ wasmBinary: decodeBase64(wasmBase64).buffer })
    .then(() => {
      document.documentElement.dataset.ready = '1';
    })
    .catch(showFatal);
} catch (err) {
  showFatal(err);
}
