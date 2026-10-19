/**
 * @file 交互细节测试
 * @brief 覆盖：变换 gizmo、测量、数字精确拉伸、多边形、差集、贴床/居中。
 *        跑法：node tests/e2e-extra.mjs
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

// ① 变换 gizmo 出现 / 消失
await page.click('#empty-actions button[data-quick="box"]');
await page.waitForTimeout(500);
await setIso();
await page.keyboard.press('1');
await page.waitForTimeout(400);
const gizmo = await page.evaluate(() => {
  const v = window.cubo.viewport;
  return {
    visible: v.gizmo.getHelper().visible,
    mode: v.gizmo.getMode(),
    target: v.gizmoTarget?.id,
    selected: [...window.cubo.selection][0],
  };
});
check(
  '移动工具显示 gizmo 并挂到选中实体',
  gizmo.visible && gizmo.mode === 'translate' && gizmo.target === gizmo.selected,
  JSON.stringify(gizmo),
);
await page.screenshot({ path: 'shots/10-gizmo.png' });
await page.keyboard.press('Escape');
await page.keyboard.press('q');
await page.waitForTimeout(300);
const gizmoOff = await page.evaluate(() => window.cubo.viewport.gizmo.getHelper().visible);
check('切回选择工具隐藏 gizmo', gizmoOff === false, `visible=${gizmoOff}`);

// ①b gizmo 的变换数学：直接挪锚点，等价于拖动，验证位移/旋转/缩放都绕几何中心
const gizmoMath = await page.evaluate(() => {
  const app = window.cubo;
  const v = app.viewport;
  const s = app.solids[0];
  // Escape 把选择清空了，先选回来，不然 setTool 会因为没有选中项而不挂 gizmo。
  app.setSelection([s.id]);
  const out = {};

  app.setTool('move');
  v.gizmoAnchor.position.x += 10;
  v.gizmoAnchor.updateMatrixWorld(true);
  v._applyGizmoTransform();
  out.moved = s.transform.position[0];

  app.setTool('rotate');
  v.gizmoAnchor.rotation.set(Math.PI / 2, 0, 0);
  v.gizmoAnchor.updateMatrixWorld(true);
  v._applyGizmoTransform();
  out.rotation = s.transform.rotation[0];
  out.rotatedSize = s.stats().size;

  app.setTool('scale');
  v.gizmoAnchor.scale.set(2, 1, 1);
  v.gizmoAnchor.updateMatrixWorld(true);
  v._applyGizmoTransform();
  out.scaledSize = s.stats().size;
  return out;
});
check('gizmo 位移数学', Math.abs(gizmoMath.moved - 10) < 0.01, `x=${gizmoMath.moved}`);
check(
  'gizmo 旋转绕几何中心',
  Math.abs(gizmoMath.rotation - 90) < 0.01 && Math.abs(gizmoMath.rotatedSize[1] - 30) < 0.5,
  JSON.stringify(gizmoMath.rotatedSize),
);
check(
  'gizmo 缩放绕几何中心',
  Math.abs(gizmoMath.scaledSize[0] - 80) < 1,
  JSON.stringify(gizmoMath.scaledSize),
);
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await page.waitForTimeout(500);

// ② 测量：地面上两点相距 100 mm
await page.keyboard.press('m');
await page.waitForTimeout(200);
const a = await toPage([-50, -50, 0]);
const b = await toPage([50, -50, 0]);
await page.mouse.click(a.x, a.y);
await page.waitForTimeout(300);
await page.mouse.click(b.x, b.y);
await page.waitForTimeout(400);
const measureText = await page.textContent('#status-msg');
const measured = Number((measureText.match(/([\d.]+)\s*mm/) || [])[1]);
check('测量距离', Math.abs(measured - 100) < 1.5, measureText.trim());
await page.keyboard.press('Escape');

// ③ 数字精确输入：矩形推拉 25 mm
await page.evaluate(() => window.cubo.newProject());
await page.waitForTimeout(400);
await setIso();
await page.keyboard.press('r');
await page.waitForTimeout(200);
const r1 = await toPage([-40, -40, 0]);
const r2 = await toPage([0, 0, 0]);
await page.mouse.click(r1.x, r1.y);
await page.waitForTimeout(250);
await page.mouse.click(r2.x, r2.y);
await page.waitForTimeout(350);
// 先随便移动一下进入拉伸预览，再敲 2、5、Enter
await page.mouse.move(r2.x, r2.y - 50, { steps: 8 });
await page.waitForTimeout(250);
await page.keyboard.press('2');
await page.waitForTimeout(250);
await page.keyboard.press('5');
await page.waitForTimeout(150);
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
const exact = await page.evaluate(() => {
  const s = window.cubo.solids.at(-1);
  return { count: window.cubo.solids.length, size: s?.stats()?.size, volume: s?.stats()?.volume };
});
check(
  '数字键精确拉伸 25 mm',
  exact.count === 1 && Math.abs(exact.size[2] - 25) < 0.05 && Math.abs(exact.volume - 40 * 40 * 25) < 2,
  JSON.stringify(exact),
);

// ④ 正六边形拉伸
await page.evaluate(() => window.cubo.newProject());
await page.waitForTimeout(400);
await setIso();
await page.keyboard.press('g');
await page.waitForTimeout(200);
const c = await toPage([0, 0, 0]);
const e2 = await toPage([20, 0, 0]);
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(250);
await page.mouse.click(e2.x, e2.y);
await page.waitForTimeout(350);
await page.mouse.move(e2.x, e2.y - 60, { steps: 8 });
await page.waitForTimeout(250);
await page.mouse.click(e2.x, e2.y - 60);
await page.waitForTimeout(700);
const hex = await page.evaluate(() => {
  const s = window.cubo.solids.at(-1);
  return { count: window.cubo.solids.length, size: s?.stats()?.size, volume: s?.stats()?.volume };
});
const hexArea = ((3 * Math.sqrt(3)) / 2) * 400;
check(
  '六边形画完后推拉成六棱柱',
  hex.count === 1 && Math.abs(hex.volume / (hex.size[2] || 1) - hexArea) / hexArea < 0.02,
  JSON.stringify(hex),
);

// ⑤ 差集：立方体减圆柱
await page.evaluate(() => window.cubo.newProject());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const app = window.cubo;
  app.addPrimitive('box');
  app.addPrimitive('cylinder');
});
await page.waitForTimeout(500);
await page.keyboard.press('Control+a');
await page.waitForTimeout(200);
await page.click('#inspector [data-act="boolean"][data-op="subtract"]');
await page.waitForTimeout(800);
const diff = await page.evaluate(() => ({
  count: window.cubo.solids.length,
  name: window.cubo.solids[0]?.name,
  volume: window.cubo.solids[0]?.stats()?.volume,
}));
check(
  '差集：立方体减圆柱',
  diff.count === 1 &&
    diff.name === '差集结果' &&
    Math.abs(diff.volume - 17400) < 500,
  JSON.stringify(diff),
);
await page.screenshot({ path: 'shots/11-subtract.png' });

// ⑥ 贴床 + 居中
await page.evaluate(() => {
  const app = window.cubo;
  const s = app.solids[0];
  s.setTransform({ position: [37, -22, 45], rotation: [0, 0, 0] });
  app.setSelection([s.id]);
  app.dropToBed();
  app.centerOnBed();
});
await page.waitForTimeout(400);
const placed = await page.evaluate(() => {
  const s = window.cubo.solids[0];
  const bb = s.stats().bbox;
  return { bb, pos: s.transform.position };
});
const cx = (placed.bb.min[0] + placed.bb.max[0]) / 2;
const cy = (placed.bb.min[1] + placed.bb.max[1]) / 2;
check(
  '贴床 + 居中：底面 z=0，中心回到原点',
  Math.abs(placed.bb.min[2]) < 0.01 && Math.abs(cx) < 0.01 && Math.abs(cy) < 0.01,
  JSON.stringify(placed),
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (errors.length) {
  console.log('页面错误:');
  errors.forEach((e) => console.log(' -', e));
}
if (failed || errors.length) process.exitCode = 1;

await browser.close();
