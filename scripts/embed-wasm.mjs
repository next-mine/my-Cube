/**
 * @file 把 manifold.wasm 内嵌成 base64 的 JS 模块
 * @brief 单文件版要靠这段 base64 在 file:// 下直接初始化 WASM，避免 fetch 被
 *        CORS 拦掉。开发时也用同一条路径，省得两套加载逻辑行为不一致。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'node_modules/manifold-3d/manifold.wasm');
const outDir = resolve(root, 'src/generated');
const out = resolve(outDir, 'manifold-wasm.js');

if (!existsSync(src)) {
  console.error(`找不到 ${src}，先运行 pnpm install 吧`);
  process.exit(1);
}

const bytes = readFileSync(src);
mkdirSync(outDir, { recursive: true });
const base64 = bytes.toString('base64');
writeFileSync(
  out,
  `/**
 * 本文件由 scripts/embed-wasm.mjs 自动生成，请勿手改。
 * manifold-3d ${new Date().toISOString()} 的 WASM 二进制（${(bytes.length / 1024).toFixed(0)} KB）。
 */
export default ${JSON.stringify(base64)};
`,
  'utf8',
);
console.log(`已生成 ${out}（${(bytes.length / 1024).toFixed(0)} KB → ${(base64.length / 1024).toFixed(0)} KB base64）`);
