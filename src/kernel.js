/**
 * @file 几何内核 —— 把 manifold-3d 的 WASM 实体建模库包装成一套「毫米制」原语。
 *
 * @brief 这一层是整个软件的“心脏”：所有实体（立方体、拉伸体、布尔结果……）都是
 *        manifold 的流形网格，天然封闭、法线朝外，正好满足 3D 打印对水密性的要求。
 *        上层界面只跟本文件导出的函数打交道，不直接碰 WASM。
 *
 * @note 单位约定：1 个世界单位 = 1 毫米。界面里显示的 20 就是 20 mm，导出 STL 时
 *       直接写进去，不再做任何缩放。这样能避免“导出来小了 10 倍”这种经典惨案～
 */

import Module from 'manifold-3d';

/** @type {any} WASM 模块实例，初始化完成后才有值 */
let kernel = null;

/** @type {Promise<any>|null} 初始化进行中的 Promise，防止并发重复加载 */
let loading = null;

/**
 * @brief 加载并初始化 manifold 的 WASM 内核（幂等，重复调用返回同一个实例）。
 *
 * @param {object} [options] 传给 Emscripten 工厂的参数。
 * @param {ArrayBuffer|Uint8Array} [options.wasmBinary] 直接给 WASM 字节码，离线单文件版用。
 * @param {(path: string) => string} [options.locateFile] 自定义 wasm 路径解析。
 * @retval {Promise<any>} 初始化好的内核对象（含 Manifold / CrossSection / Mesh）。
 *
 * @note 初始化只需要一次，但可能被多个模块同时调用；这里用 `loading` 缓存 Promise，
 *       保证 WASM 只下载、编译一次，不然会白白吃掉好几十毫秒呢。
 */
export async function initKernel(options = {}) {
  if (kernel) return kernel;
  if (!loading) {
    loading = (async () => {
      const wasm = await Module(options);
      // setup() 会把 embind 的类和全局函数挂到返回值上，没调用的话 Manifold 是 undefined。
      wasm.setup();
      kernel = wasm;
      return wasm;
    })();
  }
  return loading;
}

/**
 * @brief 取已经初始化好的内核，没初始化就直接抛错。
 * @retval {any} kernel 实例。
 * @note 故意抛错而不是自动 await：调用方全是同步代码，静默返回 null 只会把问题
 *       推迟到更难查的地方。启动流程里必须先 await initKernel()。
 */
export function K() {
  if (!kernel) {
    throw new Error('几何内核尚未初始化，请先 await initKernel()');
  }
  return kernel;
}

/* ========================================================================== *
 *  基础图元
 * ========================================================================== */

/**
 * @brief 生成一个立在打印床上的长方体（默认底面贴 z=0，XY 居中）。
 * @param {object} [opts]
 * @param {number} [opts.width=20]  X 方向尺寸（mm）。
 * @param {number} [opts.depth=20]  Y 方向尺寸（mm）。
 * @param {number} [opts.height=20] Z 方向尺寸（mm）。
 * @param {boolean} [opts.center=false] 为 true 时几何中心落在原点（不再贴床）。
 * @retval {any} manifold 实体。
 */
export function makeBox({ width = 20, depth = 20, height = 20, center = false } = {}) {
  const size = [Math.max(0.01, width), Math.max(0.01, depth), Math.max(0.01, height)];
  const box = K().Manifold.cube(size, true);
  // cube(size, true) 是几何中心在原点；打印件习惯底面贴床，所以整体抬高半个高度。
  return center ? box : box.translate([0, 0, size[2] / 2]);
}

/**
 * @brief 生成圆柱（可带上下不同半径，所以也能当圆台用）。
 * @param {object} [opts]
 * @param {number} [opts.radius=10] 底面半径（mm）。
 * @param {number} [opts.radiusTop] 顶面半径（mm），缺省与底面相同。
 * @param {number} [opts.height=20] 高度（mm）。
 * @param {number} [opts.segments=64] 圆周分段数，越大越圆润。
 * @param {boolean} [opts.center=false] 是否以几何中心为原点。
 * @retval {any} manifold 实体。
 */
