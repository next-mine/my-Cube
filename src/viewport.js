/**
 * @file 三维视口
 * @brief 负责 three.js 的舞台：渲染器、两套相机（透视/正交）、轨道控制、
 *        灯光、打印床、网格、拾取射线，以及变换 gizmo。
 *
 * @note 世界坐标系是 Z 轴朝上的（3D 打印机的习惯），和 three.js 默认的 Y-up
 *       不一样。相机、网格、地面都要按 Z-up 摆，别照着 three 的示例抄哦。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** @brief 打印床默认尺寸（mm），和常见的 Ender-3 / A1 一个量级。 */
export const BED_SIZE = 220;

/** @brief 相机默认视角距离。 */
const DEFAULT_DISTANCE = 420;

/**
 * @brief 把鼠标事件换算成 [-1, 1] 的归一化设备坐标。
 * @param {PointerEvent|MouseEvent} event 浏览器事件。
 * @param {HTMLElement} el 画布容器。
 * @retval {THREE.Vector2} NDC 坐标（y 已翻转）。
 */
function ndcFromEvent(event, el) {
  const rect = el.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

/**
 * @brief 三维视口类。
 */
export class Viewport {
  /**
   * @param {HTMLElement} stage 承载 canvas 的容器。
   * @param {object} [callbacks]
   * @param {(solid:Solid|null, point:THREE.Vector3|null)=>void} [callbacks.onHover] 鼠标悬停变化。
   * @param {()=>void} [callbacks.onGizmoChange] gizmo 拖动中。
   * @param {()=>void} [callbacks.onGizmoEnd] gizmo 拖动结束（松手）。
   * @param {(ev:PointerEvent)=>void} [callbacks.onPointerMove] 原始指针移动。
   */
  constructor(stage, callbacks = {}) {
    this.stage = stage;
    this.callbacks = callbacks;

    /** @type {THREE.WebGLRenderer} */
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // 截图/导出图片时能直接 toDataURL
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.setClearColor(0x000000, 0);
    this.stage.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // 目标点：轨道环绕的中心，也是视图预设围绕的点。
    this.target = new THREE.Vector3(0, 0, 30);
    this.activeProjection = 'persp';

    this._setupCameras();
    this._setupEnvironment();
    this._setupLights();
    this._setupHelpers();

    /** @type {THREE.Group} 所有实体都挂在这里 */
    this.solidsGroup = new THREE.Group();
    this.solidsGroup.name = 'solids';
    this.scene.add(this.solidsGroup);

    /** @type {THREE.Group} 草图工具把临时线条画在这里 */
    this.sketchGroup = new THREE.Group();
    this.sketchGroup.name = 'sketch';
    this.scene.add(this.sketchGroup);

    this._setupControls();
    this._setupGizmo();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this._clock = new THREE.Clock();
    this._running = true;
    this._hovered = null;
    this._frame = 0;
    this.xray = false;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(stage);
    this.resize();

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  /* ================================================================== *
   *  初始化
   * ================================================================== */

  /** @brief 建立透视/正交两套相机，共享同一个观察目标。 */
  _setupCameras() {
    const aspect = this.stage.clientWidth / Math.max(1, this.stage.clientHeight);

    this.perspCamera = new THREE.PerspectiveCamera(42, aspect, 0.5, 20000);
    this.perspCamera.up.set(0, 0, 1);
    this.perspCamera.position.set(-DEFAULT_DISTANCE * 0.72, -DEFAULT_DISTANCE * 0.86, DEFAULT_DISTANCE * 0.72);
    this.perspCamera.lookAt(this.target);

    const h = DEFAULT_DISTANCE * 0.9;
    this.orthoCamera = new THREE.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, -5000, 20000);
    this.orthoCamera.up.set(0, 0, 1);
    this.orthoCamera.position.copy(this.perspCamera.position);
    this.orthoCamera.lookAt(this.target);

    this.camera = this.perspCamera;
  }

  /** @brief 环境贴图 + 雾，给金属/塑料一点反射层次。 */
  _setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.environmentMap;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();

    // 远处淡淡一层雾，让无限大的网格有个自然的收尾。
    this.scene.fog = new THREE.Fog(0x151a20, 900, 2200);
  }

  /** @brief 主光 + 补光 + 半球环境光；主光负责投影。 */
  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xdfefff, 0x2b313a, 0.85);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4e6, 1.75);
    key.position.set(160, -220, 320);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 1400;
    key.shadow.camera.left = -320;
    key.shadow.camera.right = 320;
    key.shadow.camera.top = 320;
    key.shadow.camera.bottom = -320;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.5;
    this.scene.add(key);
    this.keyLight = key;

    const fill = new THREE.DirectionalLight(0x9dc8ff, 0.85);
    fill.position.set(-240, 180, 120);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffc98a, 0.5);
    rim.position.set(60, 260, 40);
    this.scene.add(rim);
  }

  /** @brief 打印床、网格、阴影接收面、坐标轴。 */
  _setupHelpers() {
    // 阴影接收面：完全透明，只接阴影，不然会挡住下面的网格。
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.34 }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.z = 0.02;
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);

    // 细网格 10 mm
    this.gridFine = new THREE.GridHelper(800, 80, 0x3b4654, 0x2a323d);
    this.gridFine.rotation.x = Math.PI / 2;
    this.gridFine.position.z = 0;
    this.gridFine.material.transparent = true;
    this.gridFine.material.opacity = 0.55;
    this.gridFine.material.depthWrite = false;
    this.scene.add(this.gridFine);

    // 粗网格 50 mm，稍微亮一点，方便估尺寸
    this.gridMajor = new THREE.GridHelper(800, 16, 0x55637a, 0x3a4658);
    this.gridMajor.rotation.x = Math.PI / 2;
    this.gridMajor.position.z = 0.01;
    this.gridMajor.material.transparent = true;
    this.gridMajor.material.opacity = 0.7;
    this.gridMajor.material.depthWrite = false;
    this.scene.add(this.gridMajor);

    // 打印床边界
    const half = BED_SIZE / 2;
    const bedPts = [
      new THREE.Vector3(-half, -half, 0.03),
      new THREE.Vector3(half, -half, 0.03),
      new THREE.Vector3(half, half, 0.03),
      new THREE.Vector3(-half, half, 0.03),
    ];
    const bedGeo = new THREE.BufferGeometry().setFromPoints([...bedPts, bedPts[0]]);
    this.bedLine = new THREE.Line(
      bedGeo,
      new THREE.LineBasicMaterial({ color: 0x63748a, transparent: true, opacity: 0.85 }),
    );
    this.scene.add(this.bedLine);

    // 床面淡淡一层底色，提示“这是能打印的范围”
    const bedFill = new THREE.Mesh(
      new THREE.PlaneGeometry(BED_SIZE, BED_SIZE),
      new THREE.MeshBasicMaterial({ color: 0x39424f, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    bedFill.rotation.x = -Math.PI / 2;
    bedFill.position.z = 0.005;
    this.scene.add(bedFill);

    // 原点三色小坐标轴（短一点，不喧宾夺主）
    const axes = new THREE.Group();
    const axisData = [
      { dir: [1, 0, 0], color: 0xff6b6b },
      { dir: [0, 1, 0], color: 0x46d191 },
      { dir: [0, 0, 1], color: 0x4cc2ff },
    ];
    for (const { dir, color } of axisData) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(dir[0] * 36, dir[1] * 36, dir[2] * 36),
      ]);
      axes.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })));
    }
    this.scene.add(axes);
  }

  /** @brief 按当前激活的相机重建轨道控制（两套相机各自一份，省得切换时状态错乱）。 */
  _setupControls() {
    if (this.controls) this.controls.dispose();
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.85;
    controls.panSpeed = 0.9;
    controls.zoomSpeed = 1.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 5;
    controls.maxDistance = 4000;
    controls.target.copy(this.target);

    // CAD 习惯：左键转，中键/右键平移，滚轮缩放。
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls = controls;
  }

  /** @brief 变换 gizmo（移动/旋转/缩放三合一，按 tool 切模式）。 */
  _setupGizmo() {
    const gizmo = new TransformControls(this.camera, this.renderer.domElement);
    gizmo.setSize(0.85);
    gizmo.enabled = false;
    gizmo.visible = false;
    this.scene.add(gizmo.getHelper());

    gizmo.addEventListener('dragging-changed', (e) => {
      // gizmo 拖动时先把轨道控制关掉，不然两个会抢鼠标，画面会“螺旋升天”。
      this.controls.enabled = !e.value;
      if (e.value) {
        this.callbacks.onGizmoStart?.();
      } else {
        // 松手后把锚点重新对到新的包围盒中心，下一次拖动才不会从旧位置起跳。
        const solid = this._gizmoBase?.solid;
        this._gizmoBase = null;
        if (solid && this.gizmoTarget) this.showGizmo(solid, this.gizmo.getMode());
        this.callbacks.onGizmoEnd?.();
      }
    });
    gizmo.addEventListener('objectChange', () => this._applyGizmoTransform());

    this.gizmo = gizmo;
    /** @type {THREE.Object3D|null} */
    this.gizmoTarget = null;
  }

  /* ================================================================== *
   *  相机与视图
   * ================================================================== */

  /**
   * @brief 切换透视/正交投影，保持当前视角和取景中心。
   * @param {'persp'|'ortho'} mode 投影方式。
   * @retval {void}
   */
  setProjection(mode) {
    if (mode === this.activeProjection) return;
    const distance = this.camera.position.distanceTo(this.target);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.target).normalize();

    if (mode === 'ortho') {
      const aspect = this.stage.clientWidth / Math.max(1, this.stage.clientHeight);
      const h = Math.max(40, distance * 0.82);
      this.orthoCamera.left = (-h * aspect) / 2;
      this.orthoCamera.right = (h * aspect) / 2;
      this.orthoCamera.top = h / 2;
      this.orthoCamera.bottom = -h / 2;
      this.orthoCamera.zoom = 1;
      this.orthoCamera.position.copy(this.camera.position);
      this.orthoCamera.up.set(0, 0, 1);
      this.camera = this.orthoCamera;
    } else {
      this.perspCamera.position.copy(this.camera.position);
      this.perspCamera.up.set(0, 0, 1);
      this.camera = this.perspCamera;
    }
    this.camera.position.copy(this.target).addScaledVector(dir, distance);
    this.camera.lookAt(this.target);
    this.activeProjection = mode;
    this._setupControls();
    this.gizmo.camera = this.camera;
    this.controls.target.copy(this.target);
    this.controls.update();
  }

  /**
   * @brief 切换视图预设。
   * @param {'iso'|'top'|'front'|'right'|'left'|'back'} preset 预设名。
   * @param {boolean} [keepDistance=true] 是否保持当前距离。
   * @retval {void}
   */
  setViewPreset(preset, keepDistance = true) {
    const distance = keepDistance
      ? Math.max(this.camera.position.distanceTo(this.target), 80)
      : DEFAULT_DISTANCE;
    const dirs = {
      iso: new THREE.Vector3(1, -1.15, 0.85).normalize(),
      top: new THREE.Vector3(0, -0.0001, 1).normalize(),
      front: new THREE.Vector3(0, -1, 0.0001).normalize(),
      right: new THREE.Vector3(1, 0, 0.0001).normalize(),
      left: new THREE.Vector3(-1, 0, 0.0001).normalize(),
      back: new THREE.Vector3(0, 1, 0.0001).normalize(),
    };
    const dir = dirs[preset] || dirs.iso;
    this.camera.position.copy(this.target).addScaledVector(dir, distance);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
    this.controls.target.copy(this.target);
    this.controls.update();
    if (this.activeProjection === 'persp') this.camera.updateProjectionMatrix();
  }

  /**
   * @brief 让相机框住全部实体（或指定实体）。
   * @param {Array<{stats:Function, group:THREE.Object3D}>} [solids] 要框住的对象；缺省用场景里的。
   * @retval {void}
   */
  fit(solids) {
    const list = (solids && solids.length ? solids : this.solidsGroup.children)
      .map((s) => (s.stats ? s : null))
      .filter(Boolean);

    const box = new THREE.Box3();
    if (list.length === 0) {
      // 空场景就框打印床
      box.set(new THREE.Vector3(-BED_SIZE / 2, -BED_SIZE / 2, 0), new THREE.Vector3(BED_SIZE / 2, BED_SIZE / 2, BED_SIZE / 2));
    } else {
      for (const solid of list) {
        const bb = solid.stats()?.bbox;
        if (!bb) continue;
        box.expandByPoint(new THREE.Vector3(bb.min[0], bb.min[1], bb.min[2]));
        box.expandByPoint(new THREE.Vector3(bb.max[0], bb.max[1], bb.max[2]));
      }
      if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(BED_SIZE, BED_SIZE, 80));
    }

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = Math.max(60, sphere.radius / Math.sin(THREE.MathUtils.degToRad(21)));
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.target).normalize();
    if (dir.lengthSq() < 0.1) dir.set(1, -1.15, 0.85).normalize();

    this.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance);
    this.controls.target.copy(this.target);
    this.controls.update();

    if (this.activeProjection === 'ortho') {
      const aspect = this.stage.clientWidth / Math.max(1, this.stage.clientHeight);
      const h = Math.max(40, sphere.radius * 2.5);
      this.orthoCamera.left = (-h * aspect) / 2;
      this.orthoCamera.right = (h * aspect) / 2;
      this.orthoCamera.top = h / 2;
      this.orthoCamera.bottom = -h / 2;
      this.orthoCamera.updateProjectionMatrix();
    }
  }

  /** @brief 每帧的平滑过渡：目前只用来让轨道 target 跟随，保留接口。 */
  _tick() {
    if (!this.controls.enabled) return;
    this.controls.update();
    this.target.copy(this.controls.target);
  }

  /* ================================================================== *
   *  拾取
   * ================================================================== */

  /**
   * @brief 把屏幕事件转成 NDC。
   * @param {PointerEvent|MouseEvent} event 事件。
   * @retval {THREE.Vector2}
   */
  toNDC(event) {
    return ndcFromEvent(event, this.renderer.domElement);
  }

  /**
   * @brief 对实体做射线拾取。
   * @param {PointerEvent|MouseEvent} event 事件。
   * @retval {{solid:object, point:THREE.Vector3, normal:THREE.Vector3, distance:number}|null}
   *         最近命中的实体；没打中返回 null。
   */
  pickSolid(event) {
    this.pointer.copy(this.toNDC(event));
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.solidsGroup.children, true);
    for (const hit of hits) {
      if (!hit.face) continue;
      let node = hit.object;
      while (node && !node.userData.solidId) node = node.parent;
      if (!node) continue;
      const solid = this.app?.getSolid(node.userData.solidId);
      if (!solid) continue;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      return { solid, point: hit.point.clone(), normal, distance: hit.distance };
    }
    return null;
  }

  /**
   * @brief 求鼠标射线与某个无限平面的交点。
   * @param {PointerEvent|MouseEvent} event 事件。
   * @param {{origin:number[], normal:number[]}} plane 平面。
   * @retval {THREE.Vector3|null} 交点；射线与平面平行时返回 null。
   */
  pickPlane(event, plane) {
    this.pointer.copy(this.toNDC(event));
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const p = new THREE.Plane(
      new THREE.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]).normalize(),
      -new THREE.Vector3(plane.origin[0], plane.origin[1], plane.origin[2]).dot(
        new THREE.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]).normalize(),
      ),
    );
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(p, out) ? out : null;
  }

  /**
   * @brief 世界坐标 → 屏幕像素坐标（相对视口左上角）。
   * @param {THREE.Vector3|number[]} point 世界坐标。
   * @retval {{x:number, y:number, visible:boolean}}
   */
  toScreen(point) {
    const v = Array.isArray(point) ? new THREE.Vector3(point[0], point[1], point[2]) : point.clone();
    v.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: ((v.x + 1) / 2) * rect.width,
      y: ((1 - v.y) / 2) * rect.height,
      visible: v.z > -1 && v.z < 1,
    };
  }

  /* ================================================================== *
   *  场景内容
   * ================================================================== */

  /** @brief 加一个实体到场景。 */
  addSolid(solid) {
    this.solidsGroup.add(solid.group);
    if (this.xray) this._applyXrayTo(solid.group, true);
  }

  /** @brief 从场景移除一个实体。 */
  removeSolid(solid) {
    this.solidsGroup.remove(solid.group);
  }

  /**
   * @brief 把某个实体设成半透明（X 光模式）。
   * @param {THREE.Object3D} group 实体分组。
   * @param {boolean} on 是否半透明。
   * @retval {void}
   */
  _applyXrayTo(group, on) {
    group.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        m.transparent = on;
        m.opacity = on ? 0.28 : 1;
        m.depthWrite = !on;
        m.needsUpdate = true;
      }
    });
  }

  /**
   * @brief 开关 X 光模式：所有实体半透明，方便看清内部的孔和切除结果。
   * @param {boolean} on 是否开启。
   * @retval {void}
   */
  setXray(on) {
    this.xray = !!on;
    for (const group of this.solidsGroup.children) {
      this._applyXrayTo(group, this.xray);
    }
  }

  /**
   * @brief 更新所有实体的选中外观。
   * @param {Iterable<object>} solids 选中的实体集合。
   * @retval {void}
   */
  applySelection(solids) {
    const set = new Set(solids);
    for (const group of this.solidsGroup.children) {
      const solid = this.app?.getSolid(group.userData.solidId);
      if (solid) solid.setSelected(set.has(solid));
    }
  }

  /**
   * @brief 悬停高亮。
   * @param {object|null} solid 当前悬停实体。
   * @retval {void}
   */
  setHovered(solid) {
    if (this._hovered === solid) return;
    this._hovered?.setHovered(false);
    this._hovered = solid;
    solid?.setHovered(true);
    this.renderer.domElement.style.cursor = solid ? 'pointer' : 'default';
  }

  /* ================================================================== *
   *  Gizmo
   * ================================================================== */

  /**
   * @brief 显示变换 gizmo。
   * @param {object} solid 目标实体。
   * @param {'translate'|'rotate'|'scale'} mode 变换模式。
   * @retval {void}
   *
   * @note gizmo 不直接挂在实体上，而是挂在一个「锚点」上，锚点放在包围盒中心。
   *       拖动时把锚点的变化量（delta）左乘到实体矩阵上，这样旋转/缩放就是
   *       绕几何中心发生的，而不是绕建模原点。多选时以后也能直接复用这套。
   */
  showGizmo(solid, mode) {
    if (!this.gizmoAnchor) {
      this.gizmoAnchor = new THREE.Object3D();
      this.gizmoAnchor.name = 'gizmo-anchor';
      this.scene.add(this.gizmoAnchor);
    }

    const center = solid.worldCenter();
    this.gizmoAnchor.position.copy(center);
    this.gizmoAnchor.quaternion.identity();
    this.gizmoAnchor.scale.set(1, 1, 1);
    this.gizmoAnchor.updateMatrixWorld(true);

    solid.group.updateMatrixWorld(true);
    this._gizmoBase = {
      anchorMatrix: this.gizmoAnchor.matrixWorld.clone(),
      solidMatrix: solid.group.matrixWorld.clone(),
      solid,
    };

    this.gizmo.attach(this.gizmoAnchor);
    this.gizmo.setMode(mode);
    this.gizmo.enabled = true;
    this.gizmo.visible = true;
    this.gizmo.getHelper().visible = true;
    this.gizmoTarget = solid;
  }

  /**
   * @brief 把 gizmo 锚点的变化应用到实体上。
   * @retval {void}
   * @note delta = 当前锚点矩阵 × 初始锚点矩阵的逆；实体新矩阵 = delta × 初始实体矩阵。
   *       矩阵乘法顺序不能反，否则物体会先绕世界原点转一圈再回来，轨迹会很怪。
   */
  _applyGizmoTransform() {
    const base = this._gizmoBase;
    if (!base) return;
    this.gizmoAnchor.updateMatrixWorld(true);

    const delta = new THREE.Matrix4().multiplyMatrices(
      this.gizmoAnchor.matrixWorld,
      base.anchorMatrix.clone().invert(),
    );
    const next = new THREE.Matrix4().multiplyMatrices(delta, base.solidMatrix);
    next.decompose(base.solid.group.position, base.solid.group.quaternion, base.solid.group.scale);
    base.solid.group.updateMatrix();
    base.solid.readTransformFromObject();

    this.callbacks.onGizmoChange?.(base.solid);
  }

  /** @brief 隐藏 gizmo。 */
  hideGizmo() {
    this.gizmo.detach();
    this.gizmo.enabled = false;
    this.gizmo.visible = false;
    this.gizmo.getHelper().visible = false;
    this.gizmoTarget = null;
    this._gizmoBase = null;
  }

  /* ================================================================== *
   *  开关与循环
   * ================================================================== */

  /** @brief 显示/隐藏网格。 */
  setGridVisible(on) {
    this.gridFine.visible = on;
    this.gridMajor.visible = on;
    this.bedLine.visible = on;
  }

  /** @brief 显示/隐藏阴影。 */
  setShadowVisible(on) {
    this.renderer.shadowMap.enabled = on;
    this.keyLight.castShadow = on;
    // 阴影贴图开关要强制重编译材质，不然会留下上一帧的脏影子。
    this.scene.traverse((obj) => {
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.needsUpdate = true;
      }
    });
  }

  /** @brief 自适应容器尺寸。 */
  resize() {
    const w = Math.max(1, this.stage.clientWidth);
    const h = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    const oh = this.orthoCamera.top - this.orthoCamera.bottom;
    this.orthoCamera.left = (-oh * aspect) / 2;
    this.orthoCamera.right = (oh * aspect) / 2;
    this.orthoCamera.updateProjectionMatrix();
  }

  /** @brief 渲染循环。 */
  _animate() {
    if (!this._running) return;
    requestAnimationFrame(this._animate);
    this._frame += 1;
    if (this._frame % 1 === 0) {
      this._tick();
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** @brief 截一张图（调试/导出预览用）。 */
  snapshotDataURL() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** @brief 销毁视口，释放监听与 GPU 资源。 */
  dispose() {
    this._running = false;
    window.removeEventListener('resize', this._onResize);
    this._resizeObserver.disconnect();
    this.controls?.dispose();
    this.gizmo?.dispose();
    this.renderer.dispose();
    this.environmentMap?.dispose();
  }
}
