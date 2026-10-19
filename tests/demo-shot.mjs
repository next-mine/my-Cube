/**
 * @file 示例模型截图
 * @brief 载入内置的六角笔筒示例，调整视角并截图，用于展示和文档。
 *        跑法：node tests/demo-shot.mjs
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.CUBO_URL || 'http://127.0.0.1:5273/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--allow-file-access-from-files'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(err.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 30000 });
await page.waitForTimeout(500);
await page.click('#empty-actions button[data-quick="demo"]');
await page.waitForTimeout(800);
await page.evaluate(() => {
  const v = window.cubo.viewport;
  v.setViewPreset('iso', false);
  v.target.set(0, 0, 28);
  v.controls.target.set(0, 0, 28);
  v.controls.update();
  v.camera.position.set(115, -145, 110).add(v.target);
  v.controls.update();
  // 保留选中状态：属性面板里能看到尺寸、体积、打印检查，展示的信息更完整。
  window.cubo.setSelection([window.cubo.solids[0].id]);
});
await page.waitForTimeout(3400); // 等“已载入示例”的 toast 淡出，截一张干净的展示图
await page.screenshot({ path: 'shots/showcase.png' });
await page.screenshot({ path: 'docs/showcase.png' });
const info = await page.evaluate(() => {
  const s = window.cubo.solids[0];
  const st = s.stats();
  return {
    name: s.name,
    volume: st.volume,
    size: st.size.map((n) => +n.toFixed(1)),
    triangles: st.triangles,
    watertight: window.cubo.getPrintReport()?.watertight,
    weight: +window.cubo.getPrintReport()?.weight.toFixed(1),
  };
});
console.log(JSON.stringify(info, null, 2));
if (errors.length) {
  console.log('ERRORS', errors);
  process.exitCode = 1;
}
await browser.close();
