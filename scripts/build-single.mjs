/**
 * @file 构建离线单文件 Cubo.html
 * @brief 先跑 vite build，再把产出的 JS / CSS 全部塞回 HTML 里，生成一个
 *        双击就能打开、完全离线、不需要服务器的单文件应用。
 *
 * 为什么不用现成的 singlefile 插件：我们只需要处理「一个入口 JS + 一个 CSS」，
 * 自己写二十行比引一个插件更可控，也顺便能看到每一步替换了什么。
 *
 * 跑法：node scripts/build-single.mjs
 */

import { build } from 'vite';
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');

console.log('[1/3] 正在执行 vite build…');
await build({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'warn' });

console.log('[2/3] 正在把资源内联进 HTML…');
let html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const assetsDir = resolve(dist, 'assets');

/**
 * @brief 把 HTML 里引用某个资源的地方替换成其文本内容。
 * @param {RegExp} re 匹配整个标签的正则。
 * @param {(file:string)=>string} wrap 把资源文本包成内联标签。
 * @param {string} kind 资源说明，用于日志。
 * @retval {number} 替换次数。
 */
function inline(re, wrap, kind) {
  let count = 0;
  html = html.replace(re, (match, file) => {
    const path = resolve(dist, String(file).replace(/^[./]+/, ''));
    let content;
    try {
      content = readFileSync(path, 'utf8');
    } catch (err) {
      console.warn(`  ! 找不到 ${kind} ${file}，保留原引用`, err.message);
      return match;
    }
    count += 1;
    return wrap(content);
  });
  console.log(`  - ${kind}: 内联 ${count} 个`);
  return count;
}

inline(
  /<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (css) => `<style>\n${css}\n</style>`,
  '样式',
);
inline(
  /<script[^>]+type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (js) => `<script type="module">\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`,
  '脚本',
);

// modulepreload 指向的 chunk 通常已经被打进入口文件，直接删掉，避免 file:// 下 404。
html = html.replace(/\s*<link[^>]+rel="modulepreload"[^>]*>/g, '');
// 内联之后 crossorigin 和 assets 目录都没意义了，清一下让标签更干净。
html = html.replace(/\s+crossorigin/g, '');

if (/src="\.\/assets\//.test(html) || /href="\.\/assets\//.test(html)) {
  console.warn('  ! 还有资源没内联，单文件在 file:// 下可能打不开');
}

const outFile = resolve(dist, 'Cubo.html');
writeFileSync(outFile, html, 'utf8');
// 项目根目录也放一份，方便直接双击；构建产物仍然保留在 dist 里。
writeFileSync(resolve(root, 'Cubo.html'), html, 'utf8');

const kb = (statSync(outFile).size / 1024).toFixed(0);
console.log(`[3/3] 完成：${outFile}（${kb} KB）`);
console.log(`      同时写了一份到 ${resolve(root, 'Cubo.html')}`);
console.log(`      dist/assets 里是拆分后的原始产物：${readdirSync(assetsDir).join(', ')}`);
