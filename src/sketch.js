/**
 * @file 草图系统
 * @brief 平面定义、二维/三维坐标换算、吸附，以及草图的实时预览绘制。
 *
 * @note 草图上的点一律存成平面局部坐标 [u, v]，只有渲染和最终建模时才换回世界坐标。
 *       这样「在斜面/立面上画图」和「在地面上画图」走的是同一套逻辑，代码也清爽。
 */

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

/**
 * @brief 用原点、两条切向轴和法线描述一个草图平面。
 * @typedef {{origin:number[], xAxis:number[], yAxis:number[], normal:number[]}} SketchPlane
 */

/** @type {SketchPlane} 地面（XY 平面），默认草图平面。 */
export const GROUND_PLANE = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

/** @type {SketchPlane} 正视平面（XZ），旋转体的截面就画在这里。 */
export const FRONT_PLANE = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 0, 1],
  normal: [0, -1, 0],
};

/** @type {SketchPlane} 右视平面（YZ）。 */
export const RIGHT_PLANE = {
  origin: [0, 0, 0],
  xAxis: [0, 1, 0],
  yAxis: [0, 0, 1],
  normal: [1, 0, 0],
};

/**
 * @brief 依据一个点和法线构造草图平面（用于在实体表面上画图）。
 *
 * @param {THREE.Vector3|number[]} origin 平面上的一点，通常就是鼠标打到的那个位置。
 * @param {THREE.Vector3|number[]} normal 平面法线，通常取命中三角面的法线。
 * @retval {SketchPlane} 构造好的平面，x 轴会自动挑一个和法线不平行的方向。
 *
 * @note x 轴的选择规则：优先用世界 X；如果法线几乎平行于 X（比如侧立面），
 *       就换世界 Y。这样无论画在哪个面上，草图的「水平方向」都不会退化成零向量。
 */
export function planeFromNormal(origin, normal) {
  const o = Array.isArray(origin) ? new THREE.Vector3(...origin) : origin.clone();
  const n = (Array.isArray(normal) ? new THREE.Vector3(...normal) : normal.clone()).normalize();

  const up = new THREE.Vector3(1, 0, 0);
  if (Math.abs(n.dot(up)) > 0.92) up.set(0, 1, 0);
  const x = up.clone().sub(n.clone().multiplyScalar(n.dot(up))).normalize();
  const y = new THREE.Vector3().crossVectors(n, x).normalize();

  return {
    origin: [o.x, o.y, o.z],
    xAxis: [x.x, x.y, x.z],
    yAxis: [y.x, y.y, y.z],
    normal: [n.x, n.y, n.z],
  };
}

/**
 * @brief 世界坐标 → 平面局部坐标。
 * @param {SketchPlane} plane 草图平面。
 * @param {THREE.Vector3|number[]} point 世界坐标。
 * @retval {[number, number]} 平面上的 [u, v]。
 */
export function worldToPlane(plane, point) {
  const p = Array.isArray(point) ? new THREE.Vector3(...point) : point;
  const o = new THREE.Vector3(...plane.origin);
  const x = new THREE.Vector3(...plane.xAxis);
  const y = new THREE.Vector3(...plane.yAxis);
  const d = p.clone().sub(o);
  return [d.dot(x), d.dot(y)];
}

/**
 * @brief 平面局部坐标 → 世界坐标。
 * @param {SketchPlane} plane 草图平面。
 * @param {number} u 横向坐标。
 * @param {number} v 纵向坐标。
 * @param {number} [w=0] 沿法线的偏移，做拉伸预览时会用到。
 * @retval {THREE.Vector3} 世界坐标。
 */
export function planeToWorld(plane, u, v, w = 0) {
  return new THREE.Vector3(...plane.origin)
    .addScaledVector(new THREE.Vector3(...plane.xAxis), u)
    .addScaledVector(new THREE.Vector3(...plane.yAxis), v)
    .addScaledVector(new THREE.Vector3(...plane.normal), w);
}

/**
 * @brief 把一组平面点转成世界坐标点列。
 * @param {SketchPlane} plane 草图平面。
 * @param {number[][]} points [[u,v], ...]
 * @param {number} [w=0] 法线方向偏移。
 * @retval {THREE.Vector3[]}
 */
export function contourToWorld(plane, points, w = 0) {
  return points.map(([u, v]) => planeToWorld(plane, u, v, w));
}

/**
 * @brief 计算封闭轮廓的有向面积（正数表示逆时针）。
 * @param {number[][]} pts [[u,v], ...]
 * @retval {number} 面积，单位 mm²。
 */
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/**
 * @brief 检查轮廓是否足够“像样”（至少三个点、面积不为零）。
 * @param {number[][]} pts 轮廓点列。
 * @retval {boolean}
 */
