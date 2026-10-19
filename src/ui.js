/**
 * @file 界面层
 * @brief 工具栏、属性面板、状态栏、菜单、对话框、Toast、尺寸输入框。
 *        界面只读 App 的状态、发 App 的动作，不直接改实体，职责分得干干净净。
 */

import { icon } from './icons.js';
import { COLOR_SWATCHES } from './solid.js';
import { MATERIALS } from './print.js';

/** @brief 左侧工具轨的分组配置（desc 会显示在悬停注释里）。 */
const RAIL_GROUPS = [
  [
    {
      tool: 'select',
      icon: 'select',
      label: '选择',
      key: 'Q',
      desc: '点选实体，按住 Shift 可多选；拖动空白处旋转视图。',
    },
  ],
  [
    {
      tool: 'line',
      icon: 'line',
      label: '直线',
      key: 'L',
      desc: '连续点击画折线，点回起点或按 Enter 闭合轮廓。',
    },
    {
      tool: 'rect',
      icon: 'rect',
      label: '矩形',
      key: 'R',
      desc: '点两个对角点画矩形，闭合后自动进入推拉。',
    },
    {
      tool: 'circle',
      icon: 'circle',
      label: '圆',
      key: 'C',
      desc: '先点圆心，再点圆周确定半径；画在实体表面可以直接挖孔。',
    },
    {
      tool: 'polygon',
      icon: 'polygon',
      label: '多边形',
      key: 'G',
      desc: '先点中心，再点外接圆；边数可在右侧「视图与网格」里改。',
    },
    {
      tool: 'arc',
      icon: 'arc',
      label: '圆弧',
      key: 'A',
      desc: '依次点起点、弧上一点、终点，自动用弦闭合为弓形。',
    },
  ],
  [
    {
      tool: 'extrude',
      icon: 'extrude',
      label: '推拉',
      key: 'P',
      desc: '把闭合轮廓上下拖动成体。画在表面上时：往外拉是合并，往里推是挖孔。',
    },
    {
      tool: 'revolve',
      icon: 'revolve',
      label: '旋转体',
      key: 'O',
      desc: '在前视平面画截面，闭合后绕 Z 轴旋转 360°，做轴套、法兰很顺手。',
    },
  ],
  [
    {
      action: 'primitives',
      icon: 'primitives',
      label: '图元',
      desc: '立方体、圆柱、球、圆锥、圆环、圆管、六棱柱。',
    },
  ],
  [
    {
      action: 'boolean',
      op: 'union',
      icon: 'union',
      label: '并集',
      desc: '把选中的多个实体合并成一个。',
    },
    {
      action: 'boolean',
      op: 'subtract',
      icon: 'subtract',
      label: '差集',
      desc: '用最先选中的实体，减去其余选中的实体。',
    },
    {
      action: 'boolean',
      op: 'intersect',
      icon: 'intersect',
      label: '交集',
      desc: '只保留选中实体之间重叠的部分。',
    },
  ],
  [
    { tool: 'move', icon: 'move', label: '移动', key: '1', desc: '拖动坐标轴箭头移动实体，也可以直接在右侧输入数值。' },
    { tool: 'rotate', icon: 'rotate', label: '旋转', key: '2', desc: '拖动彩色圆环绕轴旋转实体，旋转中心是几何中心。' },
    { tool: 'scale', icon: 'scale', label: '缩放', key: '3', desc: '拖动方块缩放实体，或在右侧改外形尺寸。' },
  ],
  [
    { tool: 'measure', icon: 'measure', label: '测量', key: 'M', desc: '点两个位置量距离，结果显示在底部状态栏。' },
    { action: 'fit', icon: 'fit', label: '适配', key: 'F', desc: '把所有实体框进视图。' },
  ],
];

/** @brief 基础图元菜单项。 */
const PRIMITIVES = [
  { kind: 'box', icon: 'box', label: '立方体' },
  { kind: 'cylinder', icon: 'cylinder', label: '圆柱' },
  { kind: 'sphere', icon: 'sphere', label: '球体' },
  { kind: 'cone', icon: 'cone', label: '圆锥' },
  { kind: 'torus', icon: 'torus', label: '圆环' },
  { kind: 'tube', icon: 'tube', label: '圆管' },
  { kind: 'prism', icon: 'prism', label: '六棱柱' },
];

/** @brief 保留两位小数的格式化。 */
function fmt(n, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** @brief 千分位，体积数字比较长时好看一点。 */
function formatNumber(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}

/**
 * @brief 初始化界面，绑定所有 DOM 事件。
 * @param {import('./app.js').App} app 应用实例。
 * @retval {void}
 */
export function initUI(app) {
  const ui = {
    app,
    rail: document.getElementById('toolrail'),
    inspector: document.getElementById('inspector'),
    statusMsg: document.getElementById('status-msg'),
    statusHint: document.getElementById('status-hint'),
    statusCoords: document.getElementById('status-coords'),
    statusSnap: document.getElementById('status-snap'),
    statusLight: document.getElementById('status-light'),
    emptyState: document.getElementById('empty-state'),
    sketchBanner: document.getElementById('sketch-banner'),
    sketchPlaneLabel: document.getElementById('sketch-plane-label'),
    sketchOpLabel: document.getElementById('sketch-op-label'),
    sketchThrough: document.getElementById('sketch-through'),
    dim: document.getElementById('dim-input'),
    dimField: document.getElementById('dim-field'),
    dimLabel: document.getElementById('dim-label'),
    menuRoot: document.getElementById('menu-root'),
    modalRoot: document.getElementById('modal-root'),
    toasts: document.getElementById('toasts'),
    tooltip: document.getElementById('tooltip'),
    docName: document.getElementById('doc-name'),
    saveState: document.getElementById('save-state'),
    undoBtn: document.getElementById('btn-undo'),
    redoBtn: document.getElementById('btn-redo'),
  };

  app.ui = ui;

  renderRail(ui);
  renderInspector(ui);
  bindRail(ui);
  bindTooltips(ui);
  bindTopbar(ui);
  bindViewportControls(ui);
  bindSketchBanner(ui);
  bindDimension(ui);
  bindInspector(ui);
  bindEvents(ui);
  bindFileInput(ui);
  updateEmptyState(ui);
  updateHistoryButtons(ui);
  updateStatus(ui, { message: '就绪', level: 'ok' });
}

/* ========================================================================== *
 *  工具栏
 * ========================================================================== */

/** @brief 渲染左侧工具栏。 */
function renderRail(ui) {
  const html = RAIL_GROUPS.map((group, gi) => {
    const buttons = group
      .map((item) => {
        const attrs = item.tool
          ? `data-tool="${item.tool}"`
          : item.action === 'boolean'
            ? `data-action="boolean" data-op="${item.op}"`
            : `data-action="${item.action}"`;
        const active = item.tool && ui.app.tool === item.tool ? ' is-active' : '';
        return `<button class="tool-btn${active}" ${attrs} data-title="${item.label}" data-key="${item.key || ''}" data-desc="${item.desc || item.label}" aria-label="${item.label}">
          ${icon(item.icon, 18)}<span class="tool-label">${item.label}</span>
        </button>`;
      })
      .join('');
    const sep = gi === 0 ? '' : '<div class="rail-sep"></div>';
    return `${sep}<div class="rail-group">${buttons}</div>`;
  }).join('');
  ui.rail.innerHTML = html;
}

/** @brief 绑定工具栏点击。 */
function bindRail(ui) {
  ui.rail.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool-btn');
    if (!btn) return;
    const { tool, action, op } = btn.dataset;
    if (tool) {
      ui.app.setTool(tool);
      return;
    }
    if (action === 'boolean') {
      ui.app.applyBoolean(op);
      return;
    }
    if (action === 'fit') {
      ui.app.viewport.fit(ui.app.solids);
      return;
    }
    if (action === 'primitives') {
      const rect = btn.getBoundingClientRect();
      openMenu(ui, btn, PRIMITIVES.map((p) => ({
        icon: p.icon,
        label: p.label,
        onClick: () => ui.app.addPrimitive(p.kind),
      })), rect.right + 8, rect.top);
    }
  });
}

