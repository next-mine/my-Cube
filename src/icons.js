/**
 * @file 图标库
 * @brief 全部用内联 SVG 字符串，统一 24×24 视框、1.7 线宽、圆角端点，
 *        这样在深色面板里线条粗细一致，不会有的图标糊成一团。
 */

const paths = {
  // —— 选择与绘制 ——
  select:
    '<path d="M5 3.5l6.5 16 2.2-6.3 6.3-2.2z" stroke-linejoin="round"/><path d="M13 13l5 5" stroke-linecap="round"/>',
  line: '<path d="M4.5 19.5L19.5 4.5" stroke-linecap="round"/><circle cx="4.5" cy="19.5" r="2"/><circle cx="19.5" cy="4.5" r="2"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M4 9h16M7 6v12" stroke-opacity=".35"/>',
  circle: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  polygon: '<path d="M12 3.8l7 5-2.7 8.2H7.7L5 8.8z" stroke-linejoin="round"/>',
  arc: '<path d="M4 19a15 15 0 0 1 15-15" stroke-linecap="round"/><circle cx="4" cy="19" r="1.6"/><circle cx="19" cy="4" r="1.6"/>',
  measure:
    '<path d="M3 14l11-11 7 7-11 11z" stroke-linejoin="round"/><path d="M7.5 9.5l2 2M10 7l2 2M12.5 4.5l2 2" stroke-linecap="round"/>',

  // —— 建模 ——
  extrude:
    '<path d="M12 20V9" stroke-linecap="round"/><path d="M8 12l4-4 4 4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 7l8-4 8 4-8 4z" stroke-linejoin="round" stroke-opacity=".55"/>',
  revolve:
    '<path d="M12 4a8 8 0 1 0 8 8" stroke-linecap="round"/><path d="M20 4v4h-4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4l3 2" stroke-linecap="round"/>',
  primitives:
    '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" stroke-linejoin="round"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" stroke-linejoin="round"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" stroke-linejoin="round"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" stroke-linejoin="round"/>',
  cylinder: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11" stroke-linecap="round"/>',
  sphere: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3.2" stroke-opacity=".5"/><ellipse cx="12" cy="12" rx="3.2" ry="8" stroke-opacity=".5"/>',
  cone: '<path d="M12 3l7 15.5c0 1.2-3.1 2.2-7 2.2s-7-1-7-2.2z" stroke-linejoin="round"/>',
  torus: '<ellipse cx="12" cy="12" rx="9" ry="6"/><ellipse cx="12" cy="12" rx="4" ry="2.2" stroke-opacity=".6"/>',
  tube: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11" stroke-linecap="round"/><ellipse cx="12" cy="6.5" rx="3.5" ry="1.4" stroke-opacity=".6"/>',
  prism: '<path d="M12 3.5l7 4v9l-7 4-7-4v-9z" stroke-linejoin="round"/><path d="M12 11.5l7-4M12 11.5l-7-4M12 11.5v9" stroke-linejoin="round"/><path d="M5 7.5l7 4 7-4" stroke-opacity=".5"/>',

  // —— 布尔 ——
  union:
    '<circle cx="9.5" cy="12" r="5.5"/><circle cx="14.5" cy="12" r="5.5"/><path d="M12 6.2a8.5 8.5 0 0 1 0 11.6 8.5 8.5 0 0 1 0-11.6z" fill="currentColor" fill-opacity=".18" stroke="none"/>',
  subtract:
    '<circle cx="9.5" cy="12" r="5.5"/><path d="M14.5 6.5a5.5 5.5 0 0 1 0 11" stroke-dasharray="2.5 2.5"/><path d="M7 12h5" stroke-linecap="round"/>',
  intersect:
    '<circle cx="9.5" cy="12" r="5.5" stroke-opacity=".45"/><circle cx="14.5" cy="12" r="5.5" stroke-opacity=".45"/><path d="M12 6.2a8.5 8.5 0 0 1 0 11.6 8.5 8.5 0 0 1 0-11.6z" fill="currentColor" fill-opacity=".3"/>',

  // —— 变换 ——
  move: '<path d="M12 3v18M3 12h18" stroke-linecap="round"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" stroke-linecap="round" stroke-linejoin="round"/>',
  rotate:
    '<path d="M20 12a8 8 0 1 1-2.4-5.7" stroke-linecap="round"/><path d="M20 3v5h-5" stroke-linecap="round" stroke-linejoin="round"/>',
  scale:
    '<path d="M4 14v6h6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20L14 10" stroke-linecap="round"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1"/>',
  trash:
    '<path d="M4 7h16M9 7V4.8h6V7M6.5 7l1 13h9l1-13" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v5M14 11v5" stroke-linecap="round"/>',
  duplicate:
    '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" stroke-linecap="round"/>',

  // —— 视图与文件 ——
  fit: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" stroke-linecap="round" stroke-linejoin="round"/>',
  grid: '<path d="M4 9h16M4 15h16M9 4v16M15 4v16" stroke-opacity=".8"/><rect x="4" y="4" width="16" height="16" rx="1"/>',
  undo: '<path d="M9 7L4 12l5 5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12h9a6 6 0 0 1 0 12h-2" stroke-linecap="round"/>',
  redo: '<path d="M15 7l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12h-9a6 6 0 0 0 0 12h2" stroke-linecap="round"/>',
  export:
    '<path d="M12 4v11m0 0l-4-4m4 4l4-4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" stroke-linecap="round"/>',
  import:
    '<path d="M12 15V4m0 0L8 8m4-4l4 4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 15v4h14v-4" stroke-linecap="round" stroke-linejoin="round"/>',
  save: '<path d="M5 4h11l3 3v13H5z" stroke-linejoin="round"/><path d="M8 4v5h7V4M8 20v-6h8v6" stroke-linejoin="round"/>',
  open: '<path d="M3.5 7.5h6l2 2h9v9.5h-17z" stroke-linejoin="round"/><path d="M3.5 7.5V5h6l2 2.5" stroke-linejoin="round"/>',
  new: '<path d="M6 3.5h8l4 4v13H6z" stroke-linejoin="round"/><path d="M14 3.5v4h4M12 11v6M9 14h6" stroke-linecap="round"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.4a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1 .9-1 1.6v.4" stroke-linecap="round"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6" stroke-linecap="round"/><circle cx="12" cy="7.5" r=".9" fill="currentColor" stroke="none"/>',
  ruler:
    '<path d="M3 14l11-11 7 7-11 11z" stroke-linejoin="round"/><path d="M7.5 9.5l2 2M10 7l2 2M12.5 4.5l2 2" stroke-linecap="round"/>',
  bed: '<path d="M3 8h18v10H3z" stroke-linejoin="round"/><path d="M6 18v3M18 18v3M7 12h10" stroke-linecap="round"/>',
  drop: '<path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19h16" stroke-linecap="round"/><path d="M4 15h4M16 15h4" stroke-linecap="round" stroke-opacity=".5"/>',
  center:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke-linecap="round"/>',
};

/**
 * @brief 取一个图标的 SVG 字符串。
 * @param {string} name 图标名（见 paths 的键）。
 * @param {number} [size=20] 像素尺寸。
 * @retval {string} 可直接 innerHTML 的 SVG 标记；名字不存在时返回空字符串。
 */
export function icon(name, size = 20) {
  const p = paths[name];
  if (!p) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${p}</svg>`;
}

export { paths as iconPaths };