export function isValidContour(pts) {
  return Array.isArray(pts) && pts.length >= 3 && Math.abs(polygonArea(pts)) > 0.01;
}

/**
 * @brief 吸附：优先贴已有草图顶点，其次贴网格。
 *
 * @param {object} opts
 * @param {SketchPlane} opts.plane 当前草图平面。
 * @param {THREE.Vector3} opts.world 鼠标射线与平面的交点。
 * @param {number[][]} [opts.vertices] 需要吸附的已有点（平面坐标）。
 * @param {number} [opts.gridSize=5] 网格间距（mm）。
 * @param {boolean} [opts.snap=true] 是否开启吸附。
 * @param {number} [opts.vertexTolerance=1.2] 顶点吸附半径（mm）。
 * @retval {{u:number, v:number, snapped:boolean, kind:'vertex'|'grid'|'free'}}
 *
 * @note 顶点吸附用「世界距离」判断而不是屏幕距离：虽然屏幕距离更符合直觉，
 *       但需要相机参与，会让这个纯几何函数变得不好测试。1.2 mm 在大缩放级别下
 *       手感已经够用，而且不会把远处的点吸过来。
 */
export function snapTo({ plane, world, vertices = [], gridSize = 5, snap = true, vertexTolerance = 1.2 }) {
  const [u0, v0] = worldToPlane(plane, world);
  if (!snap) return { u: u0, v: v0, snapped: false, kind: 'free' };

  let best = null;
  let bestDist = vertexTolerance;
  for (const [u, v] of vertices) {
    const d = Math.hypot(u - u0, v - v0);
    if (d < bestDist) {
      bestDist = d;
      best = [u, v];
    }
  }
  if (best) return { u: best[0], v: best[1], snapped: true, kind: 'vertex' };

  const g = Math.max(0.1, gridSize);
  const u = Math.round(u0 / g) * g;
  const v = Math.round(v0 / g) * g;
  // 只有确实靠近网格线时才吸附，否则鼠标会有“一格一格跳”的黏滞感。
  const near = Math.hypot(u - u0, v - v0) <= g * 0.34;
  if (near) {
    return { u: roundClean(u), v: roundClean(v), snapped: true, kind: 'grid' };
  }
  return { u: u0, v: v0, snapped: false, kind: 'free' };
}

/**
 * @brief 去掉浮点尾巴，避免 9.999999999 这种数字显示到界面上。
 * @param {number} n 数值。
 * @retval {number}
 */
export function roundClean(n) {
  return Math.round(n * 1e4) / 1e4;
}

/* ========================================================================== *
 *  轮廓构造
 * ========================================================================== */

/**
 * @brief 由两个对角点构造矩形轮廓。
 * @param {[number,number]} a 第一个角。
 * @param {[number,number]} b 对角。
 * @retval {number[][]} 四个角点，逆时针。
 */
export function buildRect(a, b) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/**
 * @brief 构造正多边形轮廓。
 * @param {[number,number]} center 圆心。
 * @param {[number,number]} edge 圆上一点（决定半径和起始角度）。
 * @param {number} sides 边数。
 * @retval {number[][]} 轮廓点列。
 */
export function buildPolygon(center, edge, sides) {
  const [cx, cy] = center;
  const r = Math.hypot(edge[0] - cx, edge[1] - cy);
  const start = Math.atan2(edge[1] - cy, edge[0] - cx);
  const n = Math.max(3, Math.round(sides));
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = start + (i * Math.PI * 2) / n;
    pts.push([roundClean(cx + Math.cos(a) * r), roundClean(cy + Math.sin(a) * r)]);
  }
  return pts;
}

/**
 * @brief 构造圆形轮廓（用多边形逼近）。
 * @param {[number,number]} center 圆心。
 * @param {[number,number]} edge 圆上一点。
 * @param {number} [maxSegments=96] 最大分段数。
 * @retval {number[][]} 轮廓点列。
 *
 * @note 分段数按半径自适应：半径小的时候 32 段就够光滑，半径大了才加到 96。
 *       固定 96 段会让小圆孔产生大量没必要的三角面，导出 STL 又大又慢。
 */
export function buildCircle(center, edge, maxSegments = 96) {
  const [cx, cy] = center;
  const r = Math.hypot(edge[0] - cx, edge[1] - cy);
  const segments = Math.max(16, Math.min(maxSegments, Math.round(r * 2)));
  const pts = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i * Math.PI * 2) / segments;
    pts.push([roundClean(cx + Math.cos(a) * r), roundClean(cy + Math.sin(a) * r)]);
  }
  return pts;
}