/** @brief 刷新工具轨的选中态与布尔按钮可用态。 */
function updateRailState(ui) {
  const selected = ui.app.selection.size;
  for (const btn of ui.rail.querySelectorAll('.tool-btn')) {
    const { tool, action, op } = btn.dataset;
    if (tool) btn.classList.toggle('is-active', ui.app.tool === tool);
    if (action === 'boolean') {
      btn.classList.toggle('is-disabled', selected < 2);
      btn.title = selected < 2 ? '先选中至少两个实体' : '';
    }
  }
}

/** @brief 工具栏悬停注释：名称 + 快捷键 + 一句人话说明。 */
function bindTooltips(ui) {
  const tip = ui.tooltip;
  let timer = null;
  let current = null;

  const hide = () => {
    clearTimeout(timer);
    timer = null;
    current = null;
    tip.classList.remove('is-visible');
    tip.hidden = true;
  };

  const place = (btn) => {
    const rect = btn.getBoundingClientRect();
    const width = 252;
    let left = rect.right + 12;
    if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 12);
    const height = tip.offsetHeight || 90;
    const top = Math.min(
      Math.max(8, rect.top + rect.height / 2 - height / 2),
      window.innerHeight - height - 8,
    );
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const show = (btn) => {
    const title = btn.dataset.title || '';
    const key = btn.dataset.key || '';
    const desc = btn.dataset.desc || '';
    tip.innerHTML = `<div class="tt-title">${title}${key ? `<kbd>${key}</kbd>` : ''}</div><div class="tt-desc">${desc}</div>`;
    tip.hidden = false;
    place(btn);
    requestAnimationFrame(() => tip.classList.add('is-visible'));
  };

  ui.rail.addEventListener('pointerover', (e) => {
    const btn = e.target.closest('.tool-btn');
    if (!btn || btn === current) return;
    current = btn;
    clearTimeout(timer);
    // 延迟 200ms：鼠标只是扫过工具栏时，不会一串提示闪个不停。
    timer = setTimeout(() => {
      if (current === btn) show(btn);
    }, 200);
  });

  ui.rail.addEventListener('pointerout', (e) => {
    if (e.relatedTarget && ui.rail.contains(e.relatedTarget)) return;
    hide();
  });

  ui.rail.addEventListener('pointerdown', hide);
  ui.rail.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('blur', hide);
}

/* ========================================================================== *
 *  顶栏
 * ========================================================================== */

/** @brief 顶栏按钮与菜单。 */
function bindTopbar(ui) {
  document.getElementById('btn-export').addEventListener('click', () => openExportDialog(ui));
  ui.undoBtn.addEventListener('click', () => ui.app.undo());
  ui.redoBtn.addEventListener('click', () => ui.app.redo());

  ui.docName.addEventListener('change', () => {
    ui.app.setDocName(ui.docName.value.trim());
  });
  ui.docName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ui.docName.blur();
  });

  document.getElementById('menubar').addEventListener('click', (e) => {
    const btn = e.target.closest('.menu-btn');
    if (!btn) return;
    const kind = btn.dataset.menu;
    const rect = btn.getBoundingClientRect();
    openMenu(ui, btn, menuItemsFor(ui, kind), rect.left, rect.bottom + 6);
  });
}

/**
 * @brief 构造某个主菜单的菜单项。
 * @param {object} ui 界面上下文。
 * @param {string} kind 菜单 id。
 * @retval {Array<object>} 菜单项数组。
 */
