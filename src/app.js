/**
 * @file 应用核心
 * @brief 管状态、管实体、管撤销栈、管文件读写，把「界面」「工具」「几何内核」
 *        三块粘在一起。界面只读状态、发动作，不直接碰 WASM；工具只改草图/预览，
 *        真正落盘的操作都走这里的 commit 方法，撤销栈才不会漏记。
 */

import * as THREE from 'three';
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
} from './kernel.js';
import { Solid, DEFAULT_COLOR } from './solid.js';
import { Viewport } from './viewport.js';
import {
  SketchRenderer,
  GROUND_PLANE,
  planeToWorld,
  isValidContour,
} from './sketch.js';
import { initUI } from './ui.js';
import { ToolController } from './tools.js';
import {
  buildBinarySTL,
  buildAsciiSTL,
  buildOBJ,
  parseSTL,
  weldSTL,
  download,
} from './stl.js';
import { analyzePrint, mergeReports, bestBedRotation, dropManifold, centerManifold } from './print.js';

/** @brief 允许的操作类型，防止手滑写错字符串。 */
const BOOLEAN_OPS = new Set(['union', 'subtract', 'intersect']);

/**
 * @brief 应用主类。
 */
export class App {
  constructor() {
    /** @type {Solid[]} 按创建顺序保存的实体 */
    this.solids = [];
    /** @type {Map<string, Solid>} id → 实体，拾取时用 */
    this.byId = new Map();
    /** @type {Set<string>} 当前选中的实体 id */
    this.selection = new Set();

    /** @type {string} 当前工具 id */
    this.tool = 'select';
    /** @type {object|null} 当前草图会话（由 ToolController 维护） */
    this.sketch = null;
    /** @type {object|null} 拉伸预览状态 */
    this.preview = null;
    /** @type {object|null} 尺寸输入浮窗状态 */
    this.dimension = null;

    /** @type {object} 视口与网格等设置 */
    this.settings = {
      gridVisible: true,
      gridSize: 5,
      snap: true,
      shadows: true,
      projection: 'persp',
      material: 'PLA',
      polygonSides: 6,
      segmentQuality: 64,
      /** @type {boolean} X 光透视：实体半透明，方便检查内部孔洞 */
      xray: false,
    };

    this.docName = '未命名模型';
    this.dirty = false;

    /** @type {Array<{label:string, state:object}>} */
    this.undoStack = [];
    /** @type {Array<{label:string, state:object}>} */
    this.redoStack = [];
    this._pendingTransformUndo = null;

    this._listeners = new Map();
    this._notifyScheduled = false;
    this._hovered = null;
    this._wasmBinary = null;
    /** @type {boolean} gizmo 拖动中：界面此时不做整块重绘，免得输入框和滚动位置乱跳 */
    this.gizmoDragging = false;
  }

  /* ================================================================== *
   *  启动
   * ================================================================== */

  /**
   * @brief 初始化内核、视口、界面和工具。
   * @param {object} [opts]
   * @param {ArrayBuffer|Uint8Array} [opts.wasmBinary] 单文件版内嵌的 WASM 字节码。
   * @retval {Promise<void>}
   */
  async init(opts = {}) {
    this._wasmBinary = opts.wasmBinary || null;
    this._setStatus('正在加载几何内核…', 'busy');
    await initKernel(this._wasmBinary ? { wasmBinary: this._wasmBinary } : {});
    this._setStatus('就绪');

    const stage = document.getElementById('viewport-stage');
    this.viewport = new Viewport(stage, {
      onHover: (solid) => {
        this._hovered = solid;
        this.viewport.setHovered(solid);
        this._emit('hover', solid);
      },
      onGizmoStart: () => {
        // 拖动开始前先存一份状态，松手时再决定要不要真的记进撤销栈。
        this.gizmoDragging = true;
        this._pendingTransformUndo = { label: '变换实体', state: this._capture() };
      },
      onGizmoChange: (solid) => {
        if (!solid) return;
        // 视口已经把矩阵分解回实体了，这里只负责通知界面刷新数值。
        this._emit('transform', solid);
        this.notify();
      },
      onGizmoEnd: () => {
        this.gizmoDragging = false;
        if (!this._pendingTransformUndo) return;
        this.undoStack.push(this._pendingTransformUndo);
        if (this.undoStack.length > 60) this.undoStack.shift();
        this.redoStack = [];
        this._pendingTransformUndo = null;
        this._markDirty();
        this._emit('history');
        this.notify();
      },
      onPointerMove: (world) => this._handleCursor(world),
    });
    this.viewport.app = this;

    this.sketchRenderer = new SketchRenderer(this.viewport.sketchGroup, this.viewport);

    initUI(this);
    this.tools = new ToolController(this);
    this.tools.bind();
    this._bindKeys();

    this._emit('ready');
    this.notify();
  }

  /* ================================================================== *
   *  事件
   * ================================================================== */

  /**
   * @brief 订阅事件。
   * @param {string} name 事件名。
   * @param {Function} fn 回调。
   * @retval {()=>void} 取消订阅函数。
   */
  on(name, fn) {
    if (!this._listeners.has(name)) this._listeners.set(name, new Set());
    this._listeners.get(name).add(fn);
    return () => this._listeners.get(name)?.delete(fn);
  }