export function makeCylinder({
  radius = 10,
  radiusTop = radius,
  height = 20,
  segments = 64,
  center = false,
} = {}) {
  const m = K().Manifold.cylinder(
    Math.max(0.01, height),
    Math.max(0.001, radius),
    Math.max(0, radiusTop),
    Math.max(3, Math.round(segments)),
    center,
  );
  return center ? m : m;
}

/**
 * @brief 生成圆锥，本质是顶半径为 0 的圆台。
 * @param {object} [opts]
 * @param {number} [opts.radius=10] 底面半径。
 * @param {number} [opts.height=20] 高度。
 * @param {number} [opts.segments=64] 圆周分段数。
 * @param {boolean} [opts.center=false] 是否居中。
 * @retval {any} manifold 实体。
 */
export function makeCone({ radius = 10, height = 20, segments = 64, center = false } = {}) {
  return makeCylinder({ radius, radiusTop: 0, height, segments, center });
}

/**
 * @brief 生成球体（十面体细分出来的测地球，面片均匀）。
 * @param {object} [opts]
 * @param {number} [opts.radius=10] 半径。
 * @param {number} [opts.segments=48] 圆周分段数（会被向上取整到 4 的倍数）。
 * @param {boolean} [opts.center=false] 为 false 时球底贴 z=0。
 * @retval {any} manifold 实体。
 */
export function makeSphere({ radius = 10, segments = 48, center = false } = {}) {
  const ball = K().Manifold.sphere(Math.max(0.01, radius), Math.max(4, Math.round(segments)));
  // sphere 默认球心在原点，贴床就把球心抬高一个半径。
  return center ? ball : ball.translate([0, 0, radius]);
}

/**
 * @brief 生成圆环（甜甜圈），轴线沿 Z，默认贴在打印床上。
 * @param {object} [opts]
 * @param {number} [opts.radius=20] 圆环中心到管心的半径（大半径）。
 * @param {number} [opts.tube=6] 管半径（小半径）。
 * @param {number} [opts.segments=64] 绕大圆的圆周分段数。
 * @param {number} [opts.tubeSegments=32] 管截面的圆周分段数。
 * @param {boolean} [opts.center=false] 是否以几何中心为原点。
 * @retval {any} manifold 实体。
 *
 * @note 做法是偷懒又稳的「旋转体」：在 XZ 平面画一个圆心在 (R,0) 的圆，
 *       绕 Z 轴转一圈就成了圆环。manifold 的 revolve 恰好就是绕 Y 轴转，
 *       所以截面坐标里 x 当半径、y 当高度，转出来的轴向就是 Z 啦。
 */
export function makeTorus({
  radius = 20,
  tube = 6,
  segments = 64,
  tubeSegments = 32,
  center = false,
} = {}) {
  const cs = K().CrossSection.circle(Math.max(0.01, tube), Math.max(6, tubeSegments)).translate(
    Math.max(tube + 0.01, radius),
    0,
  );
  const torus = K().Manifold.revolve(cs, Math.max(6, segments));
  return center ? torus : torus.translate([0, 0, tube]);
}

/**
 * @brief 生成圆管（空心圆柱），3D 打印里做套管、轴套特别顺手。
 * @param {object} [opts]
 * @param {number} [opts.outerRadius=10] 外半径。
 * @param {number} [opts.innerRadius=6] 内半径，必须小于外半径。
 * @param {number} [opts.height=20] 高度。
 * @param {number} [opts.segments=64] 分段数。
 * @param {boolean} [opts.center=false] 是否居中。
 * @retval {any} manifold 实体。
 */
export function makeTube({
  outerRadius = 10,
  innerRadius = 6,
  height = 20,
  segments = 64,
  center = false,
} = {}) {
  const outer = Math.max(0.01, outerRadius);
  const inner = Math.min(Math.max(0, innerRadius), outer - 0.01);
  const cs = K()
    .CrossSection.circle(outer, Math.max(6, Math.round(segments)))
    .subtract(K().CrossSection.circle(inner, Math.max(6, Math.round(segments))));
  const tube = K().Manifold.extrude(cs, Math.max(0.01, height));
  return center ? tube.translate([0, 0, -height / 2]) : tube;
}