function menuItemsFor(ui, kind) {
  const app = ui.app;
  const sep = { separator: true };
  if (kind === 'file') {
    return [
      { icon: 'new', label: '新建工程', key: 'Ctrl+N', onClick: () => confirmNew(ui) },
      { icon: 'primitives', label: '载入示例模型', onClick: () => app.loadDemo() },
      { icon: 'open', label: '打开工程…', key: 'Ctrl+O', onClick: () => pickFile(ui, '.json,.cubo') },
      { icon: 'save', label: '保存工程', key: 'Ctrl+S', onClick: () => app.saveProject() },
      sep,
      { icon: 'import', label: '导入 STL…', onClick: () => pickFile(ui, '.stl') },
      { icon: 'export', label: '导出 STL…', onClick: () => openExportDialog(ui) },
      { icon: 'export', label: '导出 OBJ', onClick: () => app.exportOBJ() },
    ];
  }
  if (kind === 'edit') {
    return [
      { icon: 'undo', label: '撤销', key: 'Ctrl+Z', disabled: app.undoStack.length === 0, onClick: () => app.undo() },
      { icon: 'redo', label: '重做', key: 'Ctrl+Y', disabled: app.redoStack.length === 0, onClick: () => app.redo() },
      sep,
      { icon: 'duplicate', label: '复制实体', key: 'Ctrl+D', disabled: app.selection.size === 0, onClick: () => app.duplicateSelected() },
      { icon: 'mirror', label: '镜像副本…', disabled: app.selection.size === 0, onClick: () => openMirrorDialog(ui) },
      { icon: 'array', label: '线性阵列…', disabled: app.selection.size === 0, onClick: () => openArrayDialog(ui) },
      { icon: 'trash', label: '删除实体', key: 'Delete', disabled: app.selection.size === 0, onClick: () => app.deleteSelected() },
      sep,
      { icon: 'select', label: '全选', key: 'Ctrl+A', onClick: () => app.selectAll() },
      { icon: 'close', label: '取消选择', key: 'Esc', disabled: app.selection.size === 0, onClick: () => app.setSelection([]) },
    ];
  }
  if (kind === 'view') {
    return [
      { icon: 'box', label: '等轴测视图', onClick: () => app.viewport.setViewPreset('iso') },
      { icon: 'grid', label: '顶视图', onClick: () => app.viewport.setViewPreset('top') },
      { icon: 'rect', label: '前视图', onClick: () => app.viewport.setViewPreset('front') },
      { icon: 'rect', label: '右视图', onClick: () => app.viewport.setViewPreset('right') },
      { icon: 'fit', label: '适配窗口', key: 'F', onClick: () => app.viewport.fit(app.solids) },
      sep,
      {
        icon: 'box',
        label: app.settings.projection === 'persp' ? '切换到正交投影' : '切换到透视投影',
        onClick: () => app.updateSettings({ projection: app.settings.projection === 'persp' ? 'ortho' : 'persp' }),
      },
      { icon: 'grid', label: app.settings.gridVisible ? '隐藏网格' : '显示网格', onClick: () => app.updateSettings({ gridVisible: !app.settings.gridVisible }) },
      {
        icon: 'box',
        label: app.settings.xray ? '关闭 X 光透视' : '开启 X 光透视',
        onClick: () => app.updateSettings({ xray: !app.settings.xray }),
      },
      { icon: 'bed', label: app.settings.shadows ? '关闭阴影' : '打开阴影', onClick: () => app.updateSettings({ shadows: !app.settings.shadows }) },
    ];
  }
  return [
    { icon: 'help', label: '使用手册', onClick: () => openManual(ui) },
    { icon: 'help', label: '快捷键一览', onClick: () => openShortcuts(ui) },
    { icon: 'info', label: '关于 Cubo', onClick: () => openAbout(ui) },
  ];
}

/* ========================================================================== *
 *  浮动菜单
 * ========================================================================== */

/**
 * @brief 打开一个浮动菜单。
 * @param {object} ui 界面上下文。
 * @param {HTMLElement} anchor 触发按钮。
 * @param {Array<object>} items 菜单项。
 * @param {number} x 屏幕 x。
 * @param {number} y 屏幕 y。
 * @retval {void}
 */
