'use strict';

/*
 * Pinned Tab Bar
 * 把 Obsidian 的置顶标签页从顶部标签栏剥离出来，放进一条独立的窄栏里。
 *
 * 设计要点：
 * - 顶部标签栏里被置顶的 header 会被隐藏（可关），普通标签因此获得全部宽度。
 * - 置顶文件在独立栏里显示为「首字徽标」或「文件类型图标」，只占一个方块。
 * - 点击徽标 = 激活对应标签；右键 = 取消置顶 / 分屏 / 新窗口 / 关闭。
 */

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Menu,
  TFile,
  setIcon,
  Notice,
  Platform,
} = require('obsidian');

const DEFAULT_SETTINGS = {
  enabled: true,
  position: 'left-top', // 'left-top' | 'left-bottom' | 'status-bar'
  displayMode: 'letter', // 'letter' | 'icon'
  labelLength: 2,
  iconSize: 18,
  // 逐个置顶标签的位置覆盖：{ "相对路径.md": "sidebar" | "compact" | "top" }
  // 没有记录 = sidebar（默认收进侧栏）
  placementMap: {},
};

// 稳定的色相调色板：按路径 hash 取，同一个文件永远同一个颜色
const HUE_PALETTE = [205, 268, 152, 22, 335, 188, 48, 118, 288, 8, 172, 240];

function stripLucide(id) {
  if (!id) return '';
  return String(id).replace(/^lucide-/, '');
}

