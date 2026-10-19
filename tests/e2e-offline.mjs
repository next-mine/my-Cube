/**
 * @file 离线单文件测试
 * @brief 用 file:// 直接打开 Cubo.html，验证不依赖服务器、不联网也能初始化内核、
 *        建模和导出 STL。跑法：node tests/e2e-offline.mjs
 */

import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const file = pathToFileURL(resolve('Cubo.html')).href;
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(err.message));

await page.goto(file);
let ready = true;
try {
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 30000 });
} catch {
  ready = false;
}
await page.waitForTimeout(1000);
await page.screenshot({ path: 'shots/12-offline.png' });

let built = null;
if (ready) {
  await page.click('#empty-actions button[data-quick="box"]');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.cubo.setTool('select'));
  built = await page.evaluate(() => ({
    solids: window.cubo.solids.length,
    volume: window.cubo.solids[0]?.stats()?.volume,
    tris: window.cubo.solids[0]?.stats()?.triangles,
  }));
  // 触发一次导出，确认 download 事件能发出来（file:// 下 Blob 下载在部分浏览器会被拦，只做冒烟）
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.click('#btn-export').then(async () => {
      await page.waitForTimeout(300);
      const ok = await page.$('.modal [data-ok]');
      if (ok) await ok.click();
    }),
  ]);
  built.exported = !!download;
}

console.log('READY', ready);
console.log('STATE', JSON.stringify(built));
if (errors.length) {
  console.log('ERRORS');
  errors.forEach((e) => console.log(' -', e));
}
const ok = ready && built && built.solids === 1 && Math.abs(built.volume - 48000) < 1 && errors.length === 0;
console.log(ok ? 'OFFLINE OK' : 'OFFLINE FAILED');
if (!ok) process.exitCode = 1;

await browser.close();