function openMenu(ui, anchor, items, x, y) {
  closeMenu(ui);
  const pop = document.createElement('div');
  pop.className = 'menu-pop';
  pop.innerHTML = items
    .map((item) => {
      if (item.separator) return '<div class="menu-sep"></div>';
      return `<button class="menu-item" ${item.disabled ? 'disabled' : ''}>
        <span class="mi-icon">${item.icon ? icon(item.icon, 15) : ''}</span>
        <span class="mi-label">${item.label}</span>
        ${item.key ? `<span class="mi-key">${item.key}</span>` : ''}
      </button>`;
    })
    .join('');

  // 菜单超出窗口时往回收，别让它在屏幕外“消失”。
  const width = 220;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - items.length * 34 - 20);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${Math.max(8, top)}px`;

  pop.addEventListener('click', (e) => {
    const btn = e.target.closest('.menu-item');
    if (!btn || btn.disabled) return;
    const index = [...pop.querySelectorAll('.menu-item')].indexOf(btn);
    const real = items.filter((i) => !i.separator)[index];
    closeMenu(ui);
    real?.onClick?.();
  });

  ui.menuRoot.appendChild(pop);
  ui.menuRoot.style.pointerEvents = 'auto';
  anchor?.classList.add('is-open');

  // Esc 关菜单，符合所有桌面软件的习惯。
  const onKey = (ev) => {
    if (ev.key === 'Escape') closeMenu(ui);
  };
  window.addEventListener('keydown', onKey, true);
  ui._menuKeyCleanup = () => window.removeEventListener('keydown', onKey, true);

  // 点空白处关闭
  setTimeout(() => {
    const onDown = (ev) => {
      if (!pop.contains(ev.target)) {
        closeMenu(ui);
        window.removeEventListener('pointerdown', onDown, true);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    ui._menuCleanup = () => window.removeEventListener('pointerdown', onDown, true);
  }, 0);
}

/** @brief 关闭浮动菜单。 */
function closeMenu(ui) {
  ui.menuRoot.innerHTML = '';
  ui.menuRoot.style.pointerEvents = 'none';
  ui._menuCleanup?.();
  ui._menuCleanup = null;
  ui._menuKeyCleanup?.();
  ui._menuKeyCleanup = null;
  document.querySelectorAll('.menu-btn.is-open').forEach((b) => b.classList.remove('is-open'));
}

/* ========================================================================== *
 *  属性面板
 * ========================================================================== */

/** @brief 渲染整个属性面板。 */
function renderInspector(ui) {
  const app = ui.app;
  const picked = app.getSelectedSolids();
  const report = app.getPrintReport();
  let html = '';

  if (picked.length === 0) {
    html += `<div class="insp-head"><h3>场景</h3><span class="insp-badge">${app.solids.length} 个实体</span></div>`;
    html += statSection(report, app, false);
    html += settingsSection(app);
    html += `<div class="insp-empty">
      ${icon('select', 28)}
      <div>点一个实体查看属性<br />用左侧工具开始建模</div>
    </div>`;
  } else if (picked.length === 1) {
    const solid = picked[0];
    const st = solid.stats();
    html += `<div class="insp-head"><h3>属性</h3><span class="insp-badge is-solid">${solid.kind}</span></div>`;

    html += `<div class="insp-section">
      <h4>对象</h4>
      <input class="name-input" data-act="rename" value="${escapeAttr(solid.name)}" />
      <div style="height:10px"></div>
      <div class="swatches">
        ${COLOR_SWATCHES.map(
          (c) => `<button class="swatch ${c === solid.color ? 'is-active' : ''}" data-act="color" data-color="${c}" style="background:${c}" title="${c}"></button>`,
        ).join('')}
      </div>
    </div>`;

    html += transformSection(solid);
    html += sizeSection(solid, st);
    html += statSection(report, app, true);
    html += actionSection(app, true);
    html += settingsSection(app);
  } else {
    html += `<div class="insp-head"><h3>多选</h3><span class="insp-badge is-solid">${picked.length} 个实体</span></div>`;
    html += `<div class="insp-section">
      <h4>布尔运算</h4>
      <div class="action-row">
        <button class="mini-btn" data-act="boolean" data-op="union">${icon('union', 15)} 并集</button>
        <button class="mini-btn" data-act="boolean" data-op="subtract">${icon('subtract', 15)} 差集</button>
        <button class="mini-btn" data-act="boolean" data-op="intersect">${icon('intersect', 15)} 交集</button>
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--text-faint);line-height:1.6">
        差集会用「最先选中的实体」减去其余实体。
      </div>
    </div>`;
    html += statSection(report, app, true);
    html += actionSection(app, false);
    html += settingsSection(app);
  }

  ui.inspector.innerHTML = html;
  updateRailState(ui);
}

/** @brief 变换输入区。 */
function transformSection(solid) {
  const rows = [
    { label: '位置', key: 'position', unit: 'mm', step: 1 },
    { label: '旋转', key: 'rotation', unit: '°', step: 1 },
    { label: '缩放', key: 'scale', unit: '', step: 0.1 },
  ];
  return `<div class="insp-section">
    <h4>变换</h4>
    ${rows
      .map(
        (row) => `<div class="field-row">
          <label>${row.label}</label>
          <div class="field-grid">
            ${['X', 'Y', 'Z']
              .map((axis, i) => {
                const value = solid.transform[row.key][i];
                return `<div class="num-field">
                  <span class="unit">${axis}</span>
                  <input type="number" step="${row.step}" data-transform="${row.key}" data-axis="${i}" value="${fmt(value, row.key === 'scale' ? 3 : 1)}" />
                </div>`;
              })
              .join('')}
          </div>
        </div>`,
      )
      .join('')}
  </div>`;
}

/** @brief 尺寸输入区（改的是缩放，保留参数化手感）。 */
function sizeSection(solid, st) {
  const size = st ? st.size : [0, 0, 0];
  return `<div class="insp-section">
    <h4>外形尺寸 <span class="hint">修改后按比例缩放</span></h4>
    <div class="field-grid">
      ${['宽', '深', '高']
        .map(
          (label, i) => `<div class="num-field">
            <span class="unit">${label}</span>
            <input type="number" step="1" min="0.1" data-size="${'xyz'[i]}" value="${fmt(size[i], 1)}" />
          </div>`,
        )
        .join('')}
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--text-faint)">
      旋转后这里的尺寸是世界坐标包围盒。
    </div>
  </div>`;
}

/** @brief 打印体检区。 */
function statSection(report, app, withActions) {
  if (!report) {
    return `<div class="insp-section"><h4>打印检查</h4><div class="insp-empty" style="padding:14px 0">还没有实体可以检查</div></div>`;
  }
  const watertight = report.watertight;
  const overhangPct = (report.overhangRatio * 100).toFixed(1);
  const overhangLevel = report.overhangRatio > 0.12 ? 'is-bad' : report.overhangRatio > 0.02 ? 'is-warn' : '';
  const sizeText = report.size.map((n) => n.toFixed(1)).join(' × ');
  return `<div class="insp-section">
    <h4>打印检查 <span class="hint">${report.material}</span></h4>
    <div class="check-line"><span class="check-dot ${watertight ? '' : 'is-bad'}"></span>${watertight ? '网格封闭，可直接切片' : '网格不封闭，可能无法打印'}</div>
    <div class="check-line"><span class="check-dot ${overhangLevel}"></span>悬垂面积 ${overhangPct}%${report.overhangRatio > 0.02 ? '（建议加支撑）' : ''}</div>
    <div class="stats-grid" style="margin-top:8px">
      <div class="stat"><div class="k">体积</div><div class="v">${fmt(report.volume / 1000, 2)} <small>cm³</small></div></div>
      <div class="stat"><div class="k">估算重量</div><div class="v">${fmt(report.weight, 1)} <small>g</small></div></div>
      <div class="stat"><div class="k">表面积</div><div class="v">${fmt(report.area / 100, 2)} <small>cm²</small></div></div>
      <div class="stat"><div class="k">三角面</div><div class="v">${formatNumber(report.triangles)}</div></div>
      <div class="stat is-wide"><div class="k">外形尺寸（毫米）</div><div class="v" style="font-size:12px">${sizeText}</div></div>
    </div>
    ${
      withActions
        ? `<div class="action-row">
            <button class="mini-btn" data-act="drop">${icon('drop', 14)} 贴床</button>
            <button class="mini-btn" data-act="center">${icon('center', 14)} 居中</button>
            <button class="mini-btn" data-act="orient">${icon('box', 14)} 智能摆正</button>
          </div>`
        : ''
    }
  </div>`;
}

/** @brief 操作按钮区。 */
function actionSection(app, single) {
  return `<div class="insp-section">
    <h4>操作</h4>
    <div class="action-row">
      <button class="mini-btn" data-act="duplicate">${icon('duplicate', 14)} 复制</button>
      <button class="mini-btn" data-act="delete">${icon('trash', 14)} 删除</button>
    </div>
    <div class="action-row">
      <button class="mini-btn" data-act="mirror">${icon('mirror', 14)} 镜像</button>
      <button class="mini-btn" data-act="array">${icon('array', 14)} 阵列</button>
    </div>
  </div>`;
}

/** @brief 场景与网格设置。 */
function settingsSection(app) {
  const s = app.settings;
  const sw = (on) => `class="switch ${on ? 'is-on' : ''}"`;
  return `<div class="insp-section">
    <h4>视图与网格</h4>
    <div class="toggle-row">显示网格<button ${sw(s.gridVisible)} data-toggle="gridVisible" aria-label="网格"></button></div>
    <div class="toggle-row">网格吸附<button ${sw(s.snap)} data-toggle="snap" aria-label="吸附"></button></div>
    <div class="toggle-row">投影阴影<button ${sw(s.shadows)} data-toggle="shadows" aria-label="阴影"></button></div>
    <div class="toggle-row">X 光透视<button ${sw(s.xray)} data-toggle="xray" aria-label="X 光透视"></button></div>
    <div class="field-row" style="margin-top:6px">
      <label>网格</label>
      <select class="select-field" data-setting="gridSize">
        ${[1, 2, 5, 10, 20].map((v) => `<option value="${v}" ${s.gridSize === v ? 'selected' : ''}>${v} mm</option>`).join('')}
      </select>
    </div>
    <div class="field-row">
      <label>多边形</label>
      <select class="select-field" data-setting="polygonSides">
        ${[3, 4, 5, 6, 8, 10, 12].map((v) => `<option value="${v}" ${s.polygonSides === v ? 'selected' : ''}>${v} 边</option>`).join('')}
      </select>
    </div>
    <div class="field-row">
      <label>耗材</label>
      <select class="select-field" data-setting="material">
        ${Object.entries(MATERIALS).map(([key, m]) => `<option value="${key}" ${s.material === key ? 'selected' : ''}>${m.label}（${m.density} g/cm³）</option>`).join('')}
      </select>
    </div>
  </div>`;
}

/** @brief 绑定属性面板的交互（事件委托，面板重绘也不用重新绑定）。 */
function bindInspector(ui) {
  const app = ui.app;

  ui.inspector.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'color') {
      app.setSelectionColor(btn.dataset.color);
    } else if (act === 'boolean') {
      app.applyBoolean(btn.dataset.op);
    } else if (act === 'delete') {
      app.deleteSelected();
    } else if (act === 'duplicate') {
      app.duplicateSelected();
    } else if (act === 'mirror') {
      openMirrorDialog(ui);
    } else if (act === 'array') {
      openArrayDialog(ui);
    } else if (act === 'drop') {
      app.dropToBed();
    } else if (act === 'center') {
      app.centerOnBed();
    } else if (act === 'orient') {
      app.autoOrient();
    }
  });

  // 改名：失焦或回车时生效
  ui.inspector.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-act="rename"]')) {
      const solid = app.getSelectedSolids()[0];
      if (solid) app.renameSolid(solid.id, el.value);
      return;
    }

    if (el.matches('[data-transform]')) {
      const solid = app.getSelectedSolids()[0];
      if (!solid) return;
      const key = el.dataset.transform;
      const axis = Number(el.dataset.axis);
      const next = [...solid.transform[key]];
      const value = Number(el.value);
      if (!Number.isFinite(value)) return;
      next[axis] = key === 'scale' ? Math.max(0.001, value) : value;
      app.pushUndo('修改变换');
      solid.setTransform({ [key]: next });
      app._markDirty();
      app.notify();
      return;
    }

    if (el.matches('[data-size]')) {
      app.scaleSelectionTo(el.dataset.size, Number(el.value));
      return;
    }

    if (el.matches('[data-setting]')) {
      const key = el.dataset.setting;
      const value = el.tagName === 'SELECT' && !Number.isNaN(Number(el.value)) && key !== 'material'
        ? Number(el.value)
        : el.value;
      app.updateSettings({ [key]: value });
      renderInspector(ui);
    }
  });

  ui.inspector.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('[data-setting="gridSize"], [data-setting="polygonSides"], [data-setting="material"]')) {
      // select 用 change 就够了，这里不重复处理
    }
  });

  ui.inspector.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (!toggle) return;
    const key = toggle.dataset.toggle;
    app.updateSettings({ [key]: !app.settings[key] });
    renderInspector(ui);
  });
}

/* ========================================================================== *
 *  视口里的控件
 * ========================================================================== */

/** @brief 投影切换、视图预设、适配按钮。 */
function bindViewportControls(ui) {
  const app = ui.app;
  document.getElementById('projection-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-proj]');
    if (!btn) return;
    const mode = btn.dataset.proj;
    app.updateSettings({ projection: mode });
    document.querySelectorAll('#projection-toggle button').forEach((b) => b.classList.toggle('is-active', b === btn));
  });

  document.getElementById('view-presets').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    app.viewport.setViewPreset(btn.dataset.view);
  });

  document.getElementById('btn-fit').addEventListener('click', () => {
    app.viewport.fit(app.solids);
  });

  document.getElementById('empty-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-quick]');
    if (!btn) return;
    if (btn.dataset.quick === 'import') {
      pickFile(ui, '.stl');
      return;
    }
    if (btn.dataset.quick === 'demo') {
      app.loadDemo();
      return;
    }
    app.addPrimitive(btn.dataset.quick);
  });
}

/** @brief 草图状态条的「完成 / 取消 / 切穿」。 */
function bindSketchBanner(ui) {
  document.getElementById('sketch-finish').addEventListener('click', () => ui.app.tools.finish());
  document.getElementById('sketch-cancel').addEventListener('click', () => ui.app.tools.cancel());
  ui.sketchThrough.addEventListener('click', () => ui.app.tools.cutThrough());
}

/* ========================================================================== *
 *  尺寸输入框
 * ========================================================================== */

/** @brief 绑定尺寸输入框。 */
function bindDimension(ui) {
  const commit = () => {
    const dim = ui.app.dimension;
    if (!dim) return;
    const value = Number(ui.dimField.value);
    ui.app.hideDimension();
    if (Number.isFinite(value) && value !== 0) dim.onCommit?.(value);
    else dim.onCancel?.();
    ui.app.viewport.renderer.domElement.focus?.();
  };
  const cancel = () => {
    const dim = ui.app.dimension;
    ui.app.hideDimension();
    dim?.onCancel?.();
  };

  ui.dimField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
    e.stopPropagation();
  });
  ui.dimField.addEventListener('blur', () => {
    // 点到别处视为取消，避免输入框一直挂着挡住视线。
    if (ui.app.dimension) cancel();
  });
}

/* ========================================================================== *
 *  App 事件
 * ========================================================================== */

/** @brief 订阅 App 事件，刷新各块界面。 */
function bindEvents(ui) {
  const app = ui.app;

  app.on('change', () => {
    // gizmo 拖动中不做整块重绘：一帧一次 innerHTML 重建会让拖动发涩，
    // 数值等松手后再统一刷新。
    if (app.gizmoDragging) {
      updateStatusRight(ui);
      return;
    }
    // 正在输入时不要重绘属性面板，否则焦点会丢，输一半的数字全没了。
    const active = document.activeElement;
    const editing = active && ui.inspector.contains(active) && active.matches('input, select');
    if (!editing) renderInspector(ui);
    updateRailState(ui);
    updateHistoryButtons(ui);
    updateEmptyState(ui);
    updateSketchBanner(ui);
    updateDoc(ui);
    updateStatusRight(ui);
  });

  app.on('selection', () => {
    renderInspector(ui);
    updateRailState(ui);
  });

  app.on('tool', () => {
    updateRailState(ui);
    const active = document.querySelector(`.tool-btn[data-tool="${app.tool}"]`);
    if (active) active.classList.add('is-active');
  });

  app.on('status', (payload) => updateStatus(ui, payload));
  app.on('hint', (text) => {
    ui.statusHint.textContent = text || '';
  });
  app.on('cursor', (point) => {
    ui.statusCoords.textContent = `X ${point.x.toFixed(1)} · Y ${point.y.toFixed(1)} · Z ${point.z.toFixed(1)}`;
  });
  app.on('toast', ({ message, type }) => showToast(ui, message, type));
  app.on('sketch', () => updateSketchBanner(ui));
  app.on('dimension', (dim) => {
    if (!dim) {
      ui.dim.hidden = true;
      return;
    }
    ui.dim.hidden = false;
    ui.dimLabel.textContent = dim.label;
    // initial 是用户按下的第一个数字，直接放进输入框并选中，接着敲的数字会接在后面。
    ui.dimField.value = dim.initial != null ? String(dim.initial) : fmt(dim.value, 1);
    const maxX = ui.dim.parentElement.clientWidth - 180;
    const maxY = ui.dim.parentElement.clientHeight - 60;
    ui.dim.style.left = `${Math.max(8, Math.min(dim.anchor.x, maxX))}px`;
    ui.dim.style.top = `${Math.max(8, Math.min(dim.anchor.y, maxY))}px`;
    ui.dimField.focus();
    if (dim.initial != null) {
      // 光标放到末尾，用户接着敲的数字会继续追加（比如先按 2 再按 5 → 25）。
      const len = ui.dimField.value.length;
      ui.dimField.setSelectionRange(len, len);
    } else {
      ui.dimField.select();
    }
  });
  app.on('doc', () => updateDoc(ui));
  app.on('request-new', () => confirmNew(ui));
  app.on('settings', () => {
    updateStatusRight(ui);
    document.querySelectorAll('#projection-toggle button').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.proj === app.settings.projection);
    });
  });
  app.on('history', () => updateHistoryButtons(ui));
  app.on('hover', () => {});
  app.on('ready', () => {
    updateEmptyState(ui);
    updateStatus(ui, { message: '就绪', level: 'ok' });
  });
}

/* ========================================================================== *
 *  状态刷新
 * ========================================================================== */

/** @brief 状态栏左侧。 */
function updateStatus(ui, { message, level = 'ok' }) {
  ui.statusMsg.textContent = message;
  ui.statusLight.classList.toggle('is-busy', level === 'busy');
  ui.statusLight.style.background = level === 'error' ? 'var(--danger)' : '';
}

/** @brief 状态栏右侧：吸附状态。 */
function updateStatusRight(ui) {
  ui.statusSnap.textContent = `吸附 ${ui.app.settings.snap ? '开' : '关'} · 网格 ${ui.app.settings.gridSize} mm`;
}

/** @brief 撤销/重做按钮可用态。 */
function updateHistoryButtons(ui) {
  ui.undoBtn.disabled = ui.app.undoStack.length === 0;
  ui.redoBtn.disabled = ui.app.redoStack.length === 0;
}

/** @brief 文档名与保存状态。 */
function updateDoc(ui) {
  if (document.activeElement !== ui.docName) ui.docName.value = ui.app.docName;
  ui.saveState.textContent = ui.app.dirty ? '未保存' : '已保存';
}

/** @brief 空场景引导的显隐。 */
function updateEmptyState(ui) {
  // 选了绘制工具就赶紧把引导卡片收起来：它正好挡在视口中央，
  // 不收起来的话第一次下笔会点到卡片上的按钮（真的会点到「球体」上）。
  const show = ui.app.solids.length === 0 && !ui.app.sketch && ui.app.tool === 'select';
  ui.emptyState.classList.toggle('is-hidden', !show);
}

/** @brief 草图状态条。 */
function updateSketchBanner(ui) {
  const sketch = ui.app.sketch;
  ui.sketchBanner.hidden = !sketch;
  if (!sketch) return;
  const names = { ground: '地面', front: '前视', right: '右视', face: '实体表面' };
  const isGround =
    Math.abs(sketch.plane.normal[0]) < 1e-6 &&
    Math.abs(sketch.plane.normal[1]) < 1e-6 &&
    Math.abs(sketch.plane.normal[2] - 1) < 1e-6;
  // 前视平面的法线指向 -Y，旋转体就画在这个平面上，标清楚更好懂。
  const isFront =
    Math.abs(sketch.plane.normal[0]) < 1e-6 &&
    Math.abs(sketch.plane.normal[1] + 1) < 1e-6 &&
    Math.abs(sketch.plane.normal[2]) < 1e-6;
  const label = sketch.hostId ? '实体表面' : isGround ? '地面（XY）' : isFront ? '前视平面（XZ）' : '自定义平面';
  ui.sketchPlaneLabel.textContent = `草图 · ${label}`;
  const count = sketch.points?.length || 0;
  const preview = ui.app.preview;
  const inward = preview?.hostDepth?.inward || 0;
  // 切除时把「当前深度 / 实体厚度」直接写出来，用户一眼就知道还差多少才切穿。
  ui.sketchThrough.hidden = !(preview && inward > 0 && preview.height < 0);
  if (preview) {
    if (inward > 0 && preview.height < 0) {
      const depth = Math.min(Math.abs(preview.height), inward);
      ui.sketchOpLabel.textContent = `切除 ${depth.toFixed(1)} / ${inward.toFixed(1)} mm${
        preview.through ? ' · 已切穿' : ' · 再往下拖，或点“切穿”'
      }`;
    } else {
      ui.sketchOpLabel.textContent = `高度 ${Number(preview.height || 0).toFixed(1)} mm · 点击确认，数字键精确输入`;
    }
  } else if (ui.app.tool === 'revolve') {
    ui.sketchOpLabel.textContent = '画截面，闭合后自动旋转成体';
  } else if (count === 0) {
    ui.sketchOpLabel.textContent = '点击放置第一个点';
  } else if (count < 3) {
    ui.sketchOpLabel.textContent = `已放置 ${count} 个点`;
  } else {
    ui.sketchOpLabel.textContent = `已放置 ${count} 个点，点回起点或按 Enter 闭合`;
  }
}

/* ========================================================================== *
 *  Toast
 * ========================================================================== */

/** @brief 弹一条提示。 */
function showToast(ui, message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'is-error' : type === 'warn' ? 'is-warn' : ''}`;
  el.innerHTML = `<span class="t-dot"></span><span>${escapeHtml(message)}</span>`;
  ui.toasts.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

