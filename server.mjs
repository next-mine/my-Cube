/**
 * @file 可选的静态服务器
 * @brief 把 dist/ 跑在 http://127.0.0.1:5274 上。单文件版其实双击就能用，
 *        这个服务器主要是给习惯用 localhost 的浏览器/调试场景准备的。
 *
 * 跑法：node server.mjs（先执行 pnpm build）
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT || 5274);

/** @brief 常见静态资源的 MIME 类型。 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = normalize(join(root, relative));

    // 防目录穿越：解析后的路径必须还在 dist 里。
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('没有这个文件；先运行 pnpm build 吧');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Cubo 已启动：http://127.0.0.1:${port}/`);
  console.log(`静态目录：${root}`);
});