function hashString(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// 文件类型兜底图标
const EXT_ICON = {
  md: 'file-text',
  canvas: 'layout-dashboard',
  pdf: 'file-type-2',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  svg: 'image',
  bmp: 'image',
  mp4: 'video',
  mov: 'video',
  mp3: 'audio-lines',
  wav: 'audio-lines',
  json: 'braces',
  excalidraw: 'pencil',
  csv: 'table',
  base: 'table',
};

const TYPE_ICON = {
  markdown: 'file-text',
  canvas: 'layout-dashboard',
  pdf: 'file-type-2',
  image: 'image',
  graph: 'git-fork',
  empty: 'square',
  'excalidraw': 'pencil',
};

class PinnedTabBar extends Plugin {
  async onload() {
    await this.loadSettings();

    this.pinnedItems = [];
    this._refreshTimer = null;
    this._barEl = null;
    this._barSignature = '';
    this._letterCache = new Map();
    this._boundLeaves = new WeakSet();
    this._dblBound = new WeakSet();
    this._disposed = false;
    this._diagDone = false;

    this.addSettingTab(new PinnedTabBarSettingTab(this.app, this));

    this.addCommand({
      id: 'refresh-pinned-bar',
      name: '刷新置顶文件栏',
      callback: () => this.refresh(true),
    });

    this.addCommand({
      id: 'toggle-pinned-bar',
      name: '显示/隐藏置顶文件栏',
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        this.refresh(true);
      },
    });

    this.addCommand({
      id: 'all-to-sidebar',
      name: '全部置顶标签收进侧栏',
      callback: async () => {
        this.settings.placementMap = {};
        await this.saveSettings();
        this.refresh(true);
        new Notice('所有置顶标签已收进侧栏');
      },
    });

    this.addCommand({
      id: 'all-to-top',
      name: '全部置顶标签放回顶部',
      callback: async () => {
        const map = {};
        for (const item of this.collectPinnedItems()) {
          if (item.path) map[item.path] = 'top';
        }
        this.settings.placementMap = map;
        await this.saveSettings();
        this.refresh(true);
        new Notice('所有置顶标签已放回顶部');
      },
    });

    this.addCommand({
      id: 'pin-current-tab',
      name: '把当前标签置顶',
      checkCallback: (checking) => {
        const leaf =
          this.app.workspace.activeLeaf ||
          (this.app.workspace.getMostRecentLeaf &&
            this.app.workspace.getMostRecentLeaf());
        if (!leaf) return false;
        if (!checking) this.pinLeaf(leaf);
        return true;
      },
    });

    this.addCommand({
      id: 'diagnose',
      name: '诊断：导出结构与状态到 _ptb-diag.md',
      callback: () => {
        this.refresh(true);
        this.exportDiagnostics();
      },
    });

    // 布局变化是主信号：切换标签、拖动标签、置顶/取消置顶、新建分屏都在这里
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this.scheduleRefresh())
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.updateActiveState())
    );
    this.registerEvent(
      this.app.workspace.on('file-open', () => this.scheduleRefresh())
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        // 路径是位置记录的键，改名后要跟着搬
        const map = this.settings.placementMap;
        if (map && map[oldPath]) {
          map[file.path] = map[oldPath];
          delete map[oldPath];
          this.saveSettings();
        }
        this.scheduleRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        const map = this.settings.placementMap;
        if (map && map[file.path]) {
          delete map[file.path];
          this.saveSettings();
        }
        this.scheduleRefresh();
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.refresh(true);
      // 首次启用时解释一下「标签去哪了」，避免误以为被关闭
      if (!this.settings.seenIntro) {
        this.settings.seenIntro = true;
        this.saveSettings();
        new Notice(
          '置顶文件栏已启用：原先的置顶标签收进了独立图标栏。\n左键点击徽标跳转，右键徽标可取消置顶。',
          9000
        );
      }
    });
  }

  onunload() {
    this._disposed = true;
    if (this._refreshTimer) {
      window.clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    this.removeBar();
    this.clearHeaderMarks();
    document.body.classList.remove(
      'ptb-on',
      'ptb-hide-original',
      'ptb-compact-pinned'
    );
    document.querySelectorAll('.workspace-tabs.ptb-all-hidden').forEach((el) => {
      el.classList.remove('ptb-all-hidden');
    });
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});

    if (!this.settings.placementMap || typeof this.settings.placementMap !== 'object') {
      this.settings.placementMap = {};
    }

    // 清掉历史版本遗留的全局模式字段（已改为逐个标签控制）
    delete this.settings.placement;
    delete this.settings.hideOriginal;
  }

  // 某个置顶标签当前放在哪：没有记录就是侧栏
  getPlacementOf(path) {
    const v = this.settings.placementMap[path];
    return v === 'compact' || v === 'top' ? v : 'sidebar';
  }

  async setPlacementOf(path, mode) {
    if (!path) return;
    if (mode === 'sidebar') delete this.settings.placementMap[path];
    else this.settings.placementMap[path] = mode;
    await this.saveSettings();
    this.refresh(true);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  scheduleRefresh() {
    if (this._refreshTimer) window.clearTimeout(this._refreshTimer);
    this._refreshTimer = window.setTimeout(() => {
      this._refreshTimer = null;
      this.refresh();
    }, 100);
  }

  // ---------------------------------------------------------------- 采集置顶标签

  isPinnedLeaf(leaf, state) {
    // 官方 ViewState 接口里有 pinned?: boolean，这是主判据
    if (state && state.pinned === true) return true;
    // 部分版本把状态挂在 leaf 上，作为兜底
    if (typeof leaf.pinned === 'boolean' && leaf.pinned) return true;
    return false;
  }

  collectPinnedItems() {
    const items = [];
    const self = this;

    this.app.workspace.iterateAllLeaves((leaf) => {
      let state = null;
      try {
        state = leaf.getViewState();
      } catch (e) {
        state = null;
      }

      if (!self.isPinnedLeaf(leaf, state)) return;

      // leaf 级别的 pinned-change 是最精确的刷新信号，绑定一次即可
      if (!self._boundLeaves.has(leaf)) {
        self._boundLeaves.add(leaf);
        try {
          self.registerEvent(
            leaf.on('pinned-change', () => self.scheduleRefresh())
          );
        } catch (e) {
          /* 老版本没有该事件，忽略 */
        }
      }

      const path = state && state.state && state.state.file ? state.state.file : null;
      let file = null;
      if (path) {
        const af = self.app.vault.getAbstractFileByPath(path);
        if (af instanceof TFile) file = af;
      }

      // getDisplayText / getIcon 是公开 API，比从 state 里猜更可靠
      let title = '';
      try {
        title = leaf.getDisplayText ? leaf.getDisplayText() : '';
      } catch (e) {
        title = '';
      }
      if (!title) title = (file && file.basename) || (state && state.title) || path || '未命名';

      const icon = self.resolveIcon(leaf, state, file);
      const header = self.getHeaderForLeaf(leaf);
      const hueInfo = self.resolveHue(file, path || title);

      items.push({
        leaf,
        header,
        title,
        icon,
        path,
        file,
        label: self.resolveLabel(file, title),
        hue: hueInfo.hue,
        hueFixed: hueInfo.fixed,
        mode: self.getPlacementOf(path),
      });
    });

    // 按顶部标签栏里的实际左右顺序排列，视觉顺序与原来一致
    items.sort((a, b) => {
      if (!a.header || !b.header || a.header === b.header) return 0;
      const pos = a.header.compareDocumentPosition(b.header);
      if (pos & 4) return -1; // DOCUMENT_POSITION_FOLLOWING
      if (pos & 2) return 1; // DOCUMENT_POSITION_PRECEDING
      return 0;
    });

    this.assignHues(items);

    return items;
  }

  resolveIcon(leaf, state, file) {
    // 1) leaf.getIcon() —— 官方接口，能拿到 frontmatter 里自定义的 icon
    try {
      if (typeof leaf.getIcon === 'function') {
        const name = stripLucide(leaf.getIcon());
        if (name) return name;
      }
    } catch (e) {
      /* ignore */
    }
    // 2) viewState.icon
    if (state && state.icon) {
      const name = stripLucide(state.icon);
      if (name) return name;
    }
    // 3) 按视图类型 / 扩展名兜底
    const type = state && state.type;
    if (type && TYPE_ICON[type]) return TYPE_ICON[type];
    if (file) {
      const ext = String(file.extension || '').toLowerCase();
      if (EXT_ICON[ext]) return EXT_ICON[ext];
    }
    return 'file';
  }

  // 徽标文字：frontmatter 的 ptb-label 优先，其次文件名前 N 个字符
  resolveLabel(file, title) {
    if (file) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache && cache.frontmatter;
      if (fm && fm['ptb-label'] != null) {
        return String(fm['ptb-label']).slice(0, 4);
      }
    }
    const n = Math.max(1, Math.min(4, Number(this.settings.labelLength) || 2));
    return String(title || '?').slice(0, n);
  }

  // 返回 { hue, fixed }：fixed=true 表示用户在 frontmatter 里显式指定了 ptb-color
  resolveHue(file, fallback) {
    if (file) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache && cache.frontmatter;
      if (fm && fm['ptb-color'] != null) {
        const n = Number(fm['ptb-color']);
        if (!Number.isNaN(n)) {
          return { hue: ((n % 360) + 360) % 360, fixed: true };
        }
      }
    }
    const key = (file && file.path) || fallback || '';
    return { hue: HUE_PALETTE[hashString(key) % HUE_PALETTE.length], fixed: false };
  }

  /**
   * 保证同一条栏里每个徽标颜色互不相同。
   * 单纯按路径哈希会撞色（实测三个中文文件名有两个落在同一色相），
   * 所以这里做第二轮避让：撞了就顺延到调色板下一个空闲色。
   * frontmatter 里亲手指定 ptb-color 的文件不参与避让。
   */
  assignHues(items) {
    if (items.length <= 1) return;

    const used = new Set();
    for (const it of items) {
      if (it.hueFixed) used.add(it.hue);
    }

    let cursor = 0;
    const total = HUE_PALETTE.length;
    while (cursor < total && used.has(HUE_PALETTE[cursor])) cursor++;

    for (const it of items) {
      if (it.hueFixed) continue;
      if (!used.has(it.hue)) {
        used.add(it.hue);
        continue;
      }
      let guard = 0;
      while (used.has(HUE_PALETTE[cursor % total]) && guard < total) {
        cursor++;
        guard++;
      }
      it.hue = HUE_PALETTE[cursor % total];
      used.add(it.hue);
      cursor++;
    }
  }

  // ---------------------------------------------------------------- DOM 定位

  getTabsElForLeaf(leaf) {
    const leafEl = leaf && leaf.containerEl;
    if (!leafEl || !leafEl.parentElement) return null;
    const tabContainer = leafEl.parentElement; // .workspace-tab-container
    return tabContainer.parentElement || null; // .workspace-tabs
  }

  getHeaderForLeaf(leaf) {
    // 1) 内部结构映射：WorkspaceTabs 上 tabHeaderEls 与 children 同索引。
    //    Obsidian 自己处理 header 点击时用的就是 tabHeaderEls.indexOf(t) -> children[n]，
    //    所以这个映射与真实 DOM 一定一致，比查 DOM 稳。
    const parent = leaf && leaf.parent;
    if (parent && Array.isArray(parent.tabHeaderEls) && Array.isArray(parent.children)) {
      const idx = parent.children.indexOf(leaf);
      if (idx >= 0) {
        const h = parent.tabHeaderEls[idx];
        if (h && h.isConnected) return h;
      }
    }

    // 2) leaf 自身持有的引用
    if (leaf && leaf.tabHeaderEl && leaf.tabHeaderEl.isConnected) {
      return leaf.tabHeaderEl;
    }

    // 3) DOM 兜底
    const leafNode = this.getLeafElement(leaf);
    if (!leafNode) return this.matchHeaderByTitle(leaf);

    const tabsEl = this.findTabsAncestor(leafNode);
    if (!tabsEl) return this.matchHeaderByTitle(leaf);

    const headerContainer = tabsEl.querySelector('.workspace-tab-header-container');
    if (!headerContainer) return this.matchHeaderByTitle(leaf);

    const inner =
      headerContainer.querySelector('.workspace-tab-header-container-inner') ||
      headerContainer;

    // 只取 header 自身，排除 spacer / + 按钮 / 列表按钮
    let headers = Array.from(inner.children).filter(
      (el) => el.classList && el.classList.contains('workspace-tab-header')
    );
    if (headers.length === 0) {
      headers = Array.from(
        headerContainer.querySelectorAll('.workspace-tab-header')
      );
    }

    const tabContainer = tabsEl.querySelector('.workspace-tab-container');
    if (!tabContainer) return this.matchHeaderByTitle(leaf);

    let leaves = Array.from(tabContainer.children).filter(
      (el) => el.classList && el.classList.contains('workspace-leaf')
    );
    if (leaves.length === 0) {
      leaves = Array.from(tabContainer.querySelectorAll('.workspace-leaf'));
    }

    const idx = leaves.indexOf(leafNode);
    if (idx >= 0 && idx < headers.length) {
      const candidate = headers[idx];
      // 索引对得上、标题也对得上，才算确定
      if (this.headerMatchesLeaf(candidate, leaf)) return candidate;
      // 索引错位（置顶标签重排后偶发），先试标题唯一匹配
      const byTitle = this.matchHeaderByTitle(leaf);
      if (byTitle) return byTitle;
      // 标题取不到时仍然信任索引
      return this.getHeaderTitle(candidate) ? null : candidate;
    }

    return this.matchHeaderByTitle(leaf);
  }

  matchHeaderByTitle(leaf) {
    const label = this.getLeafTitle(leaf);
    if (!label) return null;

    const all = Array.from(document.querySelectorAll('.workspace-tab-header'));
    const matched = all.filter((h) => this.getHeaderTitle(h) === label);
    return matched.length === 1 ? matched[0] : null;
  }

  getLeafElement(leaf) {
    const el = leaf && leaf.containerEl;
    if (!el) return null;
    if (el.classList && el.classList.contains('workspace-leaf')) return el;
    if (typeof el.closest === 'function') {
      const found = el.closest('.workspace-leaf');
      if (found) return found;
    }
    return el;
  }

  findTabsAncestor(el) {
    let node = el;
    let depth = 0;
    while (node && depth < 8) {
      if (node.classList && node.classList.contains('workspace-tabs')) return node;
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  getLeafTitle(leaf) {
    try {
      const t = leaf.getDisplayText ? leaf.getDisplayText() : '';
      return t ? String(t).trim() : '';
    } catch (e) {
      return '';
    }
  }

  getHeaderTitle(header) {
    if (!header) return '';
    const titleEl = header.querySelector('.workspace-tab-header-inner-title');
    if (titleEl && titleEl.textContent) return titleEl.textContent.trim();
    const aria = header.getAttribute('aria-label');
    return aria ? aria.trim() : '';
  }

  headerMatchesLeaf(header, leaf) {
    const t = this.getHeaderTitle(header);
    if (!t) return true; // 图标模式下取不到标题，信任索引
    const lt = this.getLeafTitle(leaf);
    if (!lt) return true;
    return t === lt || t.includes(lt) || lt.includes(t);
  }

  // ---------------------------------------------------------------- 诊断

  async exportDiagnostics() {
    const lines = [];
    const push = (s) => lines.push(s);

    push('# Pinned Tab Bar 诊断');
    push('');
    push('生成时间：' + new Date().toLocaleString());
    push('');
    push('## 设置');
    push('```json');
    push(JSON.stringify(this.settings, null, 2));
    push('```');
    push('');
    push('## body.className');
    push('```');
    push(document.body.className);
    push('```');

    // styles.css 是否生效：造一个 .ptb-item 读计算样式
    const probe = document.createElement('div');
    probe.className = 'ptb-item';
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    probe.style.top = '0';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    push('');
    push('## styles.css 生效检测（.ptb-item 计算样式）');
    push('```');
    push('width: ' + cs.width);
    push('height: ' + cs.height);
    push('border-radius: ' + cs.borderRadius);
    push('background-color: ' + cs.backgroundColor);
    push('cursor: ' + cs.cursor);
    push('```');
    push('判断：width 约 30px = CSS 已加载；width 很大或 auto = CSS 没加载');
    probe.remove();

    push('');
    push('## 识别到的置顶标签（共 ' + this.pinnedItems.length + ' 个）');
    this.pinnedItems.forEach((item, i) => {
      push('');
      push('### ' + (i + 1) + '. ' + item.title);
      push('- path: ' + (item.path || '(无)'));
      push('- 独立栏元素: ' + (item.btnEl ? '已渲染' : '未渲染'));

      const header =
        item.header && item.header.isConnected
          ? item.header
          : this.getHeaderForLeaf(item.leaf);

      if (!header) {
        push('- 顶部 header: **未找到**');
      } else {
        push('- 顶部 header: 已找到');
        push('  - className: `' + header.className + '`');
        push('  - 标题: ' + this.getHeaderTitle(header));
        push('  - display: ' + getComputedStyle(header).display);
      }

      push(
        '- leaf.containerEl.className: `' +
          (item.leaf.containerEl ? item.leaf.containerEl.className : 'null') +
          '`'
      );

      const leafEl = this.getLeafElement(item.leaf);
      if (leafEl) {
        const chain = [];
        let n = leafEl;
        let d = 0;
        while (n && d < 6) {
          chain.push(n.className || n.tagName);
          n = n.parentElement;
          d++;
        }
        push('- 向上层级: ' + chain.join(' < '));
      }
    });

    push('');
    push('## 页面上所有 .workspace-tab-header');
    const all = Array.from(document.querySelectorAll('.workspace-tab-header'));
    push('共 ' + all.length + ' 个');
    all.forEach((h, i) => {
      push(
        i +
          '. `' +
          h.className +
          '` title="' +
          this.getHeaderTitle(h) +
          '" display=' +
          getComputedStyle(h).display
      );
    });

    push('');
    push('## 所有 .workspace-tabs');
    Array.from(document.querySelectorAll('.workspace-tabs')).forEach((t, i) => {
      const hc = t.querySelector('.workspace-tab-header-container');
      const tc = t.querySelector('.workspace-tab-container');
      const hCount = hc ? hc.querySelectorAll('.workspace-tab-header').length : 0;
      const lCount = tc ? tc.querySelectorAll('.workspace-leaf').length : 0;
      push(i + '. `' + t.className + '` header=' + hCount + ' leaf=' + lCount);
    });

    try {
      await this.app.vault.adapter.write('_ptb-diag.md', lines.join('\n'));
      new Notice('诊断已写入 vault 根目录：_ptb-diag.md', 6000);
    } catch (e) {
      new Notice('写入诊断文件失败：' + (e && e.message ? e.message : e), 8000);
    }
  }

  // ---------------------------------------------------------------- 顶部标签栏处理

  clearHeaderMarks() {
    document
      .querySelectorAll('.workspace-tab-header.ptb-hide-tab')
      .forEach((el) => el.classList.remove('ptb-hide-tab'));
    document
      .querySelectorAll('.workspace-tab-header.ptb-compact-tab')
      .forEach((el) => el.classList.remove('ptb-compact-tab'));
    // 旧版本类名，顺手清掉
    document
      .querySelectorAll('.workspace-tab-header.ptb-pinned-header')
      .forEach((el) => el.classList.remove('ptb-pinned-header'));
    // 兜底：清掉任何残留徽标，避免和原标题重叠
    document.querySelectorAll('.ptb-tab-badge').forEach((el) => el.remove());
    document.querySelectorAll('.workspace-tabs.ptb-all-hidden').forEach((el) => {
      el.classList.remove('ptb-all-hidden');
    });
  }

  applyHeaderMarks() {
    const active = !!this.settings.enabled;
    document.body.classList.toggle('ptb-on', active);

    if (!active) {
      this.clearHeaderMarks();
      return;
    }

    // 逐个标签决定位置：sidebar（收进侧栏）/ compact（顶部收缩）/ top（顶部原生）
    // 增量打标记，避免每次全清再加导致顶部标签栏闪烁
    const keepHide = new Set();
    const keepCompact = new Set();

    for (const item of this.pinnedItems) {
      let header = this.getHeaderForLeaf(item.leaf);
      if (!header && item.header && item.header.isConnected) header = item.header;
      if (!header) continue;
      item.header = header;

      if (item.mode === 'sidebar') {
        header.classList.add('ptb-hide-tab');
        header.classList.remove('ptb-compact-tab');
        this.removeTabBadge(header);
        keepHide.add(header);
      } else if (item.mode === 'compact') {
        header.classList.add('ptb-compact-tab');
        header.classList.remove('ptb-hide-tab');
        this.ensureTabBadge(header, item);
        this.bindHeaderDoubleClick(header, item.leaf);
        keepCompact.add(header);
      } else {
        // 顶部原生：布局交还 Obsidian，右键也交还，只挂一个双击入口
        header.classList.remove('ptb-hide-tab');
        header.classList.remove('ptb-compact-tab');
        this.removeTabBadge(header);
        this.bindHeaderDoubleClick(header, item.leaf);
      }
    }

    document
      .querySelectorAll('.workspace-tab-header.ptb-hide-tab')
      .forEach((el) => {
        if (!keepHide.has(el)) el.classList.remove('ptb-hide-tab');
      });

    document
      .querySelectorAll('.workspace-tab-header.ptb-compact-tab')
      .forEach((el) => {
        if (!keepCompact.has(el)) {
          el.classList.remove('ptb-compact-tab');
          this.removeTabBadge(el);
        }
      });

    // 某个标签组里如果所有标签都收进了侧栏，整条 header 带就没必要留白
    document.querySelectorAll('.workspace-tabs').forEach((tabsEl) => {
      const headerContainer = tabsEl.querySelector(
        ':scope > .workspace-tab-header-container'
      );
      if (!headerContainer) return;
      const inner =
        headerContainer.querySelector(
          ':scope > .workspace-tab-header-container-inner'
        ) || headerContainer;
      const headers = inner.querySelectorAll(':scope > .workspace-tab-header');
      const hidden = inner.querySelectorAll(
        ':scope > .workspace-tab-header.ptb-hide-tab'
      );
      const allHidden = headers.length > 0 && hidden.length === headers.length;
      tabsEl.classList.toggle('ptb-all-hidden', allHidden);
    });
  }

  ensureTabBadge(header, item) {
    const inner = header.querySelector('.workspace-tab-header-inner');
    if (!inner) return;
    let badge = inner.querySelector('.ptb-tab-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'ptb-tab-badge';
      inner.insertBefore(badge, inner.firstChild);
    }
    const text = item.label || '';
    if (badge.textContent !== text) badge.textContent = text;
    badge.classList.toggle('is-long', text.length >= 3);
    badge.style.setProperty('--ptb-h', String(item.hue));
  }

  removeTabBadge(header) {
    const badge = header.querySelector('.ptb-tab-badge');
    if (badge) badge.remove();
  }

  /**
   * 顶部标签栏里的置顶标签：双击直接收进侧栏。
   * 用捕获阶段绑定，抢在 Obsidian 的「双击标题重命名」之前把事件吃掉。
   * 只对放回顶部的标签生效，普通标签完全不受影响。
   */
  bindHeaderDoubleClick(header, leaf) {
    if (this._dblBound.has(header)) return;
    this._dblBound.add(header);

    header.addEventListener(
      'dblclick',
      (evt) => {
        if (this._disposed) return;

        const item = this.pinnedItems.find((i) => i.leaf === leaf);
        if (!item || item.mode === 'sidebar') return;

        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();

        const title = item.title || '标签';
        const p = this.setPlacementOf(item.path, 'sidebar');
        if (p && typeof p.then === 'function') {
          p.then(() => new Notice('已收进侧栏：' + title, 2200));
        } else {
          new Notice('已收进侧栏：' + title, 2200);
        }
      },
      true
    );
  }

  // ---------------------------------------------------------------- 渲染独立栏

  removeBar() {
    const old = document.querySelector('.ptb-bar');
    if (old) old.remove();
    this._barEl = null;
    this._barSignature = '';
  }

  getBarHost() {
    if (this.settings.position === 'status-bar') {
      const statusBar = document.querySelector('.status-bar');
      if (!statusBar) return null;
      const host = document.createElement('div');
      host.className = 'ptb-bar ptb-bar-status';
      statusBar.insertBefore(host, statusBar.firstChild);
      return host;
    }

    const ribbon =
      document.querySelector('.workspace-ribbon.side-dock-ribbon.mod-left') ||
      document.querySelector('.workspace-ribbon.mod-left') ||
      document.querySelector('.workspace-ribbon');
    if (!ribbon) return null;

    const host = document.createElement('div');
    host.className = 'ptb-bar ptb-bar-ribbon';

    if (this.settings.position === 'left-bottom') {
      const settingsEl = ribbon.querySelector('.side-dock-settings');
      if (settingsEl) ribbon.insertBefore(host, settingsEl);
      else ribbon.appendChild(host);
    } else {
      ribbon.insertBefore(host, ribbon.firstChild);
    }
    return host;
  }

  refresh(force) {
    this.pinnedItems = this.settings.enabled ? this.collectPinnedItems() : [];
    this.applyHeaderMarks();
    this.renderBar(force);
    this.verifyHide();
  }

  // 自检：该隐藏却没隐藏时，自动导出一份结构快照，省得用户手工排查
  verifyHide() {
    if (!this.settings.enabled) return;
    if (this._diagDone) return;

    const shouldHide = this.pinnedItems.filter((i) => i.mode === 'sidebar');
    if (shouldHide.length === 0) return;

    let hidden = 0;
    for (const item of shouldHide) {
      const h = item.header;
      if (h && h.isConnected && getComputedStyle(h).display === 'none') hidden++;
    }
    if (hidden === shouldHide.length) return;

    this._diagDone = true;
    // 不落盘、不发网络，只提示一次。
    // 插件不应该在 vault 里悄悄生成文件，诊断快照只在用户主动执行命令时才写。
    new Notice(
      `Pinned Tab Bar: ${shouldHide.length - hidden} 个置顶标签未能从顶部隐藏。` +
        '可在命令面板运行「诊断」导出结构快照。',
      8000
    );
  }

  renderBar(force) {
    // 只有「收进侧栏」的标签才出现在独立栏里
    const items = this.pinnedItems.filter((i) => i.mode === 'sidebar');

    if (!this.settings.enabled || items.length === 0) {
      this.removeBar();
      return;
    }

    const signature = JSON.stringify({
      pos: this.settings.position,
      mode: this.settings.displayMode,
      size: this.settings.iconSize,
      items: items.map((i) => [i.title, i.icon, i.label, i.hue, i.path]),
    });

    if (
      !force &&
      signature === this._barSignature &&
      this._barEl &&
      this._barEl.isConnected
    ) {
      this.updateActiveState();
      return;
    }

    this.removeBar();

    const host = this.getBarHost();
    if (!host) return;
    this._barEl = host;
    this._barSignature = signature;

    host.style.setProperty(
      '--ptb-icon-size',
      `${Number(this.settings.iconSize) || 18}px`
    );

    for (const item of items) {
      const btn = document.createElement('div');
      btn.className = 'ptb-item';
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.setAttribute('aria-label', item.title);
      btn.setAttribute('data-tooltip-position', 'right');
      btn.style.setProperty('--ptb-h', String(item.hue));

      if (this.settings.displayMode === 'icon') {
        const iconEl = document.createElement('div');
        iconEl.className = 'ptb-item-icon';
        setIcon(iconEl, item.icon || 'file');
        btn.appendChild(iconEl);
        btn.classList.add('ptb-mode-icon');
      } else {
        const labelEl = document.createElement('div');
        labelEl.className = 'ptb-item-label';
        labelEl.textContent = item.label;
        if (item.label.length >= 3) labelEl.classList.add('is-long');
        btn.appendChild(labelEl);
        btn.classList.add('ptb-mode-letter');
      }

      btn.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.activateItem(item);
      });

      btn.addEventListener('auxclick', (evt) => {
        if (evt.button === 1) {
          evt.preventDefault();
          this.activateItem(item);
        }
      });

      btn.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.showItemMenu(evt, item);
      });

      btn.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          this.activateItem(item);
        }
      });

      host.appendChild(btn);
      item.btnEl = btn;
    }

    this.updateActiveState();
  }

  updateActiveState() {
    let activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf && typeof this.app.workspace.getMostRecentLeaf === 'function') {
      activeLeaf = this.app.workspace.getMostRecentLeaf();
    }
    for (const item of this.pinnedItems) {
      if (!item.btnEl || !item.btnEl.isConnected) continue;
      item.btnEl.classList.toggle('is-active', item.leaf === activeLeaf);
    }
  }

  // ---------------------------------------------------------------- 交互

  activateItem(item) {
    if (!item.leaf) {
      this.scheduleRefresh();
      return;
    }
    try {
      const result = this.app.workspace.revealLeaf(item.leaf);
      if (result && typeof result.catch === 'function') {
        result.catch(() => this.scheduleRefresh());
      }
    } catch (e) {
      this.scheduleRefresh();
      return;
    }

    const btn = item.btnEl;
    if (btn) {
      btn.classList.remove('is-flash');
      // 强制回流，让动画能重复触发
      void btn.offsetWidth;
      btn.classList.add('is-flash');
      window.setTimeout(() => btn.classList.remove('is-flash'), 420);
    }
    this.updateActiveState();
  }

  pinLeaf(leaf) {
    let state = null;
    try {
      state = leaf.getViewState();
    } catch (e) {
      state = null;
    }
    if (state && state.pinned) {
      new Notice('这个标签已经是置顶状态了。');
      return;
    }

    let done = false;
    try {
      if (typeof leaf.setPinned === 'function') {
        leaf.setPinned(true);
        done = true;
      }
    } catch (e) {
      done = false;
    }
    if (!done) {
      try {
        if (typeof leaf.togglePinned === 'function') {
          leaf.togglePinned();
          done = true;
        }
      } catch (e) {
        done = false;
      }
    }
    if (!done) {
      try {
        leaf.pinned = true;
        done = true;
      } catch (e) {
        done = false;
      }
    }
    if (!done) {
      new Notice('当前 Obsidian 版本不支持通过插件置顶标签，请右键标签手动置顶。');
    }
    this.scheduleRefresh();
  }

  unpinItem(item) {
    const leaf = item.leaf;
    let state = null;
    try {
      state = leaf.getViewState();
    } catch (e) {
      state = null;
    }
    if (state && state.pinned === false) {
      // 已经不是置顶状态，直接刷新掉
      this.scheduleRefresh();
      return;
    }

    let done = false;

    try {
      if (typeof leaf.setPinned === 'function') {
        leaf.setPinned(false);
        done = true;
      }
    } catch (e) {
      done = false;
    }
    if (!done) {
      try {
        if (typeof leaf.togglePinned === 'function') {
          leaf.togglePinned();
          done = true;
        }
      } catch (e) {
        done = false;
      }
    }
    if (!done) {
      try {
        leaf.pinned = false;
        done = true;
      } catch (e) {
        done = false;
      }
    }

    if (!done) {
      new Notice(
        '无法取消置顶。可以先去设置面板把这个标签改成「放回顶部」，再右键原标签操作。'
      );
      return;
    }

    this.refresh(true);
    // Obsidian 重绘 header 有延迟，再补一次
    window.setTimeout(() => this.refresh(), 220);
    window.setTimeout(() => this.refresh(), 600);
  }

  showItemMenu(evt, item) {
    const menu = new Menu();
    const file = item.file || (item.path ? this.app.vault.getAbstractFileByPath(item.path) : null);

    const mode = this.getPlacementOf(item.path);

    menu.addItem((i) =>
      i
        .setTitle('收进侧栏')
        .setIcon('panel-left')
        .setChecked(mode === 'sidebar')
        .onClick(() => this.setPlacementOf(item.path, 'sidebar'))
    );

    menu.addItem((i) =>
      i
        .setTitle('放回顶部 · 完整显示')
        .setIcon('panel-top')
        .setChecked(mode === 'top')
        .onClick(() => this.setPlacementOf(item.path, 'top'))
    );

    menu.addItem((i) =>
      i
        .setTitle('放回顶部 · 收缩成小方块')
        .setIcon('shrink')
        .setChecked(mode === 'compact')
        .onClick(() => this.setPlacementOf(item.path, 'compact'))
    );

    menu.addSeparator();

    menu.addItem((i) =>
      i
        .setTitle('取消置顶（变回普通标签）')
        .setIcon('pin-off')
        .onClick(() => this.unpinItem(item))
    );

    menu.addSeparator();

    if (file instanceof TFile) {
      menu.addItem((i) =>
        i
          .setTitle('在右侧分屏打开')
          .setIcon('separator-vertical')
          .onClick(async () => {
            const leaf = this.app.workspace.getLeaf('split', 'vertical');
            await leaf.openFile(file);
          })
      );

      menu.addItem((i) =>
        i
          .setTitle('在新窗口打开')
          .setIcon('picture-in-picture-2')
          .onClick(async () => {
            try {
              const leaf = this.app.workspace.getLeaf('window');
              await leaf.openFile(file);
            } catch (e) {
              new Notice('当前版本不支持在新窗口打开。');
            }
          })
      );

      if (item.path) {
        menu.addItem((i) =>
          i
            .setTitle('复制文件路径')
            .setIcon('copy')
            .onClick(async () => {
              await navigator.clipboard.writeText(item.path);
              new Notice('已复制：' + item.path);
            })
        );
      }
    }

    menu.addSeparator();

    menu.addItem((i) =>
      i
        .setTitle('关闭此标签')
        .setIcon('x')
        .onClick(() => {
          try {
            item.leaf.detach();
          } catch (e) {
            /* ignore */
          }
          this.scheduleRefresh();
        })
    );

    menu.addItem((i) =>
      i
        .setTitle('关闭其他标签页（保留置顶）')
        .setIcon('x-circle')
        .onClick(() => {
          const parent = item.leaf.parent;
          if (!parent || !Array.isArray(parent.children)) return;
          for (const other of parent.children.slice()) {
            if (other === item.leaf) continue;
            let pinned = false;
            try {
              const st = other.getViewState();
              pinned = !!(st && st.pinned);
            } catch (e) {
              pinned = false;
            }
            if (pinned) continue;
            try {
              other.detach();
            } catch (e) {
              /* ignore */
            }
          }
          this.scheduleRefresh();
        })
    );

    menu.showAtMouseEvent(evt);
  }
}