/**
 * @brief 过三点构造圆弧，并用弦把两端连起来，得到一个闭合的「弓形」轮廓。
 *
 * @param {[number,number]} p1 起点。
 * @param {[number,number]} p2 弧上中间点（决定弯曲方向）。
 * @param {[number,number]} p3 终点。
 * @param {number} [segments=48] 圆弧分段数。
 * @retval {number[][]} 闭合轮廓；三点共线时退化成三角形，实在退化就返回空数组。
 *
 * @note 圆心的求法是两条弦的中垂线交点；如果叉积接近 0 说明三点共线，
 *       这时候直接返回 [p1,p2,p3] 组成的三角形，总比报错强。
 */
export function buildArc(p1, p2, p3, segments = 48) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-9) {
    return [p1, p2, p3];
  }
  const ux =
    ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / d;
  const uy =
    ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / d;
  const r = Math.hypot(x1 - ux, y1 - uy);
  const a1 = Math.atan2(y1 - uy, x1 - ux);
  const a2 = Math.atan2(y2 - uy, x2 - ux);
  const a3 = Math.atan2(y3 - uy, x3 - ux);

  // 判断 p2 是否落在 p1→p3 的逆时针弧上，决定扫掠方向。
  const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const ccwSpan = norm(a3 - a1);
  const midOffset = norm(a2 - a1);
  const ccw = midOffset <= ccwSpan;
  const sweep = ccw ? ccwSpan : ccwSpan - Math.PI * 2;

  const n = Math.max(6, Math.round(segments));
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a1 + (sweep * i) / n;
    pts.push([roundClean(ux + Math.cos(a) * r), roundClean(uy + Math.sin(a) * r)]);
  }
  // 弓形：弧的两端用弦连起来，形成闭合轮廓。
  return pts;
}

/**
 * @brief 由折线点列生成闭合轮廓。
 * @param {number[][]} pts 折线点。
 * @retval {number[][]} 去掉重复末点的闭合轮廓。
 */
export function buildPolyline(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) out.pop();
  return out;
}

/* ========================================================================== *
 *  预览渲染
 * ========================================================================== */

/**
 * @brief 草图预览渲染器：负责画平面底、点、线、橡皮筋。
 *
 * @note 线用 three 的 Line2（屏幕空间粗线）而不是普通 LineBasicMaterial：
 *       WebGL 在绝大多数平台上会忽略 linewidth，普通线永远是 1px，
 *       在深色视口里细得像头发丝。Line2 用三角带模拟线段，才能真正画粗。
 */
export class SketchRenderer {
  /**
   * @param {THREE.Group} group 视口提供的草图分组。
   * @param {object} viewport 视口实例（要相机距离来定点的屏幕大小）。
   */
  constructor(group, viewport) {
    this.group = group;
    this.viewport = viewport;
    this.planeGroup = new THREE.Group();
    this.lineGroup = new THREE.Group();
    this.group.add(this.planeGroup, this.lineGroup);
    this.plane = null;

    // 线的粗细单位是屏幕像素，靠 resolution 把像素换算到 NDC，窗口变了要同步。
    this.lineMat = new LineMaterial({
      color: 0x7fe3ff,
      linewidth: 3.2,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
    });
    this.rubberMat = new LineMaterial({
      color: 0x7fe3ff,
      linewidth: 2.6,
      transparent: true,
      opacity: 0.85,
      dashed: true,
      dashSize: 4,
      gapSize: 2.5,
      depthTest: false,
    });
    this.previewMat = new LineMaterial({
      color: 0xffbf5e,
      linewidth: 2.8,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    this.snapMat = new LineMaterial({
      color: 0xffd166,
      linewidth: 2.4,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
    });
    this.materials = [this.lineMat, this.rubberMat, this.previewMat, this.snapMat];
    this.pointMat = new THREE.PointsMaterial({
      color: 0xe9f9ff,
      size: 7,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
    });

    this._onResize = () => this.updateResolution();
    window.addEventListener('resize', this._onResize);
    this.updateResolution();
  }

  /** @brief 把画布尺寸同步给所有粗线材质。 */
  updateResolution() {
    const size = this.viewport.renderer.getSize(new THREE.Vector2());
    for (const m of this.materials) m.resolution.set(size.x, size.y);
  }

  /**
   * @brief 创建一个屏幕空间粗线对象。
   * @param {THREE.Vector3[]} points 至少两个点。
   * @param {LineMaterial} material 材质。
   * @retval {Line2}
   */
  _fat(points, material) {
    const flat = [];
    for (const p of points) flat.push(p.x, p.y, p.z);
    const geo = new LineGeometry();
    geo.setPositions(flat);
    const line = new Line2(geo, material);
    line.computeLineDistances();
    line.frustumCulled = false;
    line.renderOrder = 4;
    return line;
  }

  /**
   * @brief 清空一个分组，并释放它自己的几何体。
   * @param {THREE.Group} group 分组。
   * @note 材质是共享的，不能在这里 dispose；几何体每次重建，必须释放。
   */
  _clearGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose();
      // 平面底板/描边的材质是临时创建的，跟着几何一起释放。
      if (child.userData.ownMaterial) child.material?.dispose();
    }
  }

