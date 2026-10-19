/**
 * @file 实体对象模型
 * @brief 一个 Solid = 一份 manifold 实体（几何真相）+ 一个 three.js 显示对象（外观）。
 *        变换（平移/旋转/缩放）只作用在显示对象上，导出和统计时再烘焙进网格，
 *        这样拖动 gizmo 是实时的，不用每次都重算 WASM 布尔，手感才不会卡。
 */

import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { manifoldMeshData, manifoldFromMeshData, measureManifold } from './kernel.js';

/** @brief 默认的模型颜色，偏冷的浅灰，灯光下层次感比较清楚。 */
export const DEFAULT_COLOR = '#c7d0dc';

/** @brief 可选的模型颜色（属性面板里的小色块）。 */
export const COLOR_SWATCHES = [
  '#c7d0dc',
  '#ff9f43',
  '#4cc2ff',
  '#46d191',
  '#ff6b6b',
  '#b48cff',
  '#ffd166',
  '#7b8794',
];

let seq = 0;

/**
 * @brief 生成一个短小的唯一 id。
 * @retval {string} 形如 `s-3f9a` 的字符串。
 * @note 不用 crypto.randomUUID，是为了让快照/工程文件里的 id 短一点、好读一点；
 *       同一个会话内不重复就够用了。
 */