/* ========================================================================== *
 *  对话框
 * ========================================================================== */

/**
 * @brief 打开一个模态框。
 * @param {object} ui 界面上下文。
 * @param {object} opts 配置：title、body(html)、footer(html)、onMount。
 * @retval {{close:Function}}
 */
function openModal(ui, { title, body, footer, onMount }) {
  ui.modalRoot.classList.add('is-open');
  ui.modalRoot.innerHTML = `<div class="modal-backdrop"></div>
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">${title}<button class="modal-close" aria-label="关闭">${icon('close', 16)}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;

  const close = () => {
    ui.modalRoot.classList.remove('is-open');
    ui.modalRoot.innerHTML = '';
  };
  ui.modalRoot.querySelector('.modal-backdrop').addEventListener('click', close);
  ui.modalRoot.querySelector('.modal-close').addEventListener('click', close);
  onMount?.(ui.modalRoot, close);
  return { close };
}

/** @brief 应用内使用手册（给不想翻 README 的人）。 */
function openManual(ui) {
  openModal(ui, {
    title: '使用手册 · 五分钟上手',
    body: `<div class="manual">
      <h3>1. 画轮廓</h3>
      <p>左侧选 <b>矩形 R</b> 或 <b>圆 C</b>，在地面上点两个点。轮廓一闭合，就会自动进入推拉预览。</p>

      <h3>2. 推拉成体</h3>
      <p>上下移动鼠标设置高度，<b>点击确认</b>；直接敲数字再回车可以精确输入（例如敲 <code>25</code>）。</p>
      <p>如果把轮廓画在实体表面上：<b>往外拉 = 合并</b>，<b>往里推 = 挖孔</b>。推拉预览是半透明的，就算在实体内部也看得见。</p>

      <h3>3. 把孔挖穿</h3>
      <p>挖孔时状态条会显示 <b>切除 12.0 / 30.0 mm</b>。拖到接近实体厚度会自动吸附成贯穿孔；也可以按 <code>T</code> 或点状态条上的「切穿」按钮一步到位。</p>

      <h3>4. 布尔与图元</h3>
      <p>选中两个以上实体（Shift 点选或 Ctrl+A），点左侧的并集 / 差集 / 交集，或右侧属性面板的按钮。差集是「最先选中的实体」减去其余实体。</p>
      <p>图元按钮里有立方体、圆柱、球、圆锥、圆环、圆管、六棱柱，放下去以后可以在右侧改尺寸和位置。</p>

      <h3>5. 镜像与阵列</h3>
      <p>选中实体后，右侧「操作」里可以生成镜像副本，或沿 X/Y/Z 做线性阵列（可合并成一个实体）。</p>

      <h3>6. 检查与导出</h3>
      <p>右侧「打印检查」会显示封闭性、体积、重量、悬垂比例。点「贴床 / 居中 / 智能摆正」摆好位置，再点右上角「导出 STL」。</p>
      <p>看内部结构时，可以打开右侧的「X 光透视」，所有实体变半透明。</p>

      <h3>常用快捷键</h3>
      <ul>
        <li><code>Q</code> 选择 · <code>L</code> 直线 · <code>R</code> 矩形 · <code>C</code> 圆 · <code>G</code> 多边形 · <code>A</code> 圆弧</li>
        <li><code>P</code> 推拉 · <code>O</code> 旋转体 · <code>1/2/3</code> 移动/旋转/缩放 · <code>M</code> 测量 · <code>F</code> 适配</li>
        <li><code>Ctrl+Z / Ctrl+Y</code> 撤销 / 重做，<code>Ctrl+S</code> 保存工程，<code>Delete</code> 删除</li>
        <li>拉伸时按 <code>T</code> 切穿；<code>Esc</code> 取消当前操作；<code>Enter</code> 闭合轮廓 / 确认</li>
      </ul>

      <h3>卡住了？</h3>
      <ul>
        <li>点下去没反应：可能还在上一个草图里，按 <code>Esc</code> 退出再试。</li>
        <li>看不到模型：按 <code>F</code> 适配窗口。</li>
        <li>工具按钮上的字太小：鼠标悬停会弹出完整说明。</li>
        <li>STL 导入失败：文件不是封闭实体，可以换个切片软件重新导出。</li>
      </ul>
    </div>`,
    footer: `<button class="btn primary" data-close>开始建模</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-close]').addEventListener('click', close);
    },
  });
}