// ------------------------------------------------------------------ 设置面板

class PinnedTabBarSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '置顶文件栏' });

    new Setting(containerEl)
      .setName('启用')
      .setDesc('关闭后立即恢复成 Obsidian 默认的顶部标签栏行为。')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enabled).onChange(async (v) => {
          this.plugin.settings.enabled = v;
          await this.plugin.saveSettings();
          this.plugin.refresh(true);
        })
      );

    new Setting(containerEl)
      .setName('侧栏放在哪')
      .setDesc('左侧缎带最不占用编辑区。')
      .addDropdown((d) =>
        d
          .addOption('left-top', '左侧缎带 · 顶部')
          .addOption('left-bottom', '左侧缎带 · 底部（设置按钮上方）')
          .addOption('status-bar', '底部状态栏')
          .setValue(this.plugin.settings.position)
          .onChange(async (v) => {
            this.plugin.settings.position = v;
            await this.plugin.saveSettings();
            this.plugin.refresh(true);
          })
      );

    // 让下面的列表拿到当前最新的置顶标签
    this.plugin.pinnedItems = this.plugin.settings.enabled
      ? this.plugin.collectPinnedItems()
      : [];

    containerEl.createEl('h3', { text: '每个置顶标签放在哪' });

    if (this.plugin.pinnedItems.length === 0) {
      const empty = containerEl.createEl('div', { cls: 'ptb-settings-tip' });
      empty.createEl('p', {
        text: '当前没有置顶标签。在顶部标签栏右键某个标签选「置顶」，它就会出现在这里。',
      });
    } else {
      for (const item of this.plugin.pinnedItems) {
        const row = new Setting(containerEl).setName(item.title);
        if (item.path) row.setDesc(item.path);
        row.addDropdown((d) =>
          d
            .addOption('sidebar', '收进侧栏（默认）')
            .addOption('compact', '顶部 · 收缩成小方块')
            .addOption('top', '顶部 · 完整显示')
            .setValue(this.plugin.getPlacementOf(item.path))
            .onChange(async (v) => {
              await this.plugin.setPlacementOf(item.path, v);
              this.display();
            })
        );
      }
    }

    new Setting(containerEl)
      .setName('图标形态')
      .setDesc(
        '仅「侧栏」模式生效；「顶部·收缩」固定用首字徽标。「首字徽标」用文件名前几个字加专属配色，比文件类型图标更容易区分同类文件。'
      )
      .addDropdown((d) =>
        d
          .addOption('letter', '首字徽标（推荐）')
          .addOption('icon', '文件类型图标')
          .setValue(this.plugin.settings.displayMode)
          .onChange(async (v) => {
            this.plugin.settings.displayMode = v;
            await this.plugin.saveSettings();
            this.plugin.refresh(true);
          })
      );

    new Setting(containerEl)
      .setName('徽标字数')
      .setDesc('首字徽标显示 filename 的前几个字符，建议 1~2。也可在单个文件的 frontmatter 里写 ptb-label 单独指定。')
      .addSlider((s) =>
        s
          .setLimits(1, 4, 1)
          .setValue(this.plugin.settings.labelLength)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.labelLength = v;
            await this.plugin.saveSettings();
            this.plugin.refresh(true);
          })
      );

    new Setting(containerEl)
      .setName('图标尺寸')
      .setDesc('徽标方块里图标 / 文字区域的大小，单位 px。')
      .addSlider((s) =>
        s
          .setLimits(12, 26, 1)
          .setValue(this.plugin.settings.iconSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.iconSize = v;
            await this.plugin.saveSettings();
            this.plugin.refresh(true);
          })
      );

    const tip = containerEl.createEl('div', { cls: 'ptb-settings-tip' });
    tip.createEl('p', { text: '用法：' });
    const ul = tip.createEl('ul');
    ul.createEl('li', { text: '侧栏模式：左键点击徽标 → 跳到该文件，徽标高亮；右键徽标 → 取消置顶 / 右侧分屏 / 新窗口 / 复制路径 / 关闭。' });
    ul.createEl('li', { text: '顶部收缩模式：置顶标签留在顶部栏，只占约 44px，悬停显示完整文件名；点击即切换。' });
    ul.createEl('li', { text: '三种位置可以随时换：命令面板执行「切换置顶标签位置」，一次循环一种。' });
    ul.createEl('li', { text: '想让某个文件显示固定文字或颜色：在它的 frontmatter 写 ptb-label: 数 / ptb-color: 200。' });
  }
}

module.exports = PinnedTabBar;
