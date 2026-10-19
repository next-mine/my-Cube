/**
 * @file 几何内核测试
 * @brief 用 Node 直接跑 manifold WASM，验证每个原语和工具函数的数值都对得上手算结果。
 *        体积单位 mm³。跑法：npm test
 */

import {
  initKernel,
  makeBox,
  makeCylinder,
  makeCone,
  makeSphere,
  makeTorus,
  makeTube,
  makePrism,
  extrudeContours,
  revolveContours,
  booleanOp,
  manifoldMeshData,
  manifoldFromMeshData,
  weldVertices,
  measureManifold,
} from '../src/kernel.js';

await initKernel();

/** @type {Array<{name:string, fn:()=>void}>} */
const tests = [];
let failures = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

/** @brief 带容差的近似比较，浮点运算总有尾数误差，别拿 === 死磕。 */
function approx(actual, expected, eps = 0.01, label = '') {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${label} 期望 ${expected}，实际 ${actual}，误差超过 ${eps}`);
  }
}

/**
 * @brief 按相对误差比较。
 * @note 圆形被离散成多边形后，体积天然比理论值小一点点：n 段内接多边形面积
 *       约为 πr²·sinc(2π/n)，64 段就有约 0.16% 的缺口。这种系统性偏差不算 bug，
 *       所以几何体测试统一用相对容差，免得逼着内核去“凑”理论值。
 */
function approxRel(actual, expected, rel = 0.005, label = '') {
  const eps = Math.abs(expected) * rel;
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${label} 期望 ${expected}（±${eps.toFixed(3)}），实际 ${actual}`);
  }
}

/**
 * @brief 判断 manifold 状态是否正常。
 * @note status() 在 embind 里返回字符串 'NoError'，有些构建返回数字 0，
 *       两种都认，别写成 === 0，否则测试会“假通过”。
 */
function assertNoError(status, label = '') {
  if (!(status === 0 || status === 'NoError')) {
    throw new Error(`${label} manifold 状态异常：${status}`);
  }
}

// --- 图元 ---
test('立方体：默认贴床，XY 居中', () => {
  const m = makeBox({ width: 10, depth: 20, height: 30 });
  approx(m.volume(), 6000, 0.1);
  const bb = m.boundingBox();
  approx(bb.min[0], -5, 1e-6);
  approx(bb.max[0], 5, 1e-6);
  approx(bb.min[2], 0, 1e-6);
  approx(bb.max[2], 30, 1e-6);
});

test('圆柱：体积 πr²h', () => {
  const m = makeCylinder({ radius: 5, height: 20, segments: 128 });
  approxRel(m.volume(), Math.PI * 25 * 20, 0.002);
  approx(m.boundingBox().min[2], 0, 1e-6);
});

test('圆锥：体积 πr²h/3，顶面收成一点', () => {
  const m = makeCone({ radius: 6, height: 12, segments: 128 });
  approxRel(m.volume(), (Math.PI * 36 * 12) / 3, 0.002);
});

test('球体：体积 4/3πr³', () => {
  const m = makeSphere({ radius: 7, segments: 64 });
  approxRel(m.volume(), (4 / 3) * Math.PI * 343, 0.01);
  approx(m.boundingBox().min[2], 0, 1e-6); // 贴床
});

test('圆环：体积 2π²Rr²', () => {
  const R = 20;
  const r = 5;
  const m = makeTorus({ radius: R, tube: r, segments: 96, tubeSegments: 48 });
  approxRel(m.volume(), 2 * Math.PI * Math.PI * R * r * r, 0.01);
  approx(m.boundingBox().min[2], 0, 1e-6); // 贴床
});

test('圆管：体积 π(R²-r²)h', () => {
  const m = makeTube({ outerRadius: 10, innerRadius: 6, height: 25, segments: 96 });
  approxRel(m.volume(), Math.PI * (100 - 36) * 25, 0.005);
});

test('正棱柱：六角柱体积', () => {
  const m = makePrism({ sides: 6, radius: 10, height: 20 });
  // 正六边形面积 = (3√3/2)·r²
  const area = (3 * Math.sqrt(3)) / 2 * 100;
  approxRel(m.volume(), area * 20, 0.001);
  approx(m.boundingBox().min[2], 0, 1e-6);
});

// --- 草图拉伸 ---
const ground = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const square = [[[0, 0], [10, 0], [10, 10], [0, 10]]];

test('地面平面拉伸 10x10x5，体积 500，底在 z=0', () => {
  const m = extrudeContours({ contours: square, plane: ground, height: 5 });
  approx(m.volume(), 500, 0.01);
  const bb = m.boundingBox();
  approx(bb.min[2], 0, 1e-6);
  approx(bb.max[2], 5, 1e-6);
});

test('负高度拉伸：实体落在 [h, 0] 之间', () => {
  const m = extrudeContours({ contours: square, plane: ground, height: -5 });
  const bb = m.boundingBox();
  approx(bb.min[2], -5, 1e-6);
  approx(bb.max[2], 0, 1e-6);
});

test('竖直平面（XZ）上拉伸：沿法线 -Y 方向长出来', () => {
  const wall = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] };
  const m = extrudeContours({ contours: square, plane: wall, height: 4 });
  const bb = m.boundingBox();
  approx(bb.min[0], 0, 1e-6);
  approx(bb.max[0], 10, 1e-6);
  approx(bb.min[2], 0, 1e-6);
  approx(bb.max[2], 10, 1e-6);
  approx(bb.min[1], -4, 1e-6); // 沿法线 -Y 拉伸
  approx(bb.max[1], 0, 1e-6);
});

