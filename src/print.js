/**
 * @file 打印检查与摆盘
 * @brief 面向 3D 打印的几何体检：体积、耗材重量、悬垂面积占比、最小壁厚提示，
 *        以及「贴床 / 居中 / 智能摆正」这几个一键操作。
 *
 * @note 这里说的「悬垂」按 FDM 的通用标准：法线与竖直向下方向夹角小于 45°，
 *       也就是 nz < -cos(45°) ≈ -0.707 的朝下三角面，通常需要加支撑。
 */

import * as THREE from 'three';
import { manifoldMeshData } from './kernel.js';

/** @brief 常见耗材密度（g/cm³）。 */
export const MATERIALS = {
  PLA: { label: 'PLA', density: 1.24 },
  PETG: { label: 'PETG', density: 1.27 },
  ABS: { label: 'ABS', density: 1.04 },
  TPU: { label: 'TPU', density: 1.21 },
  PA: { label: '尼龙 PA', density: 1.14 },
  RESIN: { label: '光敏树脂', density: 1.15 },
};

/** @brief FDM 45° 悬垂阈值：normal.z 小于这个值就算朝下太陡。 */
const OVERHANG_COS = -Math.cos(THREE.MathUtils.degToRad(45));

/**
 * @brief 对实体做一次完整的打印体检。
 *
 * @param {any} manifold 世界坐标下的 manifold 实体。
 * @param {string} [material='PLA'] 耗材名称，用于估算重量。
 * @retval {object} 体检结果：
 *   - volume: 体积 mm³
 *   - area: 表面积 mm²
 *   - size: [宽, 深, 高] mm
 *   - bbox: 包围盒
 *   - weight: 估算重量 g
 *   - overhangRatio: 悬垂面积占比（0~1）
 *   - flatRatio: 水平面占比，越大越“好打印”
 *   - triangles: 三角面数
 *   - watertight: 是否封闭（manifold 的 status 为 0 即完全流形）
 */
export function analyzePrint(manifold, material = 'PLA') {
  const mesh = manifoldMeshData(manifold);
  const { positions, indices } = mesh;
  const bbox = manifold.boundingBox();
  const volume = manifold.volume();
  const area = manifold.surfaceArea();
  const density = (MATERIALS[material] || MATERIALS.PLA).density;

  let totalArea = 0;
  let overhangArea = 0;
  let flatArea = 0;
  const bedZ = bbox.min[2];

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;

    const a = len / 2; // 三角形面积 = 叉积模长的一半
    totalArea += a;

    // 贴在打印床上的那一面虽然法线朝下，但下面就是热床，不需要支撑，
    // 所以把「三个顶点都在最低点附近」的三角面排除掉，悬垂率才不会虚高。
    const onBed =
      positions[ia + 2] <= bedZ + 0.2 &&
      positions[ib + 2] <= bedZ + 0.2 &&
      positions[ic + 2] <= bedZ + 0.2;
    if (!onBed && nz / len < OVERHANG_COS) overhangArea += a;
    if (Math.abs(nz / len) > 0.999) flatArea += a;
  }

  return {
    volume,
    area,
    size: [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]],
    bbox,
    weight: (volume / 1000) * density, // mm³ → cm³ 是 ÷1000，再乘密度得克数
    overhangRatio: totalArea > 0 ? overhangArea / totalArea : 0,
    flatRatio: totalArea > 0 ? flatArea / totalArea : 0,
    triangles: mesh.triangleCount,
    // manifold 的 status() 在 embind 里返回的是字符串（'NoError'），Node 下有时是 0，
    // 两种都当成“完全流形”，不然界面会误报“网格不封闭”。
    watertight: manifold.status() === 0 || manifold.status() === 'NoError',
    material,
    density,
  };
}

/**
 * @brief 多实体合并体检（把体积加起来，包围盒合并，悬垂按面积加权）。
 * @param {Array<object>} reports analyzePrint 的结果数组。
 * @retval {object} 合并后的体检结果。
 */