/**
 * @brief 生成正棱柱（正多边形拉伸），六角柱、八角柱都靠它。
 * @param {object} [opts]
 * @param {number} [opts.sides=6] 边数，至少 3。
 * @param {number} [opts.radius=10] 外接圆半径。
 * @param {number} [opts.height=20] 高度。
 * @param {boolean} [opts.center=false] 是否居中。
 * @retval {any} manifold 实体。
 */
export function makePrism({ sides = 6, radius = 10, height = 20, center = false } = {}) {
  const n = Math.max(3, Math.round(sides));
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    // 从 -90° 开始画，让正多边形有一条水平底边，摆在打印床上更稳。
    const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  const m = K().Manifold.extrude(new K().CrossSection([pts]), Math.max(0.01, height));
  return center ? m.translate([0, 0, -height / 2]) : m;
}

/* ========================================================================== *
 *  草图 → 实体
 * ========================================================================== */

/**
 * @brief 把草图平面的局部坐标（u,v）变换到世界坐标的 4x4 矩阵。
 *
 * @param {{origin:number[], xAxis:number[], yAxis:number[], normal:number[]}} plane
 *        草图平面：原点 + 两个正交切向轴 + 法线。
 * @retval {number[]} 列主序的 16 元矩阵，可直接喂给 manifold.transform（和 THREE 一致）。
 *
 * @note 列主序的意思是：前 4 个数是第一列（xAxis 的方向），接下去是 yAxis、法线、
 *       最后是平移。manifold 和 three.js 都吃这一套，千万别写成行主序哦。
 */
export function planeMatrix(plane) {
  const [ox, oy, oz] = plane.origin;
  const [xx, xy, xz] = plane.xAxis;
  const [yx, yy, yz] = plane.yAxis;
  const [nx, ny, nz] = plane.normal;
  return [xx, xy, xz, 0, yx, yy, yz, 0, nx, ny, nz, 0, ox, oy, oz, 1];
}

/**
 * @brief 用一组闭合轮廓拉伸出一个实体，并摆到指定草图平面上。
 *
 * @param {object} opts
 * @param {number[][][]} opts.contours 轮廓数组，每个轮廓是 [[u,v], ...] 的闭合点列。
 * @param {{origin:number[], xAxis:number[], yAxis:number[], normal:number[]}} opts.plane 草图平面。
 * @param {number} opts.height 拉伸高度；负值表示沿法线反方向拉伸（挖槽时会用到）。
 * @param {number} [opts.twistDegrees=0] 扭转角，做螺旋造型时好玩。
 * @param {number} [opts.scaleTop=1] 顶面缩放，小于 1 会收成锥形。
 * @param {number} [opts.divisions=0] 中间插入的分段数（配合扭转才有意义）。
 * @param {number} [opts.overshoot=0] 起止两端额外多伸出的长度（mm），贴合实体表面时用。
 * @retval {any} 已变换到世界坐标的 manifold 实体。
 *
 * @note 正负高度的处理：先一律按 |h| 拉伸（manifold 只接受正高度），
 *       负值时整体沿局部 -Z 平移 |h|，这样实体就落在 [h, 0] 之间，
 *       最后再乘平面矩阵。顺序不能反，不然会沿着世界 Z 平移而不是草图法线～
 *
 * @note overshoot 是给“画在实体表面上”的推拉准备的：草图平面原点来自射线求交，
 *       会带 1e-14 级的浮点误差。切削体如果刚好比表面低一丁点，布尔会在孔底
 *       留下一层零厚度的面，悬垂统计还会误报。两端各多伸 0.2 mm 就能干净地
 *       穿透表面；合并时也能避免共面融合产生的烂面。
 */
