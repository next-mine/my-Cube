/**
 * @file 浏览器冒烟测试
 * @brief 用系统自带的 Edge 打开开发服务器，等内核初始化完，截一张图并打印关键状态。
 *        跑法：node tests/e2e-smoke.mjs
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
page.on('pageerror', (err) => errors.push(`pageerror: ${err.stack || err.message}`));

await page.goto(URL, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 30000 });
} catch {
  errors.push('内核初始化超时（data-ready 未置 1）');
}

await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/01-boot.png' });

const state = await page.evaluate(() => {
  const app = window.cubo;
  return {
    ready: document.documentElement.dataset.ready,
    canvas: !!document.querySelector('#viewport-stage canvas'),
    solids: app?.solids.length ?? -1,
    tool: app?.tool,
    railButtons: document.querySelectorAll('.tool-btn').length,
    inspectorText: document.getElementById('inspector')?.innerText.slice(0, 120),
  };
});

console.log('STATE', JSON.stringify(state, null, 2));
if (errors.length) {
  console.log('ERRORS');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('NO ERRORS');
}

await browser.close();