function nextId() {
  seq += 1;
  return `s-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * @brief 一个可渲染、可导出、可布尔的实体。
 */
export class Solid {
  /**
   * @param {object} opts
   * @param {string} [opts.id] 唯一 id，缺省自动生成。
   * @param {string} [opts.name] 显示名称。
   * @param {any} opts.manifold manifold 实体（必需）。
   * @param {string} [opts.color=DEFAULT_COLOR] 十六进制颜色。
   * @param {{position:number[], rotation:number[], scale:number[]}} [opts.transform] 变换，旋转用角度。
   * @param {string} [opts.kind='实体'] 类型标签，显示在属性面板。
   * @param {boolean} [opts.editableManifold=true] 是否是可编辑实体（导入的坏网格为 false）。
   */
  constructor({ id, name, manifold, color = DEFAULT_COLOR, transform, kind = '实体', editableManifold = true }) {
    this.id = id || nextId();
    this.name = name || '实体';
    this.manifold = manifold;
    this.color = color;
    this.kind = kind;
    this.editableManifold = editableManifold;
    this.transform = {
      position: transform?.position ? [...transform.position] : [0, 0, 0],
      rotation: transform?.rotation ? [...transform.rotation] : [0, 0, 0],
      scale: transform?.scale ? [...transform.scale] : [1, 1, 1],
    };

    /** @type {THREE.Group} 承载网格与选中描边，变换挂在它身上 */
    this.group = new THREE.Group();
    this.group.name = this.name;
    this.group.userData.solidId = this.id;

    /** @type {THREE.Mesh|null} */
    this.mesh = null;
    /** @type {THREE.LineSegments|null} 选中时的描边 */
    this.edges = null;
    /** @type {THREE.BufferGeometry|null} */
    this.geometry = null;
    /** @type {THREE.MeshStandardMaterial|null} */
    this.material = null;

    this._worldManifold = null; // 变换烘焙后的实体缓存
    this._stats = null; // 度量信息缓存
    this._meshData = null; // 局部网格缓存（渲染和快照共用，避免重复 getMesh）
    this._selected = false;
    this._hovered = false;

    this._buildDisplay();
    this._syncTransformToObject();
  }

  /* ------------------------------------------------------------------ *
   *  显示对象
   * ------------------------------------------------------------------ */

  /**
   * @brief 依据 manifold 网格生成 three.js 几何体，并计算「折痕法线」。
   * @retval {void}
   * @note 直接 computeVertexNormals 会把立方体的棱也磨圆，CAD 看着会像橡皮泥；
   *       toCreasedNormals 只在夹角小于阈值的面上做平滑，圆柱侧面光滑、棱角依旧锋利。
   */
  _buildDisplay() {
    const { positions, indices } = manifoldMeshData(this.manifold);
    // 缓存一份：选中描边、快照、撤销都要用，重复向 WASM 要网格纯属浪费。
    this._meshData = { positions, indices };
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    base.setIndex(new THREE.BufferAttribute(indices, 1));
    base.computeBoundingSphere();
    base.computeBoundingBox();

    // 28° 是试出来的：圆柱 64 段相邻面夹角约 5.6°，会被平滑；
    // 立方体 90° 的棱超过阈值，保持硬边。
    this.geometry = toCreasedNormals(base, THREE.MathUtils.degToRad(28));
    base.dispose();

    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.color),
      roughness: 0.52,
      metalness: 0.06,
      envMapIntensity: 0.75,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.solidId = this.id;
    this.group.add(this.mesh);
  }

  /**
   * @brief 选中描边（懒创建，只在第一次选中时算，之后复用）。
   * @retval {THREE.LineSegments}
   */
  _ensureEdges() {
    if (!this.edges) {
      const edgeGeo = new THREE.EdgesGeometry(this.geometry, 24);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x5fd0ff,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
      });
      this.edges = new THREE.LineSegments(edgeGeo, edgeMat);
      this.edges.visible = false;
      this.edges.renderOrder = 2;
      this.group.add(this.edges);
    }
    return this.edges;
  }

  /**
   * @brief 设置选中状态（显示蓝色描边 + 材质轻微自发光）。
   * @param {boolean} on 是否选中。
   * @retval {void}
   */
  setSelected(on) {
    this._selected = on;
    if (on) this._ensureEdges();
    if (this.edges) this.edges.visible = on;
    if (this.material) {
      this.material.emissive.set(on ? 0x123b52 : 0x000000);
      this.material.emissiveIntensity = on ? 0.75 : 0;
    }
    this._applyHoverTint();
  }

  /**
   * @brief 设置悬停状态。
   * @param {boolean} on 鼠标是否悬停。
   * @retval {void}
   * @note 选中优先级高于悬停，两个都开的时候保持选中的蓝色，不叠加，免得脏。
   */
  setHovered(on) {
    this._hovered = on;
    this._applyHoverTint();
  }

  /** @brief 把「选中/悬停」状态折算成自发光颜色。 */
  _applyHoverTint() {
    if (!this.material) return;
    if (this._selected) {
      this.material.emissive.set(0x123b52);
      this.material.emissiveIntensity = 0.75;
    } else if (this._hovered) {
      this.material.emissive.set(0x1c2630);
      this.material.emissiveIntensity = 0.6;
    } else {
      this.material.emissive.set(0x000000);
      this.material.emissiveIntensity = 0;
    }
  }

  /**
   * @brief 改颜色，同步到材质。
   * @param {string} hex 十六进制颜色。
   * @retval {void}
   */
  setColor(hex) {
    this.color = hex;
    if (this.material) this.material.color.set(hex);
  }

  /* ------------------------------------------------------------------ *
   *  变换
   * ------------------------------------------------------------------ */

  /** @brief 把 this.transform 写到 three 对象上，并清掉依赖变换的缓存。 */
  _syncTransformToObject() {
    const [x, y, z] = this.transform.position;
    const [rx, ry, rz] = this.transform.rotation;
    const [sx, sy, sz] = this.transform.scale;
    this.group.position.set(x, y, z);
    this.group.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
      'XYZ',
    );
    // 缩放不允许为 0 / 负数：manifold 对奇异矩阵会报错，负缩放还会翻面。
    this.group.scale.set(Math.max(0.001, sx), Math.max(0.001, sy), Math.max(0.001, sz));
    this.group.updateMatrix();
    this._worldManifold = null;
    this._stats = null;
  }

  /**
   * @brief 设置变换（属性面板的数字输入走这里）。
   * @param {{position?:number[], rotation?:number[], scale?:number[]}} next 局部字段覆盖。
   * @retval {void}
   */
  setTransform(next) {
    if (next.position) this.transform.position = next.position.map(Number);
    if (next.rotation) this.transform.rotation = next.rotation.map(Number);
    if (next.scale) this.transform.scale = next.scale.map(Number);
    this._syncTransformToObject();
  }

  /**
   * @brief 从 three 对象反向读取变换（gizmo 拖动后调用）。
   * @retval {void}
   * @note gizmo 会直接改 group 的 position/quaternion/scale，必须把结果抄回
   *       this.transform，否则属性面板会显示旧值，导出也会用旧矩阵，很坑。
   */
  readTransformFromObject() {
    this.group.updateMatrix();
    const p = this.group.position;
    const e = this.group.rotation;
    const s = this.group.scale;
    this.transform = {
      position: [p.x, p.y, p.z],
      rotation: [
        THREE.MathUtils.radToDeg(e.x),
        THREE.MathUtils.radToDeg(e.y),
        THREE.MathUtils.radToDeg(e.z),
      ],
      scale: [s.x, s.y, s.z],
    };
    this._worldManifold = null;
    this._stats = null;
  }

  /** @brief 当前变换的 4×4 矩阵（列主序，可直接喂 manifold）。 */
  getMatrix() {
    this.group.updateMatrix();
    return this.group.matrix.clone();
  }

  /**
   * @brief 换掉实体几何（布尔结果写回时用），重建显示对象。
   * @param {any} manifold 新的 manifold 实体。
   * @retval {void}
   * @note 旧几何必须手动 dispose，不然每次布尔都会在显存里留一份垃圾，
   *       改上几十次模型就能吃掉几百 MB 显存。
   */
  setManifold(manifold) {
    this.manifold = manifold;
    this._worldManifold = null;
    this._stats = null;

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.geometry?.dispose();
      this.material?.dispose();
      this.mesh = null;
    }
    if (this.edges) {
      this.group.remove(this.edges);
      this.edges.geometry.dispose();
      this.edges.material.dispose();
      this.edges = null;
    }
    this._buildDisplay();
    this.setSelected(this._selected);
  }

  /* ------------------------------------------------------------------ *
   *  几何数据
   * ------------------------------------------------------------------ */

  /**
   * @brief 拿到「应用了变换」的 manifold，供布尔、统计、导出使用。
   * @retval {any} 烘焙后的实体；不可编辑的导入网格返回 null。
   * @note 结果会缓存，直到变换或几何变化；布尔运算很贵，能省一次是一次。
   */
  getWorldManifold() {
    if (!this.manifold) return null;
    if (!this._worldManifold) {
      const m = this.getMatrix();
      this._worldManifold = this.manifold.transform(m.elements);
    }
    return this._worldManifold;
  }

  /**
   * @brief 读取体积、表面积、包围盒等打印信息（基于世界坐标）。
   * @retval {{volume:number, area:number, triangles:number, bbox:object, size:number[], status:number, empty:boolean}|null}
   */
  stats() {
    if (!this._stats) {
      const world = this.getWorldManifold();
      this._stats = world ? measureManifold(world) : null;
    }
    return this._stats;
  }

  /** @brief 世界坐标下的包围盒（没有几何时返回 null）。 */
  worldBox() {
    const st = this.stats();
    return st ? st.bbox : null;
  }

  /**
   * @brief 世界坐标下的几何中心（包围盒中心）。
   * @retval {THREE.Vector3} 中心点；没有几何时退回对象原点。
   * @note gizmo 要挂在这个点上，不然旋转会绕着实体的建模原点转，
   *       对底座在地上的图元来说，看起来就像“绕着脚踝甩圈”，很别扭。
   */
  worldCenter() {
    const bb = this.stats()?.bbox;
    if (!bb) return this.group.position.clone();
    return new THREE.Vector3(
      (bb.min[0] + bb.max[0]) / 2,
      (bb.min[1] + bb.max[1]) / 2,
      (bb.min[2] + bb.max[2]) / 2,
    );
  }

  /* ------------------------------------------------------------------ *
   *  序列化
   * ------------------------------------------------------------------ */

  /**
   * @brief 导出轻量快照，用于撤销栈和工程文件。
   * @retval {object} 只含数组和基础类型，可以直接 JSON 序列化。
   * @note 存的是「局部网格 + 变换」，不是世界网格：这样撤销回去还能继续用
   *       数值面板改位置，而不是被烘死成一块石头。
   */
  toSnapshot() {
    const { positions, indices } = this._meshData || manifoldMeshData(this.manifold);
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      kind: this.kind,
      transform: {
        position: [...this.transform.position],
        rotation: [...this.transform.rotation],
        scale: [...this.transform.scale],
      },
      positions: Array.from(positions),
      indices: Array.from(indices),
    };
  }

  /**
   * @brief 从快照重建实体。
   * @param {object} snap 由 toSnapshot 产出的对象。
   * @retval {Solid} 新实体。
   */
  static fromSnapshot(snap) {
    const manifold = manifoldFromMeshData(
      new Float32Array(snap.positions),
      new Uint32Array(snap.indices),
    );
    return new Solid({
      id: snap.id,
      name: snap.name,
      color: snap.color,
      kind: snap.kind,
      manifold,
      transform: snap.transform,
    });
  }

  /* ------------------------------------------------------------------ *
   *  清理
   * ------------------------------------------------------------------ */

  /** @brief 释放 GPU 资源并把自己从父节点摘下来。 */
  dispose() {
    this.group.removeFromParent();
    this.geometry?.dispose();
    this.material?.dispose();
    if (this.edges) {
      this.edges.geometry.dispose();
      this.edges.material.dispose();
    }
    this.manifold = null;
    this._worldManifold = null;
    this._stats = null;
  }
}
