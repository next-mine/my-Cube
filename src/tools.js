/**
 * @file 交互工具
 * @brief 把鼠标和键盘翻译成建模动作：选择、画草图、推拉、旋转、测量。
 *
 * @note 这里刻意把「点一下」和「拖一下」分开：只有按下和抬起之间位移小于 5px
 *       才算点击，否则视为旋转视图。不然想转个视角就会在草图上狂丢点，很崩溃。
 */

import * as THREE from 'three';
import {
  GROUND_PLANE,
  FRONT_PLANE,
  planeFromNormal,
  snapTo,
  buildRect,
  buildCircle,
  buildPolygon,
  buildArc,
  buildPolyline,
  planeToWorld,
  isValidContour,
} from './sketch.js';
import { extrudeContours, manifoldMeshData } from './kernel.js';

/** @brief 点击判定阈值（像素）。 */
const CLICK_SLOP = 5;

/**
 * @brief 工具控制器。
 */
export class ToolController {
  /**
   * @param {import('./app.js').App} app 应用实例。
   */
  constructor(app) {
    this.app = app;
    this.viewport = app.viewport;
    this.mode = 'idle'; // idle | drawing | extrude | measure
    this.draw = null;
    this.extrude = null;
    this.measure = null;
    this._down = null;
    this._lastScreen = { x: 0, y: 0 };

    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'preview';
    this.viewport.scene.add(this.previewGroup);
    /** @type {THREE.Mesh|null} 拉伸预览的幽灵体 */
    this._ghost = null;
    /** @type {THREE.Line|null} 测量线 */
    this._measureLine = null;
  }

  /* ================================================================== *
   *  事件绑定
   * ================================================================== */

