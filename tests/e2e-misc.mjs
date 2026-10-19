/**
 * @file 杂项功能测试
 * @brief 折线闭合、圆弧、正交投影、智能摆正、Ctrl+N。跑法：node tests/e2e-misc.mjs
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.CUBO_URL || 'http://127.0.0.1:5273/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
};

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 30000 });
await page.waitForTimeout(500);

const canvasRect = await page.evaluate(() => {
  const r = document.querySelector('#viewport-stage canvas').getBoundingClientRect();
  return { x: r.x, y: r.y };
});
const toPage = async (world) => {
  const s = await page.evaluate((w) => window.cubo.viewport.toScreen(w), world);
  return { x: canvasRect.x + s.x, y: canvasRect.y + s.y };
};
const setIso = async () => {
  await page.evaluate(() => {
    const v = window.cubo.viewport;
    v.setViewPreset('iso', false);
    v.target.set(0, 0, 15);
    v.controls.target.set(0, 0, 15);
    v.controls.update();
  });
  await page.waitForTimeout(250);
};

// ① 折线闭合：画一个 60×60 的四边形
await page.evaluate(() => window.cubo.newProject());
await page.waitForTimeout(300);
await setIso();
await page.keyboard.press('l');
await page.waitForTimeout(200);
const poly = [
  [-60, -60, 0],
  [0, -60, 0],
  [0, 0, 0],
  [-60, 0, 0],
  [-60, -60, 0],
];
for (const p of poly) {
  const s = await toPage(p);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(180);
}
await page.waitForTimeout(300);
const last = await toPage([-60, -60, 0]);
await page.mouse.move(last.x, last.y - 60, { steps: 8 });
await page.waitForTimeout(250);
await page.mouse.click(last.x, last.y - 60);
await page.waitForTimeout(800);
const lineResult = await page.evaluate(() => ({
  count: window.cubo.solids.length,
  size: window.cubo.solids.at(-1)?.stats()?.size,
  volume: window.cubo.solids.at(-1)?.stats()?.volume,
  tool: window.cubo.tool,
}));
check(
  '折线工具画四边形并推拉',
  lineResult.count === 1 && Math.abs(lineResult.volume / lineResult.size[2] - 3600) < 20,
  JSON.stringify(lineResult),
);
await page.screenshot({ path: 'shots/13-line.png' });

// ② 圆弧：三点画弓形再推拉
await page.evaluate(() => window.cubo.newProject());
await page.waitForTimeout(300);
await setIso();
await page.keyboard.press('a');
await page.waitForTimeout(200);
const arcPts = [
  [-40, 0, 0],
  [0, 0, 40],
  [40, 0, 0],
];
for (const p of arcPts) {
  const s = await toPage(p);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(300);
const arcScreen = await toPage([20, 0, 20]);
await page.mouse.move(arcScreen.x, arcScreen.y - 60, { steps: 8 });
await page.waitForTimeout(250);
await page.mouse.click(arcScreen.x, arcScreen.y - 60);
await page.waitForTimeout(900);
const arcResult = await page.evaluate(() => ({
  count: window.cubo.solids.length,
  volume: window.cubo.solids.at(-1)?.stats()?.volume,
  size: window.cubo.solids.at(-1)?.stats()?.size,
}));
check(
  '圆弧三点画弓形并推拉',
  arcResult.count === 1 && arcResult.volume > 1000,
  JSON.stringify(arcResult),
);
await page.screenshot({ path: 'shots/14-arc.png' });

// ③ 正交投影切换
await page.click('#projection-toggle button[data-proj="ortho"]');
await page.waitForTimeout(500);
const ortho = await page.evaluate(() => ({
  isOrtho: window.cubo.viewport.camera.isOrthographicCamera === true,
  setting: window.cubo.settings.projection,
}));
check('切换到正交投影', ortho.isOrtho && ortho.setting === 'ortho', JSON.stringify(ortho));
await page.screenshot({ path: 'shots/15-ortho.png' });
await page.click('#projection-toggle button[data-proj="persp"]');
await page.waitForTimeout(300);

// ④ 智能摆正：把实体转歪后一键摆平贴床
await page.evaluate(() => {
  const app = window.cubo;
  const s = app.solids[0];
  s.setTransform({ rotation: [37, 0, 21] });
  app.setSelection([s.id]);
  app.autoOrient();
});
await page.waitForTimeout(600);
const oriented = await page.evaluate(() => {
  const s = window.cubo.solids[0];
  return { bb: s.stats().bbox, rot: s.transform.rotation };
});
check(
  '智能摆正后底面贴床',
  Math.abs(oriented.bb.min[2]) < 0.01 && Math.abs(oriented.rot[0]) < 0.01 && Math.abs(oriented.rot[2]) < 0.01,
  JSON.stringify(oriented.rot),
);

// ⑤ Ctrl+N 新建
await page.evaluate(() => window.cubo.newProject());
await page.waitForTimeout(300);
await page.keyboard.press('Control+n');
await page.waitForTimeout(300);
const newCount = await page.evaluate(() => window.cubo.solids.length);
check('Ctrl+N 新建空工程', newCount === 0, `solids=${newCount}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (errors.length) {
  console.log('页面错误:');
  errors.forEach((e) => console.log(' -', e));
}
if (failed || errors.length) process.exitCode = 1;

await browser.close();