export function extrudeContours({
  contours,
  plane,
  height,
  twistDegrees = 0,
  scaleTop = 1,
  divisions = 0,
  overshoot = 0,
}) {
  if (!Array.isArray(contours) || contours.length === 0) {
    throw new Error('草图轮廓是空的，先画一个闭合图形吧');
  }
  const h = Math.abs(Number(height) || 0);
  if (h < 0.01) {
    throw new Error('拉伸高度太小了，至少 0.01 mm 哦');
  }
  // 填充规则用 EvenOdd：草图里「外圈套内圈」时，内圈会自动变成洞，
  // 不用管用户画的时候是顺时针还是逆时针。默认的 Positive 会把两个
  // 同向闭环并成实心，挖孔就白画了。
  const cs = new (K().CrossSection)(contours, 'EvenOdd');
  if (cs.isEmpty()) {
    throw new Error('这个轮廓围不出面积，检查一下是不是有交叉或没闭合');
  }
  // 坑点：manifold 的 JS 绑定在 scaleTop 传「标量」时会把它当成只给了 x 分量的
  // 半成品 Vec2（y 变成 0），顶面会塌成一条线、体积凭空少一半。文档虽说支持
  // number | Vec2，实际只有数组可靠，所以这里统一归一化成 [sx, sy]。
  const topScale = typeof scaleTop === 'number' ? [scaleTop, scaleTop] : scaleTop;
  const extra = Math.max(0, Number(overshoot) || 0);
  let solid = K().Manifold.extrude(cs, h + extra, Math.max(0, divisions), twistDegrees, topScale, false);
  if (height < 0) {
    // [0, h+extra] 平移 h 后变成 [h, extra]，顶端多穿出表面 extra。
    solid = solid.translate([0, 0, height]);
  } else if (extra > 0) {
    // 正向拉伸则往表面以下多埋 extra，合并时不会和表面共面。
    solid = solid.translate([0, 0, -extra]);
  }
  return solid.transform(planeMatrix(plane));
}

/**
 * @brief 用轮廓旋转出实体（绕世界 Z 轴，轮廓的 u 是半径、v 是高度）。
 *
 * @param {object} opts
 * @param {number[][][]} opts.contours 轮廓，坐标必须都满足 u >= 0。
 * @param {number} [opts.segments=64] 圆周分段数。
 * @param {number} [opts.degrees=360] 旋转角度，小于 360 会得到切开的一段。
 * @retval {any} manifold 实体。
 *
 * @note 约定轮廓画在「前视平面」（x 向右、z 向上）。manifold.revolve 输出时
 *       会把轮廓的 v 轴当作 Z 轴，正好和世界坐标对齐，所以不用再乘矩阵。
 */
export function revolveContours({ contours, segments = 64, degrees = 360 }) {
  if (!Array.isArray(contours) || contours.length === 0) {
    throw new Error('草图轮廓是空的，先画一个闭合图形吧');
  }
  const cs = new (K().CrossSection)(contours, 'EvenOdd');
  if (cs.isEmpty()) {
    throw new Error('这个轮廓围不出面积，检查一下是不是有交叉或没闭合');
  }
  return K().Manifold.revolve(cs, Math.max(6, Math.round(segments)), degrees);
}

/* ========================================================================== *
 *  布尔与变换
 * ========================================================================== */

/**
 * @brief 两个实体的布尔运算。
 * @param {any} a 实体 A。
 * @param {any} b 实体 B。
 * @param {'union'|'subtract'|'intersect'} op 运算类型。
 * @retval {any} 运算结果（新的 manifold）。
 *
 * @note 差集是 a - b，方向别弄反；交集成空时会返回空实体，调用方要检查 isEmpty()。
 */
export function booleanOp(a, b, op) {
  const { Manifold } = K();
  switch (op) {
    case 'union':
      return Manifold.union(a, b);
    case 'subtract':
      return Manifold.difference(a, b);
    case 'intersect':
      return Manifold.intersection(a, b);
    default:
      throw new Error(`未知的布尔运算: ${op}`);
  }
}

/**
 * @brief 用一个 4x4 矩阵变换实体。
 * @param {any} manifold 输入实体。
 * @param {number[]} matrix 列主序 16 元矩阵。
 * @retval {any} 变换后的新实体。
 * @note manifold 对含镜像（行列式为负）的矩阵会拒绝或产生反向法线，
 *       所以界面上的缩放只允许正数，镜像另走“复制+翻转”的路线。
 */
export function transformManifold(manifold, matrix) {
  return manifold.transform(matrix);
}

/* ========================================================================== *
 *  网格导出 / 导入
 * ========================================================================== */