  /** @brief 绑定画布上的指针事件。 */
  bind() {
    const canvas = this.viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    canvas.addEventListener('pointerleave', () => {
      this.viewport.setHovered(null);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** @brief 记录按下位置，用于区分点击和拖动。 */
  _onPointerDown(e) {
    if (e.button !== 0) return;
    this._down = { x: e.clientX, y: e.clientY, time: performance.now() };
  }

  /** @brief 抬起时判断是否算一次点击。 */
  _onPointerUp(e) {
    if (e.button !== 0 || !this._down) return;
    const dist = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
    const elapsed = performance.now() - this._down.time;
    this._down = null;
    // gizmo 正在拖动时不要抢点击，否则松手会顺手把实体取消选中。
    if (this.viewport.gizmo?.dragging) return;
    if (dist <= CLICK_SLOP && elapsed < 1200) this._onClick(e);
  }

  /** @brief 鼠标移动：刷新吸附、橡皮筋、拉伸高度和悬停。 */
  _onPointerMove(e) {
    this._lastScreen = { x: e.clientX, y: e.clientY };
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    if (this.mode === 'extrude') {
      this._updateExtrudeHeight(e);
      this._updateGhost();
      return;
    }

    if (this.mode === 'drawing') {
      this._updateDrawCursor(e);
      return;
    }

    // 空闲状态：更新 hover 与状态栏坐标
    const hit = this.viewport.pickSolid(e);
    this.viewport.setHovered(hit?.solid || null);
    if (hit) {
      this.app._handleCursor(hit.point);
    } else {
      const p = this.viewport.pickPlane(e, GROUND_PLANE);
      if (p) this.app._handleCursor(p);
    }
    this.app._emit('pointer', { x: localX, y: localY });
  }

  /* ================================================================== *
   *  点击分发
   * ================================================================== */

  /** @brief 一次真正的点击。 */
  _onClick(e) {
    const tool = this.app.tool;

    if (this.mode === 'measure') {
      this._measureClick(e);
      return;
    }

    if (this.mode === 'extrude') {
      // 点击确认当前高度；按住 Alt 则生成独立实体而不是布尔。
      this._commitExtrude(e.altKey);
      return;
    }

    if (this.mode === 'drawing') {
      this._drawClick(e);
      return;
    }

    if (tool === 'select' || tool === 'move' || tool === 'rotate' || tool === 'scale') {
      this._selectClick(e);
      return;
    }

    if (tool === 'measure') {
      this.mode = 'measure';
      this.measure = { points: [], line: null };
      this.app.setHint('点两个位置量距离，Esc 清除');
      this._measureClick(e);
      return;
    }

    if (tool === 'extrude') {
      // 推拉工具本身不产生轮廓，它只在「草图刚闭合」时进入预览。
      // 单独点它时给个明确提示，比什么都不发生友好。
      this.app.toast('先用绘制工具画一个闭合轮廓，再上下拖动推拉', 'warn');
      this.app.setHint('画轮廓 → 自动进入推拉预览；或先选一个实体继续编辑');
      return;
    }

    if (tool === 'revolve') {
      this._startDrawing(e, 'revolve');
      return;
    }

    if (['line', 'rect', 'circle', 'polygon', 'arc'].includes(tool)) {
      this._startDrawing(e, tool);
    }
  }

  /** @brief 选择实体。 */
  _selectClick(e) {
    const hit = this.viewport.pickSolid(e);
    if (!hit) {
      if (!e.shiftKey) this.app.setSelection([]);
      return;
    }
    if (e.shiftKey) {
      this.app.toggleSelection(hit.solid.id);
    } else {
      this.app.setSelection([hit.solid.id]);
    }
  }

  /* ================================================================== *
   *  草图绘制
   * ================================================================== */

  /**
   * @brief 第一次点击：决定草图平面，进入绘制模式。
   * @param {PointerEvent} e 事件。
   * @param {string} tool 工具 id。
   */
  _startDrawing(e, tool) {
    if (this.app.sketch) return;

    let plane = GROUND_PLANE;
    let hostId = null;

    if (tool === 'revolve') {
      // 旋转体统一画在前视平面上：u 当半径、v 当高度，转轴就是 Z 轴。
      plane = FRONT_PLANE;
    } else {
      const hit = this.viewport.pickSolid(e);
      if (hit) {
        plane = planeFromNormal(hit.point, hit.normal);
        hostId = hit.solid.id;
      }
    }

    this.app.beginSketch(plane, hostId, tool);
    this.mode = 'drawing';
    this.draw = {
      tool,
      plane,
      hostId,
      anchor: null,
      points: [],
      cursor: null,
      snapped: false,
      preview: null,
    };
    // 让状态条和草图提示能读到同一份点列表（引用共享，不用来回拷贝）。
    this.app.sketch.points = this.draw.points;
    this.app.setHint(
      hostId
        ? '在实体表面上画轮廓，往外交互会“长肉”，往里会挖洞'
        : '点击放置点，Esc 取消',
    );

    this._drawClick(e);
  }

  /** @brief 绘制过程中的点击。 */
  _drawClick(e) {
    if (!this.draw) return;
    const snapped = this._snapEvent(e);
    if (!snapped) return;
    const uv = [snapped.u, snapped.v];
    this.draw.cursor = uv;
    this.draw.snapped = snapped.snapped;
    this.app.sketch.cursor = uv;
    this.app.sketch.snapped = snapped.snapped;

    const tool = this.draw.tool;

    if (tool === 'line' || tool === 'revolve') {
      // 点回起点就闭合
      const first = this.draw.points[0];
      if (first && this.draw.points.length >= 3) {
        const tol = Math.max(1.5, this.app.settings.gridSize * 0.5);
        if (Math.hypot(uv[0] - first[0], uv[1] - first[1]) <= tol) {
          this._finishProfile(buildPolyline(this.draw.points));
          return;
        }
      }
      // 去掉连续重复点，避免零长度线段把三角化搞崩
      const last = this.draw.points[this.draw.points.length - 1];
      if (!last || Math.hypot(uv[0] - last[0], uv[1] - last[1]) > 1e-4) {
        this.draw.points.push(uv);
      }
      this._refreshSketchPreview();
      this.app.setHint(
        this.draw.points.length >= 3
          ? '点回起点闭合，或按 Enter 完成轮廓'
          : '继续点击放置点，点回起点闭合',
      );
      return;
    }

    if (tool === 'rect') {
      if (!this.draw.anchor) {
        this.draw.anchor = uv;
        this._refreshSketchPreview();
        this.app.setHint('点矩形的对角点');
        return;
      }
      const rect = buildRect(this.draw.anchor, uv);
      if (Math.abs(rect[2][0] - rect[0][0]) < 0.01 || Math.abs(rect[2][1] - rect[0][1]) < 0.01) {
        this.app.toast('矩形太小了，再点一次', 'warn');
        return;
      }
      this._finishProfile(rect);
      return;
    }

    if (tool === 'circle') {
      if (!this.draw.anchor) {
        this.draw.anchor = uv;
        this._refreshSketchPreview();
        this.app.setHint('拉出半径，再点一下');
        return;
      }
      const circle = buildCircle(this.draw.anchor, uv, Math.max(32, this.app.settings.segmentQuality));
      if (!isValidContour(circle)) {
        this.app.toast('圆太小了', 'warn');
        return;
      }
      this._finishProfile(circle);
      return;
    }

    if (tool === 'polygon') {
      if (!this.draw.anchor) {
        this.draw.anchor = uv;
        this._refreshSketchPreview();
        this.app.setHint('拉出外接圆，再点一下');
        return;
      }
      const poly = buildPolygon(this.draw.anchor, uv, this.app.settings.polygonSides);
      if (!isValidContour(poly)) {
        this.app.toast('多边形太小了', 'warn');
        return;
      }
      this._finishProfile(poly);
      return;
    }

    if (tool === 'arc') {
      this.draw.points.push(uv);
      if (this.draw.points.length < 3) {
        this._refreshSketchPreview();
        this.app.setHint(this.draw.points.length === 1 ? '再点弧上的一个点' : '再点弧的终点');
        return;
      }
      const [p1, p2, p3] = this.draw.points;
      const arc = buildArc(p1, p2, p3, Math.max(16, Math.round(this.app.settings.segmentQuality * 0.75)));
      this._finishProfile(arc);
    }
  }

  /**
   * @brief 把某个点换算到草图平面，并按设置吸附。
   * @param {PointerEvent} e 事件。
   * @retval {{u:number, v:number, snapped:boolean, kind:string}|null}
   */
  _snapEvent(e) {
    const plane = this.draw?.plane || this.app.sketch?.plane;
    if (!plane) return null;
    const world = this.viewport.pickPlane(e, plane);
    if (!world) return null;

    const vertices = [...(this.draw?.points || [])];
    if (this.draw?.anchor) vertices.push(this.draw.anchor);
    if (this.draw?.tool === 'line' && this.draw.points.length >= 2) vertices.push(this.draw.points[0]);

    const snapped = snapTo({
      plane,
      world,
      vertices,
      gridSize: this.app.settings.gridSize,
      snap: this.app.settings.snap,
    });
    return snapped;
  }

  /** @brief 鼠标移动时刷新草图预览。 */
  _updateDrawCursor(e) {
    if (!this.draw) return;
    const snapped = this._snapEvent(e);
    if (!snapped) return;
    this.draw.cursor = [snapped.u, snapped.v];
    this.draw.snapped = snapped.snapped;
    this.app.sketch.cursor = this.draw.cursor;
    this.app.sketch.snapped = snapped.snapped;
    this._refreshSketchPreview();

    // 状态栏显示当前平面坐标
    const world = this.viewport.pickPlane(e, this.draw.plane);
    if (world) this.app._handleCursor(world);
  }

  /** @brief 根据当前锚点和光标，生成形状预览。 */
  _refreshSketchPreview() {
    if (!this.draw) return;
    const { tool, points, anchor, cursor } = this.draw;
    let preview = null;

    if (cursor) {
      if (tool === 'rect' && anchor) preview = buildRect(anchor, cursor);
      else if (tool === 'circle' && anchor) preview = buildCircle(anchor, cursor, Math.max(32, this.app.settings.segmentQuality));
      else if (tool === 'polygon' && anchor) preview = buildPolygon(anchor, cursor, this.app.settings.polygonSides);
      else if (tool === 'arc' && points.length === 2) preview = buildArc(points[0], points[1], cursor, 40);
    }

    this.draw.preview = preview;
    this.app.sketchRenderer.update({
      points: tool === 'arc' ? [] : points,
      cursor,
      preview,
      closed: false,
      snapped: this.draw.snapped,
    });
  }

  /**
   * @brief 轮廓闭合：旋转体直接转，其余进入推拉预览。
   * @param {number[][]} contour 闭合轮廓（平面坐标）。
   */
  _finishProfile(contour) {
    const points = buildPolyline(contour);
    if (!isValidContour(points)) {
      this.app.toast('轮廓没闭合好，再画一次试试', 'warn');
      this.app.endSketch();
      this.mode = 'idle';
      this.draw = null;
      return;
    }

    this.app.sketchRenderer.update({ points, cursor: null, preview: null, closed: true, snapped: false });
    if (this.app.sketch) {
      this.app.sketch.points = points;
      this.app.sketch.closed = true;
    }

    if (this.draw.tool === 'revolve') {
      this.app.commitRevolve({ contours: [points], segments: 64, name: '旋转体' });
      this.app.endSketch();
      this.mode = 'idle';
      this.draw = null;
      this.app.setTool('select');
      return;
    }

    this._beginExtrude(points, this.draw.plane, this.draw.hostId);
  }

  /* ================================================================== *
   *  推拉
   * ================================================================== */

  /**
   * @brief 进入推拉预览模式。
   * @param {number[][]} contour 闭合轮廓。
   * @param {object} plane 草图平面。
   * @param {string|null} hostId 宿主实体。
   */
  _beginExtrude(contour, plane, hostId) {
    this.mode = 'extrude';
    this.extrude = { contour, plane, hostId, height: 0, start: { ...this._lastScreen } };
    this.app.preview = this.extrude;
    this.app.setHint('上下移动鼠标设置高度，点击确认；输入数字可精确指定');

    // 预览的起点取轮廓的重心，算屏幕方向时更稳。
    const centroid = contour.reduce(
      (acc, [u, v]) => [acc[0] + u / contour.length, acc[1] + v / contour.length],
      [0, 0],
    );
    this.extrude.centroid = planeToWorld(plane, centroid[0], centroid[1], 0);
    this._updateGhost();
  }

  /** @brief 用屏幕位移换算拉伸高度。 */
  _updateExtrudeHeight(e) {
    if (!this.extrude) return;
    const { plane, centroid } = this.extrude;
    const normal = new THREE.Vector3(...plane.normal);
    const p0 = this.viewport.toScreen(centroid);
    const p1 = this.viewport.toScreen(centroid.clone().addScaledVector(normal, 10));
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len2 = dx * dx + dy * dy;
    const mouse = { x: e.clientX, y: e.clientY };

    if (len2 > 25) {
      // 法线在屏幕上有一段可见的投影：投影位移直接换算成毫米。
      this.extrude.height = ((mouse.x - this.extrude.start.x) * dx + (mouse.y - this.extrude.start.y) * dy) / len2 * 10;
    } else {
      // 正对着法线看（比如俯视地面）：法线在屏幕上缩成了一个点，只能借
      // 相机的深度比例尺，把「竖直方向的鼠标位移」翻译成沿法线的距离。
      const camera = this.viewport.camera;
      const canvasH = this.viewport.renderer.domElement.clientHeight || 1;
      let worldPerPixel;
      if (camera.isPerspectiveCamera) {
        const dist = camera.position.distanceTo(centroid);
        worldPerPixel = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / canvasH;
      } else {
        worldPerPixel = (camera.top - camera.bottom) / camera.zoom / canvasH;
      }
      // 屏幕 y 向下为正，所以往上拖（y 变小）应该是正高度，这里取负号。
      this.extrude.height = -(mouse.y - this.extrude.start.y) * worldPerPixel;
    }

    // 取整到 0.1 mm，手抖不会让高度出现 12.384729 这种数字。
    this.extrude.height = Math.round(this.extrude.height * 10) / 10;
    this.app.preview = this.extrude;
    this.app.setHint(`高度 ${this.extrude.height.toFixed(1)} mm · 点击确认 · 输入数字精确指定`);
    this.app.notify();
  }

  /** @brief 重建拉伸的幽灵体预览。 */
  _updateGhost() {
    if (!this.extrude) return;
    const { contour, plane, height } = this.extrude;
    if (Math.abs(height) < 0.05) {
      this._clearGhost();
      return;
    }

    let data;
    try {
      const m = extrudeContours({ contours: [contour], plane, height });
      data = manifoldMeshData(m);
    } catch {
      this._clearGhost();
      return;
    }

    const color = height < 0 ? 0xff7b72 : 0x6fe3a8;
    if (!this._ghost) {
      this._ghost = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
          side: THREE.DoubleSide,
          emissive: color,
          emissiveIntensity: 0.25,
        }),
      );
      this._ghost.renderOrder = 3;
      this.previewGroup.add(this._ghost);
    }
    this._ghost.material.color.setHex(color);
    this._ghost.material.emissive.setHex(color);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    this._ghost.geometry.dispose();
    this._ghost.geometry = geo;
    this._ghost.visible = true;
  }