/** @brief 快捷键说明。 */
function openShortcuts(ui) {  const rows = [
    ['选择', 'Q'],
    ['直线 / 矩形 / 圆', 'L / R / C'],
    ['多边形 / 圆弧', 'G / A'],
    ['推拉（拉伸）', 'P'],
    ['旋转体', 'O'],
    ['移动 / 旋转 / 缩放', '1 / 2 / 3'],
    ['测量距离', 'M'],
    ['适配窗口', 'F'],
    ['撤销 / 重做', 'Ctrl+Z / Ctrl+Y'],
    ['复制 / 删除', 'Ctrl+D / Delete'],
    ['保存工程 / 打开工程', 'Ctrl+S / Ctrl+O'],
    ['结束当前操作', 'Esc'],
    ['确认拉伸 / 闭合轮廓', 'Enter'],
    ['切除时一键贯穿', 'T'],
    ['精确输入尺寸', '直接敲数字'],
    ['镜像 / 线性阵列', '编辑菜单'],
    ['Alt + 点击确认拉伸', '生成独立实体'],
  ];
  openModal(ui, {
    title: '快捷键一览',
    body: `<table class="shortcut-table">${rows
      .map(([k, v]) => `<tr><td>${k}</td><td><kbd>${v}</kbd></td></tr>`)
      .join('')}</table>`,
    footer: `<button class="btn primary" data-close>知道了</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-close]').addEventListener('click', close);
    },
  });
}

/** @brief 关于。 */
function openAbout(ui) {
  openModal(ui, {
    title: '关于 Cubo 立方工坊',
    body: `<p>Cubo 是一个跑在浏览器里的实体建模工具，面向 3D 打印：画草图、推拉成体、布尔运算，最后导出水密 STL。</p>
      <p><b>几何内核：</b>Manifold（WASM，流形实体）<br />
      <b>渲染：</b>Three.js<br />
      <b>单位：</b>毫米（mm）<br />
      <b>版本：</b>0.1.0</p>
      <p style="color:var(--text-faint)">所有计算都在本地完成，模型不会被上传到任何服务器。</p>`,
    footer: `<button class="btn primary" data-close>关闭</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-close]').addEventListener('click', close);
    },
  });
}

