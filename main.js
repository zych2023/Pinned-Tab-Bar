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
  language: 'auto', // 'auto' | 'zh' | 'en'
  position: 'left-top', // 'left-top' | 'left-bottom' | 'status-bar'
  displayMode: 'letter', // 'letter' | 'icon'
  labelLength: 2,
  iconSize: 18,
  // 逐个置顶标签的位置覆盖：{ "相对路径.md": "sidebar" | "compact" | "top" }
  // 没有记录 = sidebar（默认收进侧栏）
  placementMap: {},
};

// ---------------------------------------------------------------- 文案

const STRINGS = {
  zh: {
    'cmd.refresh': '刷新置顶文件栏',
    'cmd.toggle': '显示/隐藏置顶文件栏',
    'cmd.allToSidebar': '全部置顶标签收进侧栏',
    'cmd.allToTop': '全部置顶标签放回顶部',
    'cmd.pinCurrent': '把当前标签置顶',
    'cmd.diagnose': '诊断：导出结构与状态到 _ptb-diag.md',

    'notice.allToSidebar': '所有置顶标签已收进侧栏',
    'notice.allToTop': '所有置顶标签已放回顶部',
    'notice.diagSaved': '诊断已写入 vault 根目录：_ptb-diag.md',
    'notice.diagFailed': '写入诊断文件失败：{0}',
    'notice.movedToSidebar': '已收进侧栏：{0}',
    'notice.alreadyPinned': '这个标签已经是置顶状态了。',
    'notice.pinUnsupported':
      '当前 Obsidian 版本不支持通过插件置顶标签，请右键标签手动置顶。',
    'notice.newWindowUnsupported': '当前版本不支持在新窗口打开。',
    'notice.unpinFailed':
      '无法取消置顶。可以先把该标签改成「放回顶部」，再右键原标签操作。',
    'notice.hideFailed':
      '{0} 个置顶标签未能从顶部隐藏。可在命令面板运行「诊断」导出结构快照。',
    'notice.welcome':
      '置顶文件栏已启用：置顶标签现在有自己的独立栏。\n左键点击徽标跳转，右键徽标可换位置或取消置顶。',

    'menu.toSidebar': '收进侧栏',
    'menu.toTopFull': '放回顶部 · 完整显示',
    'menu.toTopCompact': '放回顶部 · 收缩成小方块',
    'menu.unpin': '取消置顶（变回普通标签）',
    'menu.openRight': '在右侧分屏打开',
    'menu.openWindow': '在新窗口打开',
    'menu.close': '关闭此标签',
    'menu.closeOthers': '关闭其他标签页（保留置顶）',

    'settings.title': '置顶文件栏',
    'settings.language.name': '语言',
    'settings.language.desc':
      '插件界面语言。选「跟随 Obsidian」会随 Obsidian 的语言自动切换。切换后设置面板立即生效，命令面板里的命令名需重新加载插件才会更新。',
    'settings.language.auto': '跟随 Obsidian',
    'settings.enable.name': '启用',
    'settings.enable.desc': '关闭后立即恢复成 Obsidian 默认的顶部标签栏行为。',
    'settings.position.name': '侧栏放在哪',
    'settings.position.desc': '左侧缎带最不占用编辑区。',
    'settings.position.leftTop': '左侧缎带 · 顶部',
    'settings.position.leftBottom': '左侧缎带 · 底部（设置按钮上方）',
    'settings.position.statusBar': '底部状态栏',
    'settings.perTab.title': '每个置顶标签放在哪',
    'settings.perTab.empty':
      '当前没有置顶标签。在顶部标签栏右键某个标签选「置顶」，它就会出现在这里。',
    'settings.perTab.sidebar': '收进侧栏（默认）',
    'settings.perTab.compact': '顶部 · 收缩成小方块',
    'settings.perTab.top': '顶部 · 完整显示',
    'settings.badgeStyle.name': '图标形态',
    'settings.badgeStyle.desc':
      '「首字徽标」用文件名前几个字加专属配色，比文件类型图标更容易区分同类文件。',
    'settings.badgeStyle.letter': '首字徽标（推荐）',
    'settings.badgeStyle.icon': '文件类型图标',
    'settings.badgeLength.name': '徽标字数',
    'settings.badgeLength.desc':
      '首字徽标显示文件名的前几个字符，建议 1~2。也可在单个文件的 frontmatter 里写 ptb-label 单独指定。',
    'settings.badgeSize.name': '图标尺寸',
    'settings.badgeSize.desc': '徽标方块里图标 / 文字区域的大小，单位 px。',
    'settings.help.title': '用法',
    'settings.help.line1':
      '侧栏徽标：左键跳转并高亮；右键可换位置、取消置顶、右侧分屏、新窗口、关闭。',
    'settings.help.line2':
      '顶部标签：双击它 → 直接收进侧栏。右键仍是 Obsidian 原生菜单。',
    'settings.help.line3': '每个标签的位置互相独立，三种状态可以同时存在。',
    'settings.help.line4':
      '想让某个文件显示固定文字或颜色：在它的 frontmatter 写 ptb-label: N / ptb-color: 200。',
  },

  en: {
    'cmd.refresh': 'Refresh pinned tab bar',
    'cmd.toggle': 'Show or hide pinned tab bar',
    'cmd.allToSidebar': 'Move all pinned tabs to sidebar',
    'cmd.allToTop': 'Move all pinned tabs to top bar',
    'cmd.pinCurrent': 'Pin current tab',
    'cmd.diagnose': 'Diagnose: export layout snapshot to _ptb-diag.md',

    'notice.allToSidebar': 'All pinned tabs moved to the sidebar.',
    'notice.allToTop': 'All pinned tabs moved to the top bar.',
    'notice.diagSaved': 'Diagnostics written to _ptb-diag.md in the vault root.',
    'notice.diagFailed': 'Failed to write diagnostics: {0}',
    'notice.movedToSidebar': 'Moved to sidebar: {0}',
    'notice.alreadyPinned': 'This tab is already pinned.',
    'notice.pinUnsupported':
      'This Obsidian version does not allow pinning through a plugin. Pin the tab from its context menu instead.',
    'notice.newWindowUnsupported':
      'Opening in a new window is not supported in this version.',
    'notice.unpinFailed':
      'Could not unpin. Move this tab back to the top bar first, then use its context menu.',
    'notice.hideFailed':
      '{0} pinned tab(s) could not be hidden from the tab header. Run the diagnose command for a layout snapshot.',
    'notice.welcome':
      'Pinned Tab Bar is enabled: pinned tabs now live in their own strip.\nClick a badge to jump to the file; right-click it for more actions.',

    'menu.toSidebar': 'Move to sidebar',
    'menu.toTopFull': 'Move to top bar (full title)',
    'menu.toTopCompact': 'Move to top bar (compact badge)',
    'menu.unpin': 'Unpin (back to normal tab)',
    'menu.openRight': 'Open in split to the right',
    'menu.openWindow': 'Open in new window',
    'menu.close': 'Close this tab',
    'menu.closeOthers': 'Close other tabs (keep pinned)',

    'settings.title': 'Pinned Tab Bar',
    'settings.language.name': 'Language',
    'settings.language.desc':
      'Language of the plugin interface. Follow Obsidian switches automatically with the app language. The settings panel updates immediately; command names update after reloading the plugin.',
    'settings.language.auto': 'Follow Obsidian',
    'settings.enable.name': 'Enable',
    'settings.enable.desc':
      'Turning this off restores the stock tab header behaviour immediately.',
    'settings.position.name': 'Sidebar location',
    'settings.position.desc':
      'The left ribbon takes the least space from the editor.',
    'settings.position.leftTop': 'Left ribbon, top',
    'settings.position.leftBottom': 'Left ribbon, bottom (above settings)',
    'settings.position.statusBar': 'Status bar',
    'settings.perTab.title': 'Placement of each pinned tab',
    'settings.perTab.empty':
      'No pinned tabs yet. Pin a tab from its context menu and it will show up here.',
    'settings.perTab.sidebar': 'Sidebar (default)',
    'settings.perTab.compact': 'Top bar, compact badge',
    'settings.perTab.top': 'Top bar, full title',
    'settings.badgeStyle.name': 'Badge style',
    'settings.badgeStyle.desc':
      'Leading characters add a per-file color, which distinguishes several Markdown files that would otherwise share the same icon.',
    'settings.badgeStyle.letter': 'Leading characters (recommended)',
    'settings.badgeStyle.icon': 'File type icon',
    'settings.badgeLength.name': 'Badge length',
    'settings.badgeLength.desc':
      'How many leading characters to show, 1 to 4. Override per file with ptb-label in frontmatter.',
    'settings.badgeSize.name': 'Badge size',
    'settings.badgeSize.desc':
      'Size of the icon or text area inside the badge, in pixels.',
    'settings.help.title': 'Usage',
    'settings.help.line1':
      'Sidebar badge: left click jumps to the file and highlights the badge; right click opens placement, unpin, split, new window, close.',
    'settings.help.line2':
      'Top bar: pinned tabs stay where they are; double-click one to send it back to the sidebar. Right click keeps Obsidian own menu.',
    'settings.help.line3':
      'Each tab has its own placement, so the three states can coexist.',
    'settings.help.line4':
      'To fix the look of one file, add ptb-label: N or ptb-color: 200 to its frontmatter.',
  },
};