  /** @brief 清掉幽灵体。 */
  _clearGhost() {
    if (!this._ghost) return;
    this._ghost.geometry.dispose();
    this.previewGroup.remove(this._ghost);
    this._ghost.material.dispose();
    this._ghost = null;
  }

  /**
   * @brief 确认拉伸。
   * @param {boolean} [asNew=false] 强制生成独立实体（Alt 键）。
   */
  _commitExtrude(asNew = false) {
    if (!this.extrude) return;
    const { contour, plane, hostId } = this.extrude;
    const height = this.extrude.height;
    if (Math.abs(height) < 0.05) {
      this.app.setHint('高度还是 0，先上下移动鼠标再点一下');
      return;
    }
    this.app.commitExtrusion({
      contours: [contour],
      height,
      plane,
      hostId,
      asNew,
      name: asNew || !hostId ? '拉伸体' : height < 0 ? '切除' : '合并',
    });
    this._endExtrude();
  }

  /** @brief 结束拉伸模式并清理。 */
  _endExtrude() {
    this.mode = 'idle';
    this.extrude = null;
    this.app.preview = null;
    this._clearGhost();
    this.app.endSketch();
    this.app.setTool('select');
  }

  /* ================================================================== *
   *  测量
   * ================================================================== */

  /** @brief 测量工具点击取点。 */
  _measureClick(e) {
    if (!this.measure) this.measure = { points: [] };
    const hit = this.viewport.pickSolid(e);
    const point = hit ? hit.point : this.viewport.pickPlane(e, GROUND_PLANE);
    if (!point) return;
    this.measure.points.push(point.clone());
    if (this.measure.points.length > 2) this.measure.points = [point.clone()];

    if (this.measure.points.length === 2) {
      const [a, b] = this.measure.points;
      const dist = a.distanceTo(b);
      this._drawMeasureLine(a, b);
      this.app.setStatus(`测量距离：${dist.toFixed(2)} mm`);
      this.app.setHint('继续点两个点可重新测量，Esc 清除');
    } else {
      this.app.setHint('再点第二个位置');
      this._clearMeasureLine();
    }
  }