/** @brief 导出选项对话框。 */
function openExportDialog(ui) {
  const app = ui.app;
  if (app.solids.length === 0) {
    app.toast('场景里还没有实体', 'warn');
    return;
  }
  openModal(ui, {
    title: '导出 STL',
    body: `<p>STL 会按当前世界坐标直接写出，单位是毫米。</p>
      <label class="field-label">导出范围</label>
      <select class="select-field" id="export-scope">
        <option value="all">全部实体（${app.solids.length} 个）</option>
        <option value="selected" ${app.selection.size ? '' : 'disabled'}>仅选中（${app.selection.size} 个）</option>
      </select>
      <label class="field-label">格式</label>
      <select class="select-field" id="export-format">
        <option value="binary">二进制 STL（体积小，推荐）</option>
        <option value="ascii">ASCII STL（文本，方便检查）</option>
      </select>`,
    footer: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>导出</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-cancel]').addEventListener('click', close);
      root.querySelector('[data-ok]').addEventListener('click', () => {
        const selectedOnly = root.querySelector('#export-scope').value === 'selected';
        const binary = root.querySelector('#export-format').value === 'binary';
        close();
        app.exportSTL({ selectedOnly, binary });
      });
    },
  });
}

/** @brief 镜像副本对话框。 */
function openMirrorDialog(ui) {
  const app = ui.app;
  if (app.selection.size === 0) {
    app.toast('先选中要镜像的实体', 'warn');
    return;
  }
  openModal(ui, {
    title: '镜像副本',
    body: `<p>以垂直于所选轴的平面为镜面，生成一份镜像副本（原件保留）。</p>
      <label class="field-label">镜面轴向</label>
      <select class="select-field" id="mirror-axis">
        <option value="x">X 轴（左右镜像）</option>
        <option value="y">Y 轴（前后镜像）</option>
        <option value="z">Z 轴（上下镜像）</option>
      </select>
      <label class="field-label">镜面位置（mm）</label>
      <input class="text-field" id="mirror-offset" type="number" value="0" step="1" />
      <p style="margin-top:10px;color:var(--text-faint);font-size:11.5px">
        位置 0 表示以世界原点所在的平面为镜面；填 20 就是关于「坐标 = 20」的平面镜像。
      </p>`,
    footer: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>生成镜像</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-cancel]').addEventListener('click', close);
      root.querySelector('[data-ok]').addEventListener('click', () => {
        const axis = root.querySelector('#mirror-axis').value;
        const offset = Number(root.querySelector('#mirror-offset').value) || 0;
        close();
        app.mirrorSelected({ axis, offset });
      });
    },
  });
}