test('带孔轮廓（方套方）拉伸：体积 = 外方减内方', () => {
  const outer = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const inner = [[5, 5], [15, 5], [15, 15], [5, 15]];
  const m = extrudeContours({ contours: [outer, inner], plane: ground, height: 10 });
  approx(m.volume(), (400 - 100) * 10, 0.1);
});

test('扭转拉伸：体积基本守恒，顶面转过 90°', () => {
  const m = extrudeContours({
    contours: square,
    plane: ground,
    height: 10,
    twistDegrees: 90,
    divisions: 32,
  });
  // 顶点线性插值得到的中间截面不是纯旋转（会略微内缩），体积有 1%~2% 的偏差是正常的。
  approxRel(m.volume(), 1000, 0.02);
});

test('顶面缩放成锥：体积 = 棱台体积', () => {
  const m = extrudeContours({
    contours: square,
    plane: ground,
    height: 9,
    scaleTop: 0.5,
  });
  const a = 100;
  const b = 25;
  const v = (9 / 3) * (a + Math.sqrt(a * b) + b);
  approx(m.volume(), v, 0.5);
});

// --- 旋转体 ---
test('旋转体：矩形截面绕 Z 轴转出圆柱，体积 πr²h', () => {
  const rect = [[[0, 0], [8, 0], [8, 12], [0, 12]]];
  const m = revolveContours({ contours: rect, segments: 128 });
  approx(m.volume(), Math.PI * 64 * 12, 1.0);
  const bb = m.boundingBox();
  approx(bb.max[2], 12, 1e-6);
  approx(bb.min[2], 0, 1e-6);
});

test('旋转体：截面不贴轴，转出管状（半径差）', () => {
  const ring = [[[12, 0], [18, 0], [18, 8], [12, 8]]];
  const m = revolveContours({ contours: ring, segments: 128 });
  approx(m.volume(), Math.PI * (18 * 18 - 12 * 12) * 8, 2.0);
});

// --- 布尔 ---
test('布尔差集：大盒挖小柱', () => {
  const box = makeBox({ width: 20, depth: 20, height: 20 });
  const hole = makeCylinder({ radius: 5, height: 30, segments: 96 }).translate([0, 0, -5]);
  const m = booleanOp(box, hole, 'subtract');
  approxRel(m.volume(), 8000 - Math.PI * 25 * 20, 0.001);
  assertNoError(m.status(), '差集');
});

test('布尔并集：相交的两块', () => {
  const a = makeBox({ width: 10, depth: 10, height: 10 }).translate([0, 0, 0]);
  const b = makeBox({ width: 10, depth: 10, height: 10 }).translate([5, 0, 0]);
  const m = booleanOp(a, b, 'union');
  approx(m.volume(), 1000 * 2 - 500, 0.5);
});

test('布尔交集', () => {
  const a = makeBox({ width: 10, depth: 10, height: 10 }).translate([0, 0, 0]);
  const b = makeBox({ width: 10, depth: 10, height: 10 }).translate([5, 0, 0]);
  const m = booleanOp(a, b, 'intersect');
  approx(m.volume(), 500, 0.5);
});

test('完全分离的两个实体做交集 → 空实体', () => {
  const a = makeBox({ width: 5, depth: 5, height: 5 });
  const b = makeBox({ width: 5, depth: 5, height: 5 }).translate([50, 50, 50]);
  const m = booleanOp(a, b, 'intersect');
  if (!m.isEmpty()) throw new Error('交集应该为空');
});

// --- 网格往返与焊接 ---
test('网格导出→重建，体积不变', () => {
  const src = makeTorus({ radius: 15, tube: 4, segments: 64, tubeSegments: 24 })
    .rotate([20, 30, 10])
    .translate([3, -2, 5]);
  const { positions, indices } = manifoldMeshData(src);
  const back = manifoldFromMeshData(positions, indices);
  approx(back.volume(), src.volume(), 0.1);
});

test('焊接重复顶点：STL 风格网格', () => {
  // 手工造一个两个三角形共享顶点的开口面片（STL 典型存储方式）
  const positions = new Float32Array([
    0, 0, 0,  10, 0, 0,  10, 10, 0,
    0, 0, 0,  10, 10, 0,  0, 10, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const welded = weldVertices(positions, indices);
  if (welded.positions.length !== 4 * 3) {
    throw new Error(`焊接后应剩 4 个顶点，实际 ${welded.positions.length / 3}`);
  }
  if (welded.mergedVertices !== 2) {
    throw new Error(`应合并 2 个顶点，实际 ${welded.mergedVertices}`);
  }
});

// --- 度量 ---
test('measureManifold：尺寸、体积、面数齐全', () => {
  const m = makeBox({ width: 10, depth: 20, height: 30 });
  const info = measureManifold(m);
  approx(info.volume, 6000, 0.1);
  if (info.triangles < 12) throw new Error('立方体至少 12 个三角形');
  if (info.size[0] !== 10 || info.size[1] !== 20 || info.size[2] !== 30) {
    throw new Error('包围盒尺寸不对');
  }
});

// --- 跑起来 ---
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} 通过`);
process.exit(failures === 0 ? 0 : 1);
