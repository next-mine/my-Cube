/**
 * @file 高级流程测试
 * @brief 覆盖：在实体表面画圆并挖洞、旋转体、属性面板改位置、STL 导入、
 *        工程保存/载入。跑法：node tests/e2e-advanced.mjs
 */

import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

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
  await page.waitForTimeout(300);
};

// ═══ ① 在立方体顶面画圆，往下推，挖出一个盲孔 ═══
await page.click('#empty-actions button[data-quick="box"]');
await page.waitForTimeout(500);
await setIso();

const top = await toPage([0, 0, 30]);
const rim = await toPage([10, 0, 30]);
await page.keyboard.press('c');
await page.waitForTimeout(200);
await page.mouse.click(top.x, top.y);
await page.waitForTimeout(300);
await page.mouse.click(rim.x, rim.y);
await page.waitForTimeout(400);
await page.mouse.move(rim.x, rim.y + 95, { steps: 12 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/06-face-cut-preview.png' });
await page.mouse.click(rim.x, rim.y + 95);
await page.waitForTimeout(900);

const cut = await page.evaluate(() => ({
  count: window.cubo.solids.length,
  name: window.cubo.solids[0]?.name,
  volume: window.cubo.solids[0]?.stats()?.volume,
  bbox: window.cubo.solids[0]?.stats()?.bbox,
}));
check(
  '在顶面画圆并向下切除',
  cut.count === 1 && cut.volume > 30000 && cut.volume < 47000,
  JSON.stringify(cut),
);
await page.screenshot({ path: 'shots/07-hole.png' });

// ═══ ② 旋转体：前视平面画截面，闭合后自动旋转 ═══
await page.evaluate(() => window.cubo.newProject());
await page.waitForTimeout(400);
await setIso();
await page.keyboard.press('o');
await page.waitForTimeout(200);

const profile = [
  [10, 0, 0],
  [10, 0, 10],
  [30, 0, 10],
  [30, 0, 0],
  [10, 0, 0],
];
for (const p of profile) {
  const s = await toPage(p);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(180);
}
await page.waitForTimeout(900);
const revolved = await page.evaluate(() => ({
  count: window.cubo.solids.length,
  name: window.cubo.solids[0]?.name,
  volume: window.cubo.solids[0]?.stats()?.volume,
  size: window.cubo.solids[0]?.stats()?.size,
}));
const expected = Math.PI * (30 * 30 - 10 * 10) * 10;
check(
  '旋转体：环状截面转出圆筒',
  revolved.count === 1 && Math.abs(revolved.volume - expected) / expected < 0.02,
  `volume=${revolved.volume?.toFixed(0)} expect≈${expected.toFixed(0)}`,
);
await page.screenshot({ path: 'shots/08-revolve.png' });

// ═══ ③ 属性面板修改位置 ═══
await page.keyboard.press('Escape');
if (await page.evaluate(() => window.cubo.selection.size === 0)) {
  await page.evaluate(() => window.cubo.setSelection([window.cubo.solids[0].id]));
}
const posX = page.locator('#inspector input[data-transform="position"][data-axis="0"]');
await posX.fill('40');
await posX.press('Tab');
await page.waitForTimeout(500);
const moved = await page.evaluate(() => ({
  pos: window.cubo.solids[0].transform.position,
  bbox: window.cubo.solids[0].stats().bbox,
}));
check(
  '属性面板改位置：X 位移生效',
  Math.abs(moved.pos[0] - 40) < 1e-6 && Math.abs(moved.bbox.min[0] - 10) < 0.01,
  JSON.stringify(moved),
);

// ═══ ④ 导入 STL（用上一轮流程测试导出的文件） ═══
const stlPath = 'shots/export-test.stl';
let stlBytes = null;
try {
  stlBytes = readFileSync(stlPath);
} catch {
  console.log('跳过 STL 导入：找不到 shots/export-test.stl（先跑 e2e-flow）');
}
if (stlBytes) {
  const before = await page.evaluate(() => window.cubo.solids.length);
  await page.setInputFiles('#file-input', stlPath);
  await page.waitForTimeout(1500);
  const imported = await page.evaluate(() => ({
    count: window.cubo.solids.length,
    last: window.cubo.solids.at(-1) && {
      name: window.cubo.solids.at(-1).name,
      volume: window.cubo.solids.at(-1).stats().volume,
      tris: window.cubo.solids.at(-1).stats().triangles,
    },
  }));
  check(
    '导入 STL 并识别为封闭实体',
    imported.count === before + 1 && imported.last.volume > 190000 && imported.last.volume < 195000,
    JSON.stringify(imported.last),
  );
  await page.screenshot({ path: 'shots/09-import.png' });
}

// ═══ ⑤ 保存工程 → 新建 → 载入工程 ═══
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  (async () => {
    await page.click('.menu-btn[data-menu="file"]');
    await page.waitForTimeout(200);
    await page.click('.menu-pop .menu-item:has-text("保存工程")');
  })(),
]);
const projPath = await download.path();
const projectJson = JSON.parse(readFileSync(projPath, 'utf8'));
writeFileSync('shots/project-test.cubo.json', JSON.stringify(projectJson));
check(
  '保存工程：JSON 结构正确',
  projectJson.format === 'cubo-project' && projectJson.solids.length >= 1,
  `solids=${projectJson.solids.length}`,
);

await page.evaluate(() => window.cubo.newProject());
await page.waitForTimeout(400);
const empty = await page.evaluate(() => window.cubo.solids.length);
await page.setInputFiles('#file-input', 'shots/project-test.cubo.json');
await page.waitForTimeout(1500);
const loaded = await page.evaluate(() => ({
  count: window.cubo.solids.length,
  name: window.cubo.docName,
}));
check('新建工程清空场景', empty === 0, `solids=${empty}`);
check(
  '载入工程恢复实体',
  loaded.count === projectJson.solids.length,
  `solids=${loaded.count} / ${projectJson.solids.length}`,
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (errors.length) {
  console.log('页面错误:');
  errors.forEach((e) => console.log(' -', e));
}
if (failed || errors.length) process.exitCode = 1;

await browser.close();