  /** @brief 画测量线。 */
  _drawMeasureLine(a, b) {
    this._clearMeasureLine();
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineDashedMaterial({ color: 0xffd166, dashSize: 3, gapSize: 2 });
    this._measureLine = new THREE.Line(geo, mat);
    this._measureLine.computeLineDistances();
    this.previewGroup.add(this._measureLine);
  }

  /** @brief 清除测量线。 */
  _clearMeasureLine() {
    if (!this._measureLine) return;
    this.previewGroup.remove(this._measureLine);
    this._measureLine.geometry.dispose();
    this._measureLine.material.dispose();
    this._measureLine = null;
  }

  /* ================================================================== *
   *  键盘与取消
   * ================================================================== */

  /**
   * @brief 工具级键盘处理。
   * @param {KeyboardEvent} e 事件。
   * @retval {boolean} 是否已消费该按键。
   */
  handleKeyDown(e) {
    const key = e.key;

    if (key === 'Escape') {
      if (this.app.dimension) {
        const dim = this.app.dimension;
        this.app.hideDimension();
        dim.onCancel?.();
        return true;
      }
      if (this.mode !== 'idle') {
        this.cancel();
        return true;
      }
      if (this.app.selection.size > 0) {
        this.app.setSelection([]);
        return true;
      }
      return false;
    }

    if (key === 'Enter') {
      if (this.app.dimension) return false; // 交给输入框自己处理
      if (this.mode === 'extrude') {
        this._commitExtrude(e.altKey);
        return true;
      }
      if (this.mode === 'drawing' && (this.draw?.tool === 'line' || this.draw?.tool === 'revolve')) {
        if (this.draw.points.length >= 3) {
          this._finishProfile(buildPolyline(this.draw.points));
          return true;
        }
        this.app.toast('至少要三个点才能围出面积哦', 'warn');
        return true;
      }
      if (this.mode === 'measure') {
        this.measure = null;
        this._clearMeasureLine();
        this.app.setHint('点两个位置量距离');
        return true;
      }
      return false;
    }

    // 数字键：打开精确尺寸输入
    if (/^[0-9.]$/.test(key) && !e.ctrlKey && !e.metaKey) {
      if (this.app.dimension) return false;
      if (this.mode === 'extrude' && this.extrude) {
        e.preventDefault();
        const current = this.extrude.height || 10;
        this.app.showDimension({
          label: '高度',
          value: current,
          initial: key,
          anchor: this._screenAnchor(),
          onCommit: (value) => {
            this.extrude.height = value;
            this._commitExtrude(false);
          },
        });
        return true;
      }
      if (this.mode === 'drawing' && this.draw?.tool === 'line' && this.draw.points.length >= 1) {
        e.preventDefault();
        this.app.showDimension({
          label: '长度',
          value: 10,
          initial: key,
          anchor: this._screenAnchor(),
          onCommit: (value) => this._commitLineLength(value),
        });
        return true;
      }
    }

    return false;
  }