export function mergeReports(reports) {
  const valid = reports.filter(Boolean);
  if (valid.length === 0) return null;
  const box = new THREE.Box3();
  let volume = 0;
  let area = 0;
  let weight = 0;
  let overhang = 0;
  let flat = 0;
  let triangles = 0;
  for (const r of valid) {
    box.expandByPoint(new THREE.Vector3(r.bbox.min[0], r.bbox.min[1], r.bbox.min[2]));
    box.expandByPoint(new THREE.Vector3(r.bbox.max[0], r.bbox.max[1], r.bbox.max[2]));
    volume += r.volume;
    area += r.area;
    weight += r.weight;
    overhang += r.overhangRatio * r.area;
    flat += r.flatRatio * r.area;
    triangles += r.triangles;
  }
  const min = box.min;
  const max = box.max;
  return {
    volume,
    area,
    weight,
    size: [max.x - min.x, max.y - min.y, max.z - min.z],
    bbox: { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] },
    overhangRatio: area > 0 ? overhang / area : 0,
    flatRatio: area > 0 ? flat / area : 0,
    triangles,
    watertight: valid.every((r) => r.watertight),
    material: valid[0].material,
    count: valid.length,
  };
}

/**
 * @brief 找出「最适合当底面」的平面，并算出把它转到朝下的旋转矩阵。
 *
 * @param {any} manifold 世界坐标下的实体。
 * @retval {{normal:number[], area:number, matrix:number[]}|null}
 *         法线、该方向的总面积、4×4 旋转矩阵（列主序）；没有可用平面时返回 null。
 *
 * @note 策略很朴素但有效：先按法线方向把三角面分桶（保留三位小数），
 *       统计每个方向的总面积，挑最大的那块平面，再把它转到 -Z 方向。
 *       这比“最小包围盒”简单得多，而且更符合打印时“找个大平面贴床”的直觉。
 */
export function bestBedRotation(manifold) {
  const { positions, indices } = manifoldMeshData(manifold);
  const buckets = new Map();

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    const area = len / 2;
    const key = `${nx.toFixed(3)},${ny.toFixed(3)},${nz.toFixed(3)}`;
    const hit = buckets.get(key);
    if (hit) {
      hit.area += area;
    } else {
      buckets.set(key, { normal: new THREE.Vector3(nx, ny, nz), area });
    }
  }

  let best = null;
  for (const bucket of buckets.values()) {
    // 已经朝下的面不用再转；水平面优先（贴床最稳），其余按面积排。
    if (bucket.normal.z < -0.995) {
      return {
        normal: [bucket.normal.x, bucket.normal.y, bucket.normal.z],
        area: bucket.area,
        matrix: new THREE.Matrix4().identity().elements.slice(),
        alreadyFlat: true,
      };
    }
    const score = bucket.area * (0.5 + 0.5 * Math.abs(bucket.normal.z));
    if (!best || score > best.score) {
      best = { ...bucket, score };
    }
  }
  if (!best) return null;

  const down = new THREE.Vector3(0, 0, -1);
  const q = new THREE.Quaternion().setFromUnitVectors(best.normal.clone().normalize(), down);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  return {
    normal: [best.normal.x, best.normal.y, best.normal.z],
    area: best.area,
    matrix: m.elements.slice(),
    alreadyFlat: false,
  };
}

/**
 * @brief 把实体往上平移到 z=0（贴床）。
 * @param {any} manifold 实体。
 * @retval {{manifold:any, shift:number}} 平移后的实体与平移量。
 */
export function dropManifold(manifold) {
  const bb = manifold.boundingBox();
  const shift = -bb.min[2];
  if (Math.abs(shift) < 1e-6) return { manifold, shift: 0 };
  return { manifold: manifold.translate([0, 0, shift]), shift };
}

/**
 * @brief 把实体在 XY 平面上居中到原点。
 * @param {any} manifold 实体。
 * @retval {any} 平移后的实体。
 */
export function centerManifold(manifold) {
  const bb = manifold.boundingBox();
  const cx = (bb.min[0] + bb.max[0]) / 2;
  const cy = (bb.min[1] + bb.max[1]) / 2;
  if (Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6) return manifold;
  return manifold.translate([-cx, -cy, 0]);
}

/**
 * @brief 悬垂占比对应的建议文案。
 * @param {number} ratio 0~1。
 * @retval {{level:'ok'|'warn'|'bad', text:string}} 提示等级和文案。
 */
export function overhangAdvice(ratio) {
  if (ratio < 0.02) return { level: 'ok', text: '几乎没有悬垂，直接打' };
  if (ratio < 0.12) return { level: 'warn', text: '少量悬垂，局部可能需要支撑' };
  return { level: 'bad', text: '悬垂较多，建议加支撑或换个方向摆' };
}