  /**
   * @brief 设置当前草图平面，并画出半透明底板。
   * @param {SketchPlane|null} plane 平面；null 表示退出草图。
   * @retval {void}
   */
  setPlane(plane) {
    this.plane = plane;
    this._clearGroup(this.planeGroup);
    if (!plane) return;

    const size = 260;
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5fbfff,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.ownMaterial = true;
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...plane.xAxis),
      new THREE.Vector3(...plane.yAxis),
      new THREE.Vector3(...plane.normal),
    );
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.copy(new THREE.Vector3(...plane.origin));
    this.planeGroup.add(mesh);

    // 底板边框：用虚线，避免和实际草图线混淆。
    const half = size / 2;
    const corners = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
      [-half, -half],
    ].map(([u, v]) => planeToWorld(plane, u, v, 0.02));
    const borderMat = new LineMaterial({
      color: 0x5fbfff,
      linewidth: 1.6,
      transparent: true,
      opacity: 0.5,
      dashed: true,
      dashSize: 8,
      gapSize: 6,
      depthTest: false,
    });
    borderMat.resolution.copy(this.lineMat.resolution);
    const border = this._fat(corners, borderMat);
    border.userData.ownMaterial = true;
    border.renderOrder = 2;
    this.planeGroup.add(border);
  }

  /**
   * @brief 更新草图内容。
   *
   * @param {object} state
   * @param {number[][]} [state.points=[]] 已经放下的点。
   * @param {[number,number]|null} [state.cursor] 当前鼠标位置（已吸附）。
   * @param {number[][]} [state.preview] 预览轮廓（矩形/圆等的橡皮筋形状）。
   * @param {boolean} [state.closed=false] 折线是否已经闭合。
   * @param {boolean} [state.snapped=false] 光标是否吸到了东西（画个高亮圈）。
   * @retval {void}
   */
  update({ points = [], cursor = null, preview = null, closed = false, snapped = false }) {
    this._clearGroup(this.lineGroup);
    if (!this.plane) return;

    // 画布尺寸可能在拖动窗口时变了，顺手同步一下。
    this.updateResolution();
    const plane = this.plane;

    // 已放下的折线
    if (points.length > 1) {
      const pts = closed ? [...points, points[0]] : points;
      const line = this._fat(
        pts.map(([u, v]) => planeToWorld(plane, u, v, 0.04)),
        this.lineMat,
      );
      this.lineGroup.add(line);
    }

    // 橡皮筋：最后一点连到光标
    if (cursor && points.length > 0 && !closed) {
      const last = points[points.length - 1];
      const line = this._fat(
        [
          planeToWorld(plane, last[0], last[1], 0.04),
          planeToWorld(plane, cursor[0], cursor[1], 0.04),
        ],
        this.rubberMat,
      );
      this.lineGroup.add(line);
    }

    // 形状预览（矩形第一个角到第二个角、圆的整圈……）
    if (preview && preview.length > 1) {
      const line = this._fat(
        [...preview, preview[0]].map(([u, v]) => planeToWorld(plane, u, v, 0.05)),
        this.previewMat,
      );
      this.lineGroup.add(line);
    }

    // 顶点点列
    if (points.length > 0) {
      const geo = new THREE.BufferGeometry().setFromPoints(
        points.map(([u, v]) => planeToWorld(plane, u, v, 0.06)),
      );
      const dots = new THREE.Points(geo, this.pointMat);
      dots.renderOrder = 6;
      this.lineGroup.add(dots);
    }

    // 吸附高亮：光标处画个小方框
    if (cursor && snapped) {
      const r = 3.4;
      const corners = [
        [cursor[0] - r, cursor[1] - r],
        [cursor[0] + r, cursor[1] - r],
        [cursor[0] + r, cursor[1] + r],
        [cursor[0] - r, cursor[1] + r],
        [cursor[0] - r, cursor[1] - r],
      ].map(([u, v]) => planeToWorld(plane, u, v, 0.08));
      const box = this._fat(corners, this.snapMat);
      box.renderOrder = 7;
      this.lineGroup.add(box);
    }
  }

  /** @brief 清空所有草图预览。 */
  clear() {
    this.plane = null;
    this._clearGroup(this.planeGroup);
    this._clearGroup(this.lineGroup);
  }

  /** @brief 退出时移除窗口监听。 */
  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.clear();
    for (const m of this.materials) m.dispose();
    this.pointMat.dispose();
  }
}