// 判断界面语言。只读运行时公开信息，不碰 localStorage / sessionStorage。
// Obsidian 会把界面语言同步给 moment，所以优先用它，回退到浏览器语言。
function detectLang() {
  let raw = '';
  try {
    if (window.moment && typeof window.moment.locale === 'function') {
      raw = window.moment.locale() || '';
    }
  } catch (e) {
    raw = '';
  }
  if (!raw) raw = navigator.language || 'en';
  return String(raw).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
}

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
      name: this.t('cmd.refresh'),
      callback: () => this.refresh(true),
    });

    this.addCommand({
      id: 'toggle-pinned-bar',
      name: this.t('cmd.toggle'),
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        this.refresh(true);
      },
    });

    this.addCommand({
      id: 'all-to-sidebar',
      name: this.t('cmd.allToSidebar'),
      callback: async () => {
        this.settings.placementMap = {};
        await this.saveSettings();
        this.refresh(true);
        new Notice(this.t('notice.allToSidebar'));
      },
    });

    this.addCommand({
      id: 'all-to-top',
      name: this.t('cmd.allToTop'),
      callback: async () => {
        const map = {};
        for (const item of this.collectPinnedItems()) {
          if (item.path) map[item.path] = 'top';
        }
        this.settings.placementMap = map;
        await this.saveSettings();
        this.refresh(true);
        new Notice(this.t('notice.allToTop'));
      },
    });

    this.addCommand({
      id: 'pin-current-tab',
      name: this.t('cmd.pinCurrent'),
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
      name: this.t('cmd.diagnose'),
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
        new Notice(this.t('notice.welcome'), 9000);
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

  // 当前生效的界面语言
  resolvedLang() {
    const pref = this.settings.language || 'auto';
    if (pref === 'zh' || pref === 'en') return pref;
    return detectLang();
  }

  // 取一条界面文案，支持 {0} {1} 占位
  t(key, ...args) {
    const dict = STRINGS[this.resolvedLang()] || STRINGS.en;
    let s = dict[key];
    if (s === undefined) s = STRINGS.en[key];
    if (s === undefined) s = STRINGS.zh[key];
    if (s === undefined) return key;
    return s.replace(/\{(\d+)\}/g, (m, i) =>
      args[i] === undefined ? m : String(args[i])
    );
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

    push('# Pinned Tab Bar diagnostics');
    push('');
    push('Generated: ' + new Date().toLocaleString());
    push('');
    push('## Settings');
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
    push('## Stylesheet check (.ptb-item computed style)');
    push('```');
    push('width: ' + cs.width);
    push('height: ' + cs.height);
    push('border-radius: ' + cs.borderRadius);
    push('background-color: ' + cs.backgroundColor);
    push('cursor: ' + cs.cursor);
    push('```');
    push(
      'Expect width around 30px when styles.css is loaded; auto or a very large value means it is not.'
    );
    probe.remove();

    push('');
    push('## Detected pinned tabs (' + this.pinnedItems.length + ')');
    this.pinnedItems.forEach((item, i) => {
      push('');
      push('### ' + (i + 1) + '. ' + item.title);
      push('- path: ' + (item.path || '(none)'));
      push('- sidebar badge: ' + (item.btnEl ? 'rendered' : 'missing'));

      const header =
        item.header && item.header.isConnected
          ? item.header
          : this.getHeaderForLeaf(item.leaf);

      if (!header) {
        push('- tab header: **not found**');
      } else {
        push('- tab header: found');
        push('  - className: `' + header.className + '`');
        push('  - title: ' + this.getHeaderTitle(header));
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
        push('- ancestor chain: ' + chain.join(' < '));
      }
    });

    push('');
    push('## All .workspace-tab-header');
    const all = Array.from(document.querySelectorAll('.workspace-tab-header'));
    push('count: ' + all.length);
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
      new Notice(this.t('notice.diagSaved'), 6000);
    } catch (e) {
      new Notice(
        this.t('notice.diagFailed', e && e.message ? e.message : e),
        8000
      );
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
          p.then(() => new Notice(this.t('notice.movedToSidebar', title), 2200));
        } else {
          new Notice(this.t('notice.movedToSidebar', title), 2200);
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
      'Pinned Tab Bar: ' + this.t('notice.hideFailed', shouldHide.length - hidden),
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
      new Notice(this.t('notice.alreadyPinned'));
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
      new Notice(this.t('notice.pinUnsupported'));
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
      new Notice(this.t('notice.unpinFailed'));
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
        .setTitle(this.t('menu.toSidebar'))
        .setIcon('panel-left')
        .setChecked(mode === 'sidebar')
        .onClick(() => this.setPlacementOf(item.path, 'sidebar'))
    );

    menu.addItem((i) =>
      i
        .setTitle(this.t('menu.toTopFull'))
        .setIcon('panel-top')
        .setChecked(mode === 'top')
        .onClick(() => this.setPlacementOf(item.path, 'top'))
    );

    menu.addItem((i) =>
      i
        .setTitle(this.t('menu.toTopCompact'))
        .setIcon('shrink')
        .setChecked(mode === 'compact')
        .onClick(() => this.setPlacementOf(item.path, 'compact'))
    );

    menu.addSeparator();

    menu.addItem((i) =>
      i
        .setTitle(this.t('menu.unpin'))
        .setIcon('pin-off')
        .onClick(() => this.unpinItem(item))
    );

    menu.addSeparator();

    if (file instanceof TFile) {
      menu.addItem((i) =>
        i
          .setTitle(this.t('menu.openRight'))
          .setIcon('separator-vertical')
          .onClick(async () => {
            const leaf = this.app.workspace.getLeaf('split', 'vertical');
            await leaf.openFile(file);
          })
      );

      menu.addItem((i) =>
        i
          .setTitle(this.t('menu.openWindow'))
          .setIcon('picture-in-picture-2')
          .onClick(async () => {
            try {
              const leaf = this.app.workspace.getLeaf('window');
              await leaf.openFile(file);
            } catch (e) {
              new Notice(this.t('notice.newWindowUnsupported'));
            }
          })
      );
    }

    menu.addSeparator();

    menu.addItem((i) =>
      i
        .setTitle(this.t('menu.close'))
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
        .setTitle(this.t('menu.closeOthers'))
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
    const p = this.plugin;
    const t = (key, ...a) => p.t(key, ...a);

    containerEl.empty();

    containerEl.createEl('h2', { text: t('settings.title') });

    // 第一栏：语言
    new Setting(containerEl)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((d) =>
        d
          .addOption('auto', t('settings.language.auto'))
          .addOption('zh', '中文')
          .addOption('en', 'English')
          .setValue(p.settings.language || 'auto')
          .onChange(async (v) => {
            p.settings.language = v;
            await p.saveSettings();
            p.refresh(true);
            this.display(); // 面板立刻换成新语言
          })
      );

    new Setting(containerEl)
      .setName(t('settings.enable.name'))
      .setDesc(t('settings.enable.desc'))
      .addToggle((tg) =>
        tg.setValue(p.settings.enabled).onChange(async (v) => {
          p.settings.enabled = v;
          await p.saveSettings();
          p.refresh(true);
        })
      );

    new Setting(containerEl)
      .setName(t('settings.position.name'))
      .setDesc(t('settings.position.desc'))
      .addDropdown((d) =>
        d
          .addOption('left-top', t('settings.position.leftTop'))
          .addOption('left-bottom', t('settings.position.leftBottom'))
          .addOption('status-bar', t('settings.position.statusBar'))
          .setValue(p.settings.position)
          .onChange(async (v) => {
            p.settings.position = v;
            await p.saveSettings();
            p.refresh(true);
          })
      );

    // 让下面的列表拿到当前最新的置顶标签
    p.pinnedItems = p.settings.enabled ? p.collectPinnedItems() : [];

    containerEl.createEl('h3', { text: t('settings.perTab.title') });

    if (p.pinnedItems.length === 0) {
      const empty = containerEl.createEl('div', { cls: 'ptb-settings-tip' });
      empty.createEl('p', { text: t('settings.perTab.empty') });
    } else {
      for (const item of p.pinnedItems) {
        const row = new Setting(containerEl).setName(item.title);
        if (item.path) row.setDesc(item.path);
        row.addDropdown((d) =>
          d
            .addOption('sidebar', t('settings.perTab.sidebar'))
            .addOption('compact', t('settings.perTab.compact'))
            .addOption('top', t('settings.perTab.top'))
            .setValue(p.getPlacementOf(item.path))
            .onChange(async (v) => {
              await p.setPlacementOf(item.path, v);
              this.display();
            })
        );
      }
    }

    new Setting(containerEl)
      .setName(t('settings.badgeStyle.name'))
      .setDesc(t('settings.badgeStyle.desc'))
      .addDropdown((d) =>
        d
          .addOption('letter', t('settings.badgeStyle.letter'))
          .addOption('icon', t('settings.badgeStyle.icon'))
          .setValue(p.settings.displayMode)
          .onChange(async (v) => {
            p.settings.displayMode = v;
            await p.saveSettings();
            p.refresh(true);
          })
      );

    new Setting(containerEl)
      .setName(t('settings.badgeLength.name'))
      .setDesc(t('settings.badgeLength.desc'))
      .addSlider((s) =>
        s
          .setLimits(1, 4, 1)
          .setValue(p.settings.labelLength)
          .setDynamicTooltip()
          .onChange(async (v) => {
            p.settings.labelLength = v;
            await p.saveSettings();
            p.refresh(true);
          })
      );

    new Setting(containerEl)
      .setName(t('settings.badgeSize.name'))
      .setDesc(t('settings.badgeSize.desc'))
      .addSlider((s) =>
        s
          .setLimits(12, 26, 1)
          .setValue(p.settings.iconSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            p.settings.iconSize = v;
            await p.saveSettings();
            p.refresh(true);
          })
      );

    const tip = containerEl.createEl('div', { cls: 'ptb-settings-tip' });
    tip.createEl('p', { text: t('settings.help.title') });
    const ul = tip.createEl('ul');
    ul.createEl('li', { text: t('settings.help.line1') });
    ul.createEl('li', { text: t('settings.help.line2') });
    ul.createEl('li', { text: t('settings.help.line3') });
    ul.createEl('li', { text: t('settings.help.line4') });
  }
}

module.exports = PinnedTabBar;