/** @brief 线性阵列对话框。 */
function openArrayDialog(ui) {
  const app = ui.app;
  if (app.selection.size === 0) {
    app.toast('先选中要阵列的实体', 'warn');
    return;
  }
  openModal(ui, {
    title: '线性阵列',
    body: `<p>把选中的实体沿一个方向等距复制。总数量包含原件。</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label class="field-label">方向</label>
          <select class="select-field" id="array-axis">
            <option value="x">X 轴</option>
            <option value="y">Y 轴</option>
            <option value="z">Z 轴</option>
          </select>
        </div>
        <div>
          <label class="field-label">总数量</label>
          <input class="text-field" id="array-count" type="number" value="3" min="2" max="50" step="1" />
        </div>
      </div>
      <label class="field-label">间距（mm）</label>
      <input class="text-field" id="array-spacing" type="number" value="50" step="1" />
      <label class="check-line" style="margin-top:12px;cursor:pointer">
        <input type="checkbox" id="array-merge" />
        <span>合并成一个实体（布尔并集）</span>
      </label>`,
    footer: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>生成阵列</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-cancel]').addEventListener('click', close);
      root.querySelector('[data-ok]').addEventListener('click', () => {
        const axis = root.querySelector('#array-axis').value;
        const count = Number(root.querySelector('#array-count').value) || 3;
        const spacing = Number(root.querySelector('#array-spacing').value) || 50;
        const merge = root.querySelector('#array-merge').checked;
        close();
        app.linearArraySelected({ axis, count, spacing, merge });
      });
    },
  });
}

/** @brief 新建工程前的确认。 */
function confirmNew(ui) {
  const app = ui.app;
  if (app.solids.length === 0) {
    app.newProject();
    return;
  }
  openModal(ui, {
    title: '新建工程',
    body: '<p>当前场景里的模型会被清空，确定要新建吗？</p><p style="color:var(--text-faint)">如果还没保存，建议先「文件 → 保存工程」。</p>',
    footer: `<button class="btn" data-cancel>取消</button><button class="btn danger" data-ok>新建</button>`,
    onMount: (root, close) => {
      root.querySelector('[data-cancel]').addEventListener('click', close);
      root.querySelector('[data-ok]').addEventListener('click', () => {
        close();
        app.newProject();
      });
    },
  });
}

/* ========================================================================== *
 *  文件选择
 * ========================================================================== */

/** @brief 触发文件选择。 */
function pickFile(ui, accept) {
  const input = document.getElementById('file-input');
  input.accept = accept;
  input.value = '';
  input.click();
}

/** @brief 处理文件选择结果。 */
function bindFileInput(ui) {
  const input = document.getElementById('file-input');
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (/\.stl$/i.test(file.name)) {
      await ui.app.importSTL(file);
      return;
    }
    if (/\.json$/i.test(file.name) || /\.cubo$/i.test(file.name)) {
      try {
        const text = await file.text();
        ui.app.loadProject(JSON.parse(text));
      } catch (err) {
        ui.app.toast(`打开失败：${err.message}`, 'error');
      }
      return;
    }
    ui.app.toast('只支持 .stl 和 .cubo.json 文件', 'warn');
  });
}

/* ========================================================================== *
 *  小工具
 * ========================================================================== */

/** @brief HTML 转义，防止实体名里带尖括号把 DOM 拆了。 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @brief 属性值转义。 */
function escapeAttr(str) {
  return escapeHtml(str);
}
