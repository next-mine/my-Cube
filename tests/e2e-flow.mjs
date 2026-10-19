/**
 * @file 端到端流程测试
 * @brief 用真实鼠标键盘走一遍：放图元 → 并集 → 顶视图画矩形 → 推拉 → 导出 STL →
 *        撤销/重做，并逐步截图。跑法：node tests/e2e-flow.mjs
 */

import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, statSync } from 'node:fs';

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
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
};

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 30000 });
await page.waitForTimeout(600);

// ① 空场景放一个立方体
await page.click('#empty-actions button[data-quick="box"]');
await page.waitForTimeout(500);
let count = await page.evaluate(() => window.cubo.solids.length);
check('空场景添加立方体', count === 1, `solids=${count}`);

// ② 从图元菜单加圆柱
await page.click('.tool-btn[data-action="primitives"]');
await page.waitForTimeout(200);
await page.click('.menu-pop .menu-item:has-text("圆柱")');
await page.waitForTimeout(500);
count = await page.evaluate(() => window.cubo.solids.length);
check('添加圆柱', count === 2, `solids=${count}`);

// ③ 全选 + 并集
await page.keyboard.press('Control+a');
await page.waitForTimeout(200);
await page.click('#inspector [data-act="boolean"][data-op="union"]');
await page.waitForTimeout(700);
count = await page.evaluate(() => window.cubo.solids.length);
const unionName = await page.evaluate(() => window.cubo.solids[0]?.name);
check('并集把两个实体合成一个', count === 1 && unionName === '并集结果', `solids=${count} name=${unionName}`);

await page.screenshot({ path: 'shots/02-union.png' });

// ④ 用矩形工具在地面画一个 50×50 的方块，再往上拖出高度
// 先把相机拉到能看见整块打印床的距离，再把世界坐标换算成屏幕坐标去点，
// 这样不依赖窗口尺寸，换了分辨率也不会点偏。
await page.evaluate(() => {
  const v = window.cubo.viewport;
  v.setViewPreset('iso', false);
  v.target.set(0, 0, 0);
  v.controls.target.set(0, 0, 0);
  v.controls.update();
});
await page.waitForTimeout(400);
const canvasRect = await page.evaluate(() => {
  const r = document.querySelector('#viewport-stage canvas').getBoundingClientRect();
  return { x: r.x, y: r.y };
});
const toPage = async (world) => {
  const s = await page.evaluate((w) => window.cubo.viewport.toScreen(w), world);
  return { x: canvasRect.x + s.x, y: canvasRect.y + s.y };
};
const p1 = await toPage([-80, -80, 0]);
const p2 = await toPage([-30, -30, 0]);
check('投影点落在视口内', p1.y > 60 && p1.y < 880 && p2.x > 70 && p2.x < 1130, JSON.stringify({ p1, p2 }));

await page.keyboard.press('r');
await page.waitForTimeout(200);
await page.mouse.click(p1.x, p1.y);
await page.waitForTimeout(250);
await page.mouse.click(p2.x, p2.y);
await page.waitForTimeout(350);
// 往上拖，用屏幕位移把“推拉高度”拖出来
await page.mouse.move(p2.x, p2.y - 110, { steps: 12 });
await page.waitForTimeout(350);
await page.screenshot({ path: 'shots/03-extrude-preview.png' });
await page.mouse.click(p2.x, p2.y - 110);
await page.waitForTimeout(900);

const afterExtrude = await page.evaluate(() => ({
  count: window.cubo.solids.length,
  tool: window.cubo.tool,
  name: window.cubo.solids.at(-1)?.name,
  volume: window.cubo.solids.at(-1)?.stats()?.volume,
}));
check(
  '矩形推拉出新实体',
  afterExtrude.count === 2 && (afterExtrude.volume || 0) > 100,
  JSON.stringify(afterExtrude),
);
await page.screenshot({ path: 'shots/04-after-extrude.png' });

// ⑤ 导出 STL（二进制），检查文件头里的三角形数量
await page.click('#btn-export');
await page.waitForSelector('.modal .modal-body', { timeout: 5000 });
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.click('.modal [data-ok]'),
]);
const stlPath = await download.path();
const buf = readFileSync(stlPath);
const triCount = buf.readUInt32LE(80);
const sizeOk = buf.length === 84 + triCount * 50;
check('导出二进制 STL', triCount > 0 && sizeOk, `tris=${triCount} bytes=${buf.length}`);
const savedTo = 'shots/export-test.stl';
const fs = await import('node:fs');
fs.writeFileSync(savedTo, buf);
console.log('      STL 已留档:', savedTo, statSync(savedTo).size, '字节');

// ⑥ 撤销 / 重做
await page.keyboard.press('Control+z');
await page.waitForTimeout(600);
const afterUndo = await page.evaluate(() => window.cubo.solids.length);
await page.keyboard.press('Control+y');
await page.waitForTimeout(600);
const afterRedo = await page.evaluate(() => window.cubo.solids.length);
check('撤销回到 1 个实体', afterUndo === 1, `solids=${afterUndo}`);
check('重做回到 2 个实体', afterRedo === 2, `solids=${afterRedo}`);

// ⑦ 回到等轴测截个成品图
await page.click('#view-presets button[data-view="iso"]');
await page.waitForTimeout(300);
await page.keyboard.press('f');
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/05-final.png' });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (errors.length) {
  console.log('页面错误:');
  errors.forEach((e) => console.log(' -', e));
}
if (failed || errors.length) process.exitCode = 1;

await browser.close();