  /** @brief 按输入长度延长当前橡皮筋。 */
  _commitLineLength(length) {
    if (!this.draw || !this.draw.cursor || !this.draw.points.length) return;
    const last = this.draw.points[this.draw.points.length - 1];
    const [u, v] = this.draw.cursor;
    const dx = u - last[0];
    const dy = v - last[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const next = [last[0] + (dx / len) * length, last[1] + (dy / len) * length];
    this.draw.points.push(next);
    this.draw.cursor = next;
    this._refreshSketchPreview();
  }

  /** @brief 尺寸输入框的屏幕锚点。 */
  _screenAnchor() {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    return {
      x: this._lastScreen.x - rect.left + 16,
      y: this._lastScreen.y - rect.top + 14,
    };
  }

  /**
   * @brief 取消当前操作（Esc / 切换工具时调用）。
   * @param {object} [opts]
   * @param {boolean} [opts.silent] 不弹提示。
   * @retval {void}
   */
  cancel({ silent = false } = {}) {
    const had = this.mode !== 'idle';
    if (this.mode === 'extrude') {
      this._clearGhost();
      this.app.preview = null;
      this.app.endSketch();
    } else if (this.mode === 'drawing') {
      this.app.endSketch();
    } else if (this.mode === 'measure') {
      this.measure = null;
      this._clearMeasureLine();
    }
    this.mode = 'idle';
    this.draw = null;
    this.extrude = null;
    if (had && !silent) {
      this.app.setHint('已取消');
      this.app.setStatus('就绪');
    }
  }

  /**
   * @brief 界面上的「完成」按钮：等同按 Enter。
   * @retval {void}
   */
  finish() {
    if (this.mode === 'extrude') {
      this._commitExtrude(false);
      return;
    }
    if (this.mode === 'drawing' && (this.draw?.tool === 'line' || this.draw?.tool === 'revolve')) {
      if (this.draw.points.length >= 3) {
        this._finishProfile(buildPolyline(this.draw.points));
      } else {
        this.app.toast('至少要三个点才能围出面积哦', 'warn');
      }
      return;
    }
    if (this.mode === 'measure') {
      this.measure = null;
      this._clearMeasureLine();
      this.app.setHint('点两个位置量距离');
    }
  }

  /** @brief 当前是否处于绘制/拉伸状态（界面用来禁用手势提示）。 */
  isBusy() {
    return this.mode !== 'idle';
  }
}
