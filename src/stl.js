/**
 * @file STL / OBJ 导出与 STL 导入
 * @brief STL 是 3D 打印的“普通话”，但它只存三角面、不存拓扑，也不带单位。
 *        这里负责把 manifold 的三角面写成二进制/ASCII STL，以及把外部 STL 读回来。
 *
 * @note 二进制 STL 每个三角面固定 50 字节，文件头 80 字节 + 面数 4 字节。
 *       单位是毫米，和内核一致，导出时不再缩放。
 */

import { weldVertices } from './kernel.js';

/**
 * @brief 把 manifold 的网格数据按三角形拆出来，并算出每个面的法线。
 * @param {{positions:Float32Array, indices:Uint32Array}} mesh 网格数据。
 * @retval {{a:number[], b:number[], c:number[], n:number[]}[]} 三角形列表。
 */
export function trianglesOfMesh(mesh) {
  const { positions, indices } = mesh;
  const out = [];
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const a = [positions[ia], positions[ia + 1], positions[ia + 2]];
    const b = [positions[ib], positions[ib + 1], positions[ib + 2]];
    const c = [positions[ic], positions[ic + 1], positions[ic + 2]];

    // 法线 = (b-a) × (c-a)，manifold 保证三角形从外侧看是逆时针。
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    out.push({ a, b, c, n: [nx, ny, nz] });
  }
  return out;
}

/**
 * @brief 生成二进制 STL。
 * @param {Array<{positions:Float32Array, indices:Uint32Array}>} meshes 一个或多个网格。
 * @param {string} [header='Cubo 3D model'] 文件头文字（最多 80 字节）。
 * @retval {ArrayBuffer} 可直接存盘的二进制内容。
 *
 * @note 面数是所有网格三角形之和。多实体导出时会合成一个 STL 文件，
 *       切片软件会按连通区域自动识别成多个零件，不需要拆文件。
 */
export function buildBinarySTL(meshes, header = 'Cubo 3D model') {
  const triangles = meshes.flatMap((m) => trianglesOfMesh(m));
  const count = triangles.length;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);

  // 80 字节文件头，用空格补齐；不要以 "solid" 开头，否则有些解析器会误判成 ASCII。
  const headerBytes = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buffer, 0, 80).set(headerBytes);

  view.setUint32(80, count, true);
  let offset = 84;
  for (const tri of triangles) {
    view.setFloat32(offset, tri.n[0], true);
    view.setFloat32(offset + 4, tri.n[1], true);
    view.setFloat32(offset + 8, tri.n[2], true);
    const verts = [tri.a, tri.b, tri.c];
    for (let v = 0; v < 3; v += 1) {
      view.setFloat32(offset + 12 + v * 12, verts[v][0], true);
      view.setFloat32(offset + 16 + v * 12, verts[v][1], true);
      view.setFloat32(offset + 20 + v * 12, verts[v][2], true);
    }
    view.setUint16(offset + 48, 0, true); // 属性字节数，打印用不到
    offset += 50;
  }
  return buffer;
}

/**
 * @brief 生成 ASCII STL，方便人眼检查或喂给老软件。
 * @param {Array<{positions:Float32Array, indices:Uint32Array}>} meshes 网格列表。
 * @param {string} [name='cubo'] 实体名。
 * @retval {string} ASCII STL 文本。
 */
export function buildAsciiSTL(meshes, name = 'cubo') {
  const lines = [`solid ${name}`];
  for (const mesh of meshes) {
    for (const tri of trianglesOfMesh(mesh)) {
      lines.push(`  facet normal ${tri.n[0]} ${tri.n[1]} ${tri.n[2]}`);
      lines.push('    outer loop');
      for (const v of [tri.a, tri.b, tri.c]) {
        lines.push(`      vertex ${v[0]} ${v[1]} ${v[2]}`);
      }
      lines.push('    endloop');
      lines.push('  endfacet');
    }
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}

/**
 * @brief 生成 OBJ 文本（只含顶点和面，够用了）。
 * @param {Array<{positions:Float32Array, indices:Uint32Array}>} meshes 网格列表。
 * @param {string} [name='cubo'] 对象名。
 * @retval {string} OBJ 文本。
 *
 * @note OBJ 的顶点索引从 1 开始，和我们的 0 基索引差一位，导出后要加 1。
 */
export function buildOBJ(meshes, name = 'cubo') {
  const lines = [`# Cubo 立方工坊导出`, `o ${name}`];
  let base = 1;
  for (const mesh of meshes) {
    const { positions, indices } = mesh;
    for (let i = 0; i < positions.length; i += 3) {
      lines.push(`v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
    }
    for (let i = 0; i < indices.length; i += 3) {
      lines.push(`f ${indices[i] + base} ${indices[i + 1] + base} ${indices[i + 2] + base}`);
    }
    base += positions.length / 3;
  }
  return lines.join('\n');
}

/**
 * @brief 解析 STL（自动识别二进制/ASCII），返回未焊接的三角面网格。
 *
 * @param {ArrayBuffer} buffer 文件内容。
 * @retval {{positions:Float32Array, indices:Uint32Array, binary:boolean}}
 *         每个三角形三个独立顶点，需要再调用 weldVertices 才能变成流形网格。
 * @throws 文件明显损坏或不是 STL 时抛错。
 */
export function parseSTL(buffer) {
  const view = new DataView(buffer);

  // 二进制判断：先看「84 + 面数×50」是否和文件长度对得上，这比看开头是不是
  // "solid" 可靠得多——二进制 STL 的文件头也经常被写成 solid 开头。
  if (buffer.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (count > 0 && 84 + count * 50 <= buffer.byteLength + 50) {
      const positions = new Float32Array(count * 9);
      let p = 0;
      for (let i = 0; i < count; i += 1) {
        const offset = 84 + i * 50 + 12; // 跳过法线
        for (let v = 0; v < 9; v += 1) {
          positions[p] = view.getFloat32(offset + v * 4, true);
          p += 1;
        }
      }
      const indices = new Uint32Array(count * 3);
      for (let i = 0; i < indices.length; i += 1) indices[i] = i;
      return { positions, indices, binary: true };
    }
  }

  // ASCII 兜底
  let text;
  try {
    text = new TextDecoder('utf-8').decode(buffer);
  } catch {
    throw new Error('无法读取这个 STL 文件');
  }
  if (!/facet|vertex/i.test(text)) {
    throw new Error('这个文件看起来不是 STL 格式');
  }
  const verts = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m;
  while ((m = re.exec(text))) {
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (verts.length < 9 || verts.length % 9 !== 0) {
    throw new Error('STL 里的三角形数量不对，文件可能损坏了');
  }
  const positions = new Float32Array(verts);
  const indices = new Uint32Array(verts.length / 3);
  for (let i = 0; i < indices.length; i += 1) indices[i] = i;
  return { positions, indices, binary: false };
}

/**
 * @brief 把 STL 的散三角面焊接成流形网格。
 * @param {{positions:Float32Array, indices:Uint32Array}} parsed parseSTL 的结果。
 * @retval {{positions:Float32Array, indices:Uint32Array, mergedVertices:number}}
 */
export function weldSTL(parsed) {
  return weldVertices(parsed.positions, parsed.indices, 4);
}

/**
 * @brief 触发浏览器下载。
 * @param {Blob|ArrayBuffer|string} content 内容。
 * @param {string} filename 文件名。
 * @param {string} [mime='application/octet-stream'] MIME 类型。
 * @retval {void}
 */
export function download(content, filename, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 会让某些浏览器的下载中断，宽限一秒钟再回收。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