  /** @brief 触发事件（内部用）。 */
  _emit(name, payload) {
    this._listeners.get(name)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[cubo] 事件 ${name} 处理出错`, err);
      }
    });
  }

  /**
   * @brief 合并同一帧内的多次状态变化，只通知界面刷新一次。
   * @retval {void}
   * @note 拖动鼠标时每帧都可能改状态，如果每次都重绘属性面板，界面会“发抖”。
   */
  notify() {
    if (this._notifyScheduled) return;
    this._notifyScheduled = true;
    requestAnimationFrame(() => {
      this._notifyScheduled = false;
      this._emit('change');
    });
  }

  /* ================================================================== *
   *  状态栏
   * ================================================================== */

  /** @brief 设置状态栏左侧文字。 */
  _setStatus(message, level = 'ok') {
    this._emit('status', { message, level });
  }

  /** @brief 对外暴露的状态提示。 */
  setStatus(message, level = 'ok') {
    this._setStatus(message, level);
  }

  /** @brief 底部提示文字（右侧的操作引导）。 */
  setHint(text) {
    this._emit('hint', text);
  }

  /** @brief 弹出 toast。 */
  toast(message, type = 'ok') {
    this._emit('toast', { message, type });
  }

  /* ================================================================== *
   *  实体管理
   * ================================================================== */

  /**
   * @brief 按 id 取实体。
   * @param {string} id 实体 id。
   * @retval {Solid|undefined}
   */
  getSolid(id) {
    return this.byId.get(id);
  }

  /**
   * @brief 把已有的 Solid 对象挂进场景与索引。
   * @param {Solid} solid 实体。
   * @retval {Solid} 原样返回，方便链式调用。
   */
  _attachSolid(solid) {
    this.solids.push(solid);
    this.byId.set(solid.id, solid);
    this.viewport.addSolid(solid);
    return solid;
  }

  /**
   * @brief 新建实体并加入场景。
   *
   * @param {any} manifold manifold 几何。
   * @param {object} [opts]
   * @param {string} [opts.name] 名称。
   * @param {string} [opts.color] 颜色。
   * @param {string} [opts.kind] 类型标签。
   * @param {boolean} [opts.select=true] 是否自动选中。
   * @param {boolean} [opts.fit=false] 是否自动缩放到视图。
   * @param {boolean} [opts.history=true] 是否记入撤销栈。
   * @retval {Solid}
   */
  addSolid(manifold, opts = {}) {
    const { name = '实体', color = DEFAULT_COLOR, kind = '实体', select = true, fit = false, history = true } = opts;
    if (history) this.pushUndo(`添加${name}`);
    const solid = new Solid({ name, manifold, color, kind });
    this._attachSolid(solid);
    if (select) this.setSelection([solid.id]);
    if (fit) this.viewport.fit([solid]);
    this._markDirty();
    this._setStatus(`${name} 已创建`);
    this.notify();
    return solid;
  }

  /**
   * @brief 删除选中的实体。
   * @retval {number} 删掉的个数。
   */
  deleteSelected() {
    if (this.selection.size === 0) return 0;
    this.pushUndo('删除实体');
    const count = this.selection.size;
    for (const id of [...this.selection]) {
      const solid = this.byId.get(id);
      if (!solid) continue;
      this.viewport.removeSolid(solid);
      solid.dispose();
      this.byId.delete(id);
      this.solids = this.solids.filter((s) => s !== solid);
    }
    this.setSelection([]);
    this._markDirty();
    this._setStatus(`已删除 ${count} 个实体`);
    this.notify();
    return count;
  }

  /**
   * @brief 复制选中实体（偏移一点点，避免和原件完全重叠看不出来）。
   * @retval {Solid[]} 新实体。
   */
  duplicateSelected() {
    const picked = this.getSelectedSolids();
    if (picked.length === 0) return [];
    this.pushUndo('复制实体');
    const created = [];
    for (const src of picked) {
      const snap = src.toSnapshot();
      const copy = Solid.fromSnapshot({ ...snap, id: undefined, name: `${src.name} 副本` });
      copy.setTransform({
        position: [src.transform.position[0] + 12, src.transform.position[1] + 12, src.transform.position[2]],
      });
      this._attachSolid(copy);
      created.push(copy);
    }
    this.setSelection(created.map((s) => s.id));
    this._markDirty();
    this._setStatus(`已复制 ${created.length} 个实体`);
    this.notify();
    return created;
  }

  /** @brief 选中全部实体。 */
  selectAll() {
    this.setSelection(this.solids.map((s) => s.id));
  }

  /**
   * @brief 设置选中集合。
   * @param {string[]} ids 实体 id 列表。
   * @param {boolean} [additive=false] 是否追加到现有选择。
   * @retval {void}
   */
  setSelection(ids, additive = false) {
    if (!additive) this.selection.clear();
    for (const id of ids) {
      if (this.byId.has(id)) this.selection.add(id);
    }
    this.viewport.applySelection(this.getSelectedSolids());
    this._refreshGizmo();
    this._emit('selection');
    this.notify();
  }

  /** @brief 追加/切换单个选中项（Shift 点击时用）。 */
  toggleSelection(id) {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.viewport.applySelection(this.getSelectedSolids());
    this._refreshGizmo();
    this._emit('selection');
    this.notify();
  }

  /** @brief 取选中的实体对象数组。 */
  getSelectedSolids() {
    return [...this.selection].map((id) => this.byId.get(id)).filter(Boolean);
  }

  /**
   * @brief 改选中实体的颜色。
   * @param {string} hex 颜色。
   * @retval {void}
   */
  setSelectionColor(hex) {
    const picked = this.getSelectedSolids();
    if (picked.length === 0) return;
    this.pushUndo('修改颜色');
    picked.forEach((s) => s.setColor(hex));
    this._markDirty();
    this.notify();
  }

  /**
   * @brief 重命名实体。
   * @param {string} id 实体 id。
   * @param {string} name 新名字。
   * @retval {void}
   */
  renameSolid(id, name) {
    const solid = this.byId.get(id);
    if (!solid || !name.trim()) return;
    this.pushUndo('重命名');
    solid.name = name.trim();
    solid.group.name = solid.name;
    this._markDirty();
    this.notify();
  }

  /* ================================================================== *
   *  布尔运算
   * ================================================================== */

  /**
   * @brief 对选中的多个实体做布尔运算，结果替换原来的实体。
   *
   * @param {'union'|'subtract'|'intersect'} op 运算类型。
   * @retval {void}
   *
   * @note 差集约定「第一个选中的是被减数」，其余依次减掉。界面上的提示文案
   *       也是这么写的，避免用户困惑为什么点选顺序会影响结果。
   */
  applyBoolean(op) {
    if (!BOOLEAN_OPS.has(op)) return;
    const picked = this.getSelectedSolids();
    if (picked.length < 2) {
      this.toast('布尔运算至少需要选中两个实体哦', 'warn');
      return;
    }

    const opNames = { union: '并集', subtract: '差集', intersect: '交集' };
    this.pushUndo(opNames[op]);

    let result;
    try {
      result = picked[0].getWorldManifold();
      for (let i = 1; i < picked.length; i += 1) {
        const other = picked[i].getWorldManifold();
        if (!other) throw new Error('有实体不是有效网格');
        result = booleanOp(result, other, op);
      }
    } catch (err) {
      this.toast(`布尔运算失败：${err.message}`, 'error');
      this.undo();
      return;
    }

    if (!result || result.isEmpty()) {
      this.toast(`${opNames[op]}的结果是空的，检查一下实体是否相交`, 'warn');
      // 结果为空不保留，撤销掉这次操作（撤销栈里刚压进去的那条）。
      this.undo();
      return;
    }

    // 用结果替换掉参与运算的所有实体
    const first = picked[0];
    const mergedName = op === 'union' ? '并集结果' : op === 'subtract' ? '差集结果' : '交集结果';
    for (const solid of picked) {
      this.viewport.removeSolid(solid);
      this.byId.delete(solid.id);
      solid.dispose();
    }
    this.solids = this.solids.filter((s) => !picked.includes(s));

    const fresh = new Solid({ name: mergedName, manifold: result, color: first.color, kind: '布尔结果' });
    this._attachSolid(fresh);
    this.setSelection([fresh.id]);
    this._markDirty();
    this._setStatus(`${opNames[op]}完成：${picked.length} 个实体 → 1 个`);
    this.notify();
  }

  /* ================================================================== *
   *  图元
   * ================================================================== */

  /**
   * @brief 添加一个基础图元。
   * @param {'box'|'cylinder'|'sphere'|'cone'|'torus'|'tube'|'prism'} kind 图元类型。
   * @retval {Solid|null}
   */
  addPrimitive(kind) {
    const q = this.settings.segmentQuality;
    const makers = {
      box: () => makeBox({ width: 40, depth: 40, height: 30 }),
      cylinder: () => makeCylinder({ radius: 20, height: 40, segments: q }),
      sphere: () => makeSphere({ radius: 20, segments: q }),
      cone: () => makeCone({ radius: 20, height: 40, segments: q }),
      torus: () => makeTorus({ radius: 24, tube: 8, segments: q, tubeSegments: Math.max(16, q / 2) }),
      tube: () => makeTube({ outerRadius: 20, innerRadius: 13, height: 36, segments: q }),
      prism: () => makePrism({ sides: 6, radius: 22, height: 36 }),
    };
    const labels = {
      box: '立方体',
      cylinder: '圆柱',
      sphere: '球体',
      cone: '圆锥',
      torus: '圆环',
      tube: '圆管',
      prism: '六棱柱',
    };
    if (!makers[kind]) return null;

    // 连续添加时错开一点位置，避免两个图元完全重叠、看起来像没反应。
    const offset = this.solids.length * 6;
    const manifold = makers[kind]().translate([offset, offset, 0]);
    const solid = this.addSolid(manifold, { name: labels[kind], kind: labels[kind], fit: true });
    this._setStatus(`${labels[kind]}已放置，可在右侧改尺寸和位置`);
    return solid;
  }

  /* ================================================================== *
   *  镜像与阵列
   * ================================================================== */

  /**
   * @brief 以垂直于某根轴的平面为镜面，生成选中实体的镜像副本。
   *
   * @param {object} [opts]
   * @param {'x'|'y'|'z'} [opts.axis='x'] 镜面法线所在的轴。
   * @param {number} [opts.offset=0] 镜面在该轴上的位置（mm）。
   * @retval {Solid[]} 新生成的镜像实体。
   *
   * @note 反射会把三角形的绕序翻过来，直接回灌 manifold 会得到“内外翻转”的实体。
   *       所以这里把每个三角形的后两个顶点对调，重新把法线翻回朝外。
   */
  mirrorSelected({ axis = 'x', offset = 0 } = {}) {
    const picked = this.getSelectedSolids();
    if (picked.length === 0) {
      this.toast('先选中要镜像的实体', 'warn');
      return [];
    }
    const axisIndex = { x: 0, y: 1, z: 2 }[axis];
    if (axisIndex === undefined) return [];

    this.pushUndo('镜像副本');
    const created = [];
    for (const src of picked) {
      try {
        const world = src.getWorldManifold();
        if (!world) continue;
        const { positions, indices } = manifoldMeshData(world);
        const mirrored = new Float32Array(positions);
        // 关于坐标 = offset 的平面做反射：p' = 2·offset − p
        for (let i = axisIndex; i < mirrored.length; i += 3) {
          mirrored[i] = offset * 2 - mirrored[i];
        }
        const flipped = new Uint32Array(indices);
        for (let i = 0; i < flipped.length; i += 3) {
          const tmp = flipped[i + 1];
          flipped[i + 1] = flipped[i + 2];
          flipped[i + 2] = tmp;
        }
        const manifold = manifoldFromMeshData(mirrored, flipped);
        const copy = new Solid({
          name: `${src.name} 镜像`,
          manifold,
          color: src.color,
          kind: '镜像',
        });
        this._attachSolid(copy);
        created.push(copy);
      } catch (err) {
        console.error('[cubo] 镜像失败', err);
        this.toast('这个实体镜像失败了，已跳过', 'warn');
      }
    }
    this.setSelection(created.map((s) => s.id));
    this._markDirty();
    this._setStatus(`已生成 ${created.length} 个镜像副本`);
    this.notify();
    return created;
  }

  /**
   * @brief 线性阵列：把选中的实体沿某根轴复制若干份。
   *
   * @param {object} [opts]
   * @param {'x'|'y'|'z'} [opts.axis='x'] 阵列方向。
   * @param {number} [opts.count=3] 总数量（包含原件）。
   * @param {number} [opts.spacing=50] 间距（mm）。
   * @param {boolean} [opts.merge=false] 是否把所有副本并成一个实体。
   * @retval {void}
   *
   * @note 副本直接复制「局部网格 + 变换」，不改几何，所以很快；
   *       勾选合并时才做世界坐标布尔，适合一次打出连在一起的排梳状零件。
   */
  linearArraySelected({ axis = 'x', count = 3, spacing = 50, merge = false } = {}) {
    const picked = this.getSelectedSolids();
    if (picked.length === 0) {
      this.toast('先选中要阵列的实体', 'warn');
      return;
    }
    const axisIndex = { x: 0, y: 1, z: 2 }[axis];
    if (axisIndex === undefined) return;
    const total = Math.max(2, Math.min(50, Math.round(count)));
    const step = Number(spacing) || 0;
    if (Math.abs(step) < 0.01) {
      this.toast('阵列间距不能是 0 哦', 'warn');
      return;
    }

    this.pushUndo('线性阵列');
    const created = [];
    for (const src of picked) {
      for (let i = 1; i < total; i += 1) {
        const snap = src.toSnapshot();
        const copy = Solid.fromSnapshot({ ...snap, id: undefined, name: `${src.name} ${i + 1}` });
        const position = [...src.transform.position];
        position[axisIndex] += step * i;
        copy.setTransform({ position });
        this._attachSolid(copy);
        created.push(copy);
      }
    }

    if (merge && created.length > 0) {
      try {
        const all = [...picked, ...created];
        let result = all[0].getWorldManifold();
        for (let i = 1; i < all.length; i += 1) {
          result = booleanOp(result, all[i].getWorldManifold(), 'union');
        }
        const first = picked[0];
        for (const solid of all) {
          this.viewport.removeSolid(solid);
          this.byId.delete(solid.id);
          solid.dispose();
        }
        this.solids = this.solids.filter((s) => !all.includes(s));
        const merged = new Solid({
          name: '阵列结果',
          manifold: result,
          color: first.color,
          kind: '布尔结果',
        });
        this._attachSolid(merged);
        this.setSelection([merged.id]);
      } catch (err) {
        console.error('[cubo] 阵列合并失败', err);
        this.toast('合并失败了，副本已作为独立实体保留', 'warn');
        this.setSelection(created.map((s) => s.id));
      }
    } else {
      this.setSelection(created.map((s) => s.id));
    }

    this._markDirty();
    this._setStatus(`线性阵列：共 ${total} 个（间距 ${step} mm）`);
    this.notify();
  }

  /* ================================================================== *
   *  草图与拉伸
   * ================================================================== */

  /**
   * @brief 开始一次草图会话。
   * @param {object} plane 草图平面。
   * @param {string|null} hostId 画在哪个实体表面上（没有就是空中的独立草图）。
   * @param {string} tool 当前绘制工具。
   * @retval {void}
   */
  beginSketch(plane, hostId, tool) {
    this.sketch = {
      plane,
      hostId,
      tool,
      points: [],
      closed: false,
      cursor: null,
      snapped: false,
      preview: null,
    };
    this.sketchRenderer.setPlane(plane);
    this.sketchRenderer.update({});
    this._emit('sketch', { active: true, plane, hostId });
    this.notify();
  }

  /** @brief 结束草图会话，清掉所有预览。 */
  endSketch() {
    this.sketch = null;
    this.preview = null;
    this.sketchRenderer.clear();
    this._emit('sketch', { active: false });
    this.notify();
  }

  /**
   * @brief 把草图轮廓沿平面法线拉伸，并合并/切除到宿主实体上。
   *
   * @param {object} opts
   * @param {number[][]} opts.contours 闭合轮廓（平面坐标）。
   * @param {number} opts.height 拉伸高度，正负决定沿法线哪一侧。
   * @param {object} opts.plane 草图平面。
   * @param {string|null} [opts.hostId] 宿主实体 id。
   * @param {boolean} [opts.asNew=false] 强制新建实体，不做布尔。
   * @param {string} [opts.name] 新实体名称。
   * @retval {Solid|null}
   *
   * @note 画在实体表面上时，默认行为跟 SketchUp 一样：往外拉是“长肉”（并集），
   *       往里推是“挖洞”（差集）。只有按住 Alt 才会强制生成独立实体。
   */
  commitExtrusion({ contours, height, plane, hostId, asNew = false, name = '拉伸体' }) {
    // 注意 contours 是「轮廓的数组」，校验时要逐个轮廓看，不能把整个数组
    // 当成一个点列去数长度——之前就因为这个把合法矩形判成了空轮廓。
    const contoursOk =
      Array.isArray(contours) && contours.length > 0 && contours.every((c) => isValidContour(c));
    if (!contoursOk) {
      this.toast('轮廓没有围出面积，再画一次试试', 'warn');
      return null;
    }
    const host = hostId ? this.byId.get(hostId) : null;
    let toolManifold;
    try {
      // 贴在实体表面上时两端各多伸 0.2 mm：切削必然穿透表面，
      // 合并也不会和表面共面。独立拉伸（新实体）不加，尺寸才准确。
      toolManifold = extrudeContours({
        contours,
        plane,
        height,
        overshoot: host && !asNew ? 0.2 : 0,
      });
    } catch (err) {
      this.toast(`拉伸失败：${err.message}`, 'error');
      return null;
    }

    if (host && !asNew) {
      const op = height < 0 ? 'subtract' : 'union';
      this.pushUndo(height < 0 ? '切除实体' : '合并实体');
      try {
        // 把工具实体转换到宿主的局部坐标系里做布尔，这样宿主原有的变换
        // （位置/旋转/缩放）可以原封不动保留，不会因为一次挖孔被烘焙掉。
        const inv = new THREE.Matrix4().copy(host.group.matrix).invert();
        const local = toolManifold.transform(inv.elements);
        const result = booleanOp(host.manifold, local, op);
        if (result.isEmpty()) {
          this.toast('这次操作把实体删没了，已撤销', 'warn');
          this.undo();
          return null;
        }
        host.setManifold(result);
        this.setSelection([host.id]);
        this._markDirty();
        this._setStatus(op === 'subtract' ? '已切除' : '已合并');
        this.notify();
        return host;
      } catch (err) {
        this.toast(`布尔运算失败：${err.message}`, 'error');
        this.undo();
        return null;
      }
    }

    const solid = this.addSolid(toolManifold, { name, kind: '拉伸体', select: true });
    return solid;
  }

  /**
   * @brief 把草图轮廓绕 Z 轴旋转成实体。
   * @param {object} opts
   * @param {number[][]} opts.contours 轮廓（前视平面坐标）。
   * @param {number} [opts.segments=64] 圆周分段。
   * @param {number} [opts.degrees=360] 旋转角度。
   * @param {string} [opts.name='旋转体'] 名称。
   * @retval {Solid|null}
   */
  commitRevolve({ contours, segments = 64, degrees = 360, name = '旋转体' }) {
    const contoursOk =
      Array.isArray(contours) && contours.length > 0 && contours.every((c) => isValidContour(c));
    if (!contoursOk) {
      this.toast('轮廓没有围出面积，再画一次试试', 'warn');
      return null;
    }
    let manifold;
    try {
      manifold = revolveContours({ contours, segments, degrees });
    } catch (err) {
      this.toast(`旋转失败：${err.message}`, 'error');
      return null;
    }
    return this.addSolid(manifold, { name, kind: '旋转体', select: true });
  }

  /* ================================================================== *
   *  工具
   * ================================================================== */

  /**
   * @brief 切换当前工具。
   * @param {string} id 工具 id。
   * @retval {void}
   */
  setTool(id) {
    if (this.tool === id) return;
    this.tools?.cancel({ silent: true });
    this.tool = id;
    this._emit('tool', id);
    this._refreshGizmo();
    const tips = {
      select: '左键点选，Shift 多选，拖动空白处旋转视图',
      line: '连续点击画折线，点回起点闭合',
      rect: '点两个对角点画矩形',
      circle: '先点圆心，再点圆周',
      polygon: `先点中心，再点外接圆（当前 ${this.settings.polygonSides} 边形）`,
      arc: '依次点起点、弧上一点、终点',
      extrude: '先把轮廓画在表面上，再上下拖动推拉',
      revolve: '把截面画在前视平面上，闭合后自动旋转一周',
      move: '拖动坐标轴箭头移动实体',
      rotate: '拖动圆环绕轴旋转',
      scale: '拖动方块缩放实体',
      measure: '点两个位置量距离，Esc 清除',
    };
    this.setHint(tips[id] || '');
    this.notify();
  }

  /** @brief 按当前选择刷新变换 gizmo。 */
  _refreshGizmo() {
    if (!this.viewport) return;
    const picked = this.getSelectedSolids();
    const modeMap = { move: 'translate', rotate: 'rotate', scale: 'scale' };
    const mode = modeMap[this.tool];
    if (mode && picked.length === 1) {
      this.viewport.showGizmo(picked[0], mode);
    } else {
      this.viewport.hideGizmo();
    }
  }

  /* ================================================================== *
   *  历史
   * ================================================================== */

  /** @brief 把当前场景拍成可还原的快照。 */
  _capture() {
    return {
      docName: this.docName,
      solids: this.solids.map((s) => s.toSnapshot()),
      selection: [...this.selection],
    };
  }

  /**
   * @brief 在修改场景前压入撤销点。
   * @param {string} label 操作名，显示在提示里。
   * @retval {void}
   */
  pushUndo(label) {
    this.undoStack.push({ label, state: this._capture() });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this._emit('history');
  }

  /**
   * @brief 还原一个快照（会重建所有实体，较慢但绝对可靠）。
   * @param {object} state _capture 的产物。
   * @retval {void}
   */
  _restore(state) {
    for (const solid of this.solids) {
      this.viewport.removeSolid(solid);
      solid.dispose();
    }
    this.solids = [];
    this.byId.clear();
    this.selection.clear();

    for (const snap of state.solids) {
      try {
        const solid = Solid.fromSnapshot(snap);
        this._attachSolid(solid);
      } catch (err) {
        console.error('[cubo] 快照恢复失败', err);
      }
    }
    this.docName = state.docName || this.docName;
    const input = document.getElementById('doc-name');
    if (input) input.value = this.docName;
    this.setSelection(state.selection || []);
    this.viewport.applySelection(this.getSelectedSolids());
    this._refreshGizmo();
    this._emit('solids');
    this.notify();
  }

  /** @brief 撤销。 */
  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ label: entry.label, state: this._capture() });
    this._restore(entry.state);
    this._setStatus(`已撤销：${entry.label}`);
  }

  /** @brief 重做。 */
  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ label: entry.label, state: this._capture() });
    this._restore(entry.state);
    this._setStatus(`已重做：${entry.label}`);
  }

  /* ================================================================== *
   *  打印信息与摆盘
   * ================================================================== */

  /**
   * @brief 生成当前选择的打印体检报告（没选中就算全部）。
   * @retval {object|null}
   */
  getPrintReport() {
    const picked = this.selection.size > 0 ? this.getSelectedSolids() : this.solids;
    const reports = picked
      .map((s) => {
        try {
          const world = s.getWorldManifold();
          return world ? analyzePrint(world, this.settings.material) : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return mergeReports(reports);
  }

  /** @brief 取出要做摆盘操作的实体（优先选中，否则全部）。 */
  _targetSolids() {
    return this.selection.size > 0 ? this.getSelectedSolids() : this.solids;
  }

  /**
   * @brief 让选中实体的最低点贴到打印床上。
   * @retval {void}
   */
  dropToBed() {
    const picked = this._targetSolids();
    if (!picked.length) return;
    this.pushUndo('贴床');
    for (const solid of picked) {
      const bb = solid.stats()?.bbox;
      if (!bb) continue;
      solid.setTransform({ position: [solid.transform.position[0], solid.transform.position[1], solid.transform.position[2] - bb.min[2]] });
    }
    this._markDirty();
    this._setStatus('已贴到打印床');
    this.notify();
  }

  /**
   * @brief 在 XY 平面居中（默认居中到原点，也就是打印床中心）。
   * @retval {void}
   */
  centerOnBed() {
    const picked = this._targetSolids();
    if (!picked.length) return;
    this.pushUndo('居中');
    for (const solid of picked) {
      const bb = solid.stats()?.bbox;
      if (!bb) continue;
      const cx = (bb.min[0] + bb.max[0]) / 2;
      const cy = (bb.min[1] + bb.max[1]) / 2;
      solid.setTransform({
        position: [
          solid.transform.position[0] - cx,
          solid.transform.position[1] - cy,
          solid.transform.position[2],
        ],
      });
    }
    this._markDirty();
    this._setStatus('已居中到打印床');
    this.notify();
  }

  /**
   * @brief 智能摆正：挑最大的平面转向下，再贴床 + 居中。
   * @retval {void}
   */
  autoOrient() {
    const picked = this._targetSolids();
    if (!picked.length) return;
    this.pushUndo('智能摆正');
    for (const solid of picked) {
      try {
        const world = solid.getWorldManifold();
        if (!world) continue;
        const best = bestBedRotation(world);
        let oriented = world;
        if (best && !best.alreadyFlat) oriented = world.transform(best.matrix);
        oriented = centerManifold(dropManifold(oriented).manifold);
        solid.setTransform({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
        solid.setManifold(oriented);
      } catch (err) {
        console.error('[cubo] 摆正失败', err);
        this.toast('这个实体摆正失败了，已跳过', 'warn');
      }
    }
    this._markDirty();
    this._setStatus('已自动摆正并贴床');
    this.viewport.fit(picked);
    this.notify();
  }

  /**
   * @brief 按目标尺寸等比缩放实体（属性面板里改尺寸用）。
   * @param {'x'|'y'|'z'} axis 轴。
   * @param {number} target 目标尺寸（mm）。
   * @retval {void}
   */
  scaleSelectionTo(axis, target) {
    const picked = this.getSelectedSolids();
    if (picked.length !== 1 || !(target > 0)) return;
    const solid = picked[0];
    const st = solid.stats();
    if (!st) return;
    const index = { x: 0, y: 1, z: 2 }[axis];
    const current = st.size[index];
    if (current < 1e-6) return;
    const factor = target / current;
    const next = [...solid.transform.scale];
    next[index] = Math.max(0.001, next[index] * factor);
    this.pushUndo('修改尺寸');
    solid.setTransform({ scale: next });
    this._markDirty();
    this.notify();
  }

  /**
   * @brief 载入一个示例模型：六角笔筒。
   * @retval {void}
   *
   * @note 这个例子只用「正棱柱 + 差集」就能做出来，正好展示 Cubo 的基本功：
   *       外六角减内六角，留 7 mm 底，壁厚约 6 mm，可以直接切片打印。
   *       第一次打开软件的人点一下就能看到完整成品，比空场景更有说服力。
   */
  loadDemo() {
    this.newProject({ silent: true });
    const outer = makePrism({ sides: 6, radius: 32, height: 60 });
    const inner = makePrism({ sides: 6, radius: 26, height: 55 }).translate([0, 0, 7]);
    const cup = booleanOp(outer, inner, 'subtract');
    const solid = this.addSolid(cup, {
      name: '六角笔筒',
      kind: '示例模型',
      color: '#ff9f43',
      select: true,
    });
    this.setTool('select');
    this.viewport.fit([solid]);
    this._markSaved();
    this._setStatus('示例模型：六角笔筒（壁厚约 6 mm，底厚 7 mm）');
    this.toast('已载入示例：六角笔筒');
  }

  /* ================================================================== *
   *  文件
   * ================================================================== */

  /** @brief 标记为未保存。 */
  _markDirty() {
    this.dirty = true;
    this._emit('doc', { name: this.docName, dirty: true });
  }

  /** @brief 保存状态更新为已保存。 */
  _markSaved() {
    this.dirty = false;
    this._emit('doc', { name: this.docName, dirty: false });
  }

  /**
   * @brief 改文档名。
   * @param {string} name 名字。
   * @retval {void}
   */
  setDocName(name) {
    this.docName = name || '未命名模型';
    this._markDirty();
    this._emit('doc', { name: this.docName, dirty: true });
  }

  /**
   * @brief 导出 STL（默认导出全部可见实体）。
   * @param {object} [opts]
   * @param {boolean} [opts.selectedOnly=false] 只导出选中。
   * @param {boolean} [opts.binary=true] 二进制还是 ASCII。
   * @retval {void}
   */
  exportSTL({ selectedOnly = false, binary = true } = {}) {
    const list = selectedOnly ? this.getSelectedSolids() : this.solids;
    if (list.length === 0) {
      this.toast('场景里还没有实体，先建一个吧', 'warn');
      return;
    }
    const meshes = list.map((s) => manifoldMeshData(s.getWorldManifold()));
    const safeName = (this.docName || 'cubo').replace(/[\\/:*?"<>|]/g, '_');
    if (binary) {
      const buffer = buildBinarySTL(meshes, `Cubo ${safeName}`);
      download(new Blob([buffer], { type: 'model/stl' }), `${safeName}.stl`);
    } else {
      download(new Blob([buildAsciiSTL(meshes, safeName)], { type: 'model/stl' }), `${safeName}.stl`);
    }
    this._setStatus(`已导出 ${list.length} 个实体到 STL（${binary ? '二进制' : 'ASCII'}）`);
    this.toast(`STL 已导出：${safeName}.stl`);
  }

  /** @brief 导出 OBJ。 */
  exportOBJ() {
    if (this.solids.length === 0) {
      this.toast('场景里还没有实体', 'warn');
      return;
    }
    const meshes = this.solids.map((s) => manifoldMeshData(s.getWorldManifold()));
    const safeName = (this.docName || 'cubo').replace(/[\\/:*?"<>|]/g, '_');
    download(new Blob([buildOBJ(meshes, safeName)], { type: 'text/plain' }), `${safeName}.obj`);
    this.toast('OBJ 已导出');
  }

  /**
   * @brief 保存 .cubo 工程文件（本质是 JSON）。
   * @retval {void}
   */
  saveProject() {
    const data = {
      format: 'cubo-project',
      version: 1,
      name: this.docName,
      settings: this.settings,
      solids: this.solids.map((s) => s.toSnapshot()),
    };
    const safeName = (this.docName || 'cubo').replace(/[\\/:*?"<>|]/g, '_');
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${safeName}.cubo.json`);
    this._markSaved();
    this.toast('工程已保存');
  }

  /**
   * @brief 载入工程 JSON。
   * @param {object} data parse 后的对象。
   * @retval {boolean} 是否成功。
   */
  loadProject(data) {
    if (!data || data.format !== 'cubo-project' || !Array.isArray(data.solids)) {
      this.toast('这不是有效的 Cubo 工程文件', 'error');
      return false;
    }
    this.undoStack = [];
    this.redoStack = [];
    this._restore({
      docName: data.name || '未命名模型',
      solids: data.solids,
      selection: [],
    });
    if (data.settings) Object.assign(this.settings, data.settings);
    this._applySettings();
    this.viewport.fit(this.solids);
    this._markSaved();
    this.toast(`已打开工程：${this.docName}`);
    return true;
  }

  /**
   * @brief 新建空工程。
   * @param {object} [opts]
   * @param {boolean} [opts.silent=false] 不弹提示（载入示例等内部调用时用）。
   * @retval {void}
   */
  newProject({ silent = false } = {}) {
    this._restore({ docName: '未命名模型', solids: [], selection: [] });
    this.undoStack = [];
    this.redoStack = [];
    this._emit('history');
    this.docName = '未命名模型';
    document.getElementById('doc-name').value = this.docName;
    this._markSaved();
    this.viewport.fit([]);
    if (!silent) this.toast('新建了一个空场景');
  }

  /**
   * @brief 导入 STL。
   * @param {File} file 文件对象。
   * @retval {Promise<void>}
   */
  async importSTL(file) {
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSTL(buffer);
      const welded = weldSTL(parsed);
      const manifold = manifoldFromMeshData(welded.positions, welded.indices);
      const baseName = file.name.replace(/\.stl$/i, '');
      const solid = this.addSolid(manifold, {
        name: baseName || '导入模型',
        kind: '导入网格',
        fit: true,
      });
      const st = solid.stats();
      this._setStatus(`已导入 ${file.name}：${st.triangles} 个三角面，${st.size.map((n) => n.toFixed(1)).join(' × ')} mm`);
      this.toast(`已导入：${file.name}`);
    } catch (err) {
      console.error(err);
      this.toast(`导入失败：${err.message}。STL 可能不是封闭实体，无法参与建模。`, 'error');
    }
  }

  /* ================================================================== *
   *  设置
   * ================================================================== */

  /**
   * @brief 修改设置并同步到视口。
   * @param {object} patch 要改的字段。
   * @retval {void}
   */
  updateSettings(patch) {
    Object.assign(this.settings, patch);
    this._applySettings();
    this.notify();
  }

  /** @brief 把设置项映射到视口。 */
  _applySettings() {
    const s = this.settings;
    this.viewport.setGridVisible(s.gridVisible);
    this.viewport.setShadowVisible(s.shadows);
    this.viewport.setXray(s.xray);
    if (this.viewport.activeProjection !== s.projection) {
      this.viewport.setProjection(s.projection);
    }
    this._emit('settings', s);
  }

  /* ================================================================== *
   *  尺寸输入浮窗
   * ================================================================== */

  /**
   * @brief 在指定屏幕位置弹出数值输入框。
   * @param {object} opts
   * @param {string} opts.label 标签（如「高度」）。
   * @param {number} opts.value 初始值。
   * @param {{x:number,y:number}} opts.anchor 屏幕坐标（相对视口）。
   * @param {(value:number)=>void} opts.onCommit 确认回调。
   * @param {()=>void} [opts.onCancel] 取消回调。
   * @retval {void}
   */
  showDimension({ label, value, initial, anchor, onCommit, onCancel }) {
    // initial 是用户按下的第一个数字，必须一起存下来，不然那个数字会丢，
    // 输入框里只剩后面敲的位（按 2、5 会变成 5 而不是 25）。
    this.dimension = { label, value, initial, anchor, onCommit, onCancel };
    this._emit('dimension', this.dimension);
  }

  /** @brief 关闭尺寸输入浮窗。 */
  hideDimension() {
    if (!this.dimension) return;
    this.dimension = null;
    this._emit('dimension', null);
  }

  /* ================================================================== *
   *  键盘
   * ================================================================== */

  /** @brief 全局快捷键（文本框聚焦时自动让路）。 */
  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      // Ctrl+S 要全局吃掉：就算焦点在输入框里，也不该弹出浏览器的“保存网页”。
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveProject();
        return;
      }

      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          e.shiftKey ? this.redo() : this.undo();
          return;
        }
        if (k === 'y') {
          e.preventDefault();
          this.redo();
          return;
        }
        if (k === 'd') {
          e.preventDefault();
          this.duplicateSelected();
          return;
        }
        if (k === 'a') {
          e.preventDefault();
          this.selectAll();
          return;
        }
        if (k === 's') {
          e.preventDefault();
          this.saveProject();
          return;
        }
        if (k === 'o') {
          e.preventDefault();
          document.getElementById('file-input')?.click();
          return;
        }
        if (k === 'n') {
          e.preventDefault();
          // 交给界面层弹确认框，App 自己不直接清空场景。
          this._emit('request-new');
          return;
        }
        return;
      }

      // 先给工具处理（Esc / Enter / 数字输入）
      if (this.tools?.handleKeyDown(e)) return;

      const key = e.key.toLowerCase();
      const map = {
        q: 'select',
        l: 'line',
        r: 'rect',
        c: 'circle',
        g: 'polygon',
        a: 'arc',
        p: 'extrude',
        o: 'revolve',
        1: 'move',
        2: 'rotate',
        3: 'scale',
        m: 'measure',
      };
      if (map[key]) {
        e.preventDefault();
        this.setTool(map[key]);
        return;
      }
      if (key === 'f') {
        e.preventDefault();
        this.viewport.fit(this.solids);
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        this.deleteSelected();
      }
    });
  }

  /** @brief 视口坐标显示（由 ToolController 调用）。 */
  _handleCursor(world) {
    if (!world) return;
    this._emit('cursor', world);
  }

  /* ================================================================== *
   *  杂项
   * ================================================================== */

  /** @brief 视口尺寸变化后，把 gizmo 和相机重新对齐。 */
  onResize() {
    this.viewport?.resize();
  }

  /** @brief 当前鼠标在世界坐标的位置（给工具用）。 */
  eventToWorld(event) {
    return this.viewport.pickPlane(event, GROUND_PLANE);
  }

  /** @brief 把平面坐标点转世界坐标，方便工具画预览。 */
  planePoint(plane, u, v, w = 0) {
    return planeToWorld(plane, u, v, w);
  }
}