/**
 * @brief 把 manifold 摊平成「顶点数组 + 三角形索引」，方便喂给 three.js 或 STL 导出。
 *
 * @param {any} manifold 实体。
 * @retval {{positions:Float32Array, indices:Uint32Array, vertexCount:number, triangleCount:number}}
 *         顶点坐标按 xyz 连续排列，索引是每三个一组。
 *
 * @note manifold 的 Mesh 可能带额外属性通道（numProp > 3），这里只取前三个分量；
 *       渲染和 STL 都只需要位置，法线交给 three 的折痕法线算法重新算。
 */
export function manifoldMeshData(manifold) {
  const mesh = manifold.getMesh();
  const stride = mesh.numProp;
  const raw = mesh.vertProperties;
  const vertexCount = raw.length / stride;
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i += 1) {
    positions[i * 3] = raw[i * stride];
    positions[i * 3 + 1] = raw[i * stride + 1];
    positions[i * 3 + 2] = raw[i * stride + 2];
  }
  const indices = new Uint32Array(mesh.triVerts);
  return {
    positions,
    indices,
    vertexCount,
    triangleCount: indices.length / 3,
  };
}

/**
 * @brief 从「顶点 + 索引」重建 manifold 实体（撤销快照、工程文件、STL 导入都用它）。
 *
 * @param {Float32Array|number[]} positions 顶点坐标。
 * @param {Uint32Array|number[]} indices 三角形索引。
 * @retval {any} manifold 实体。
 * @throws 当网格不封闭 / 法线朝内 / 有重复顶点时抛错，调用方需要兜底提示。
 *
 * @note 这里没有自动焊接顶点：manifold 的 getMesh() 输出本身是拓扑正确的，
 *       原样回灌就能 100% 还原。外部 STL 导入要先经过 weldVertices() 焊接，
 *       否则同一个位置的一堆重复顶点会被判定成非流形。
 */
export function manifoldFromMeshData(positions, indices) {
  const { Mesh, Manifold } = K();
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: positions instanceof Float32Array ? positions : new Float32Array(positions),
    triVerts: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
  });
  return Manifold.ofMesh(mesh);
}

/**
 * @brief 按位置把重复顶点焊在一起（STL 导入必备步骤）。
 *
 * @param {Float32Array|number[]} positions 原始顶点。
 * @param {Uint32Array|number[]} indices 原始索引。
 * @param {number} [precision=4] 坐标保留的小数位，1e-4 mm 的精度对 3D 打印足够。
 * @retval {{positions:Float32Array, indices:Uint32Array, mergedVertices:number}}
 *         焊接后的网格；mergedVertices 是被合并掉的顶点数。
 *
 * @note 用 Map 以「量化后的坐标字符串」做键，O(n) 搞定。量化是为了容忍
 *       STL 浮点误差——同一个角落在两个三角面里可能差 1e-7，直接比较会漏焊。
 */
export function weldVertices(positions, indices, precision = 4) {
  const scale = 10 ** precision;
  const map = new Map();
  const outPositions = [];
  const remap = new Uint32Array(positions.length / 3);
  let merged = 0;

  for (let i = 0; i < positions.length / 3; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const key = `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`;
    const hit = map.get(key);
    if (hit === undefined) {
      const next = outPositions.length / 3;
      map.set(key, next);
      outPositions.push(x, y, z);
      remap[i] = next;
    } else {
      remap[i] = hit;
      merged += 1;
    }
  }

  const outIndices = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) {
    outIndices[i] = remap[indices[i]];
  }
  return {
    positions: new Float32Array(outPositions),
    indices: outIndices,
    mergedVertices: merged,
  };
}

/* ========================================================================== *
 *  度量信息
 * ========================================================================== */

/**
 * @brief 读取实体的体积、表面积、包围盒、三角面数等打印关心的数据。
 *
 * @param {any} manifold 实体。
 * @retval {{volume:number, area:number, triangles:number, bbox:{min:number[], max:number[]},
 *           size:number[], status:number, empty:boolean}}
 *         体积单位 mm³，面积单位 mm²，尺寸单位 mm。
 */
export function measureManifold(manifold) {
  const bbox = manifold.boundingBox();
  const size = [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]];
  return {
    volume: manifold.volume(),
    area: manifold.surfaceArea(),
    triangles: manifold.numTri(),
    bbox,
    size,
    status: manifold.status(),
    empty: manifold.isEmpty(),
  };
}
