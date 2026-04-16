/**
 * 笔记悬浮面板核心逻辑
 * 支持：全局笔记（JSON文件 + localStorage缓存）+ 版本笔记（JSON文件存储）
 */

class NotePanel {
  constructor(options = {}) {
    // 配置
    this.config = {
      version: options.version || this._detectVersion(), // 当前版本
      globalNotesFile: options.globalNotesFile || 'notes/overall-notes.json',
      versionNotesFile: options.versionNotesFile || 'notes/version-notes.json',
      onUpdate: options.onUpdate || null
    };

    // 状态
    this.isOpen = false;
    this.activeTab = 'global'; // 'global' | 'version'
    this.globalNotes = [];
    this.versionNotes = [];

    // 初始化
    this._init();
  }

  /** 检测当前版本 */
  _detectVersion() {
    // 1. 优先从 URL 参数获取
    const urlParams = new URLSearchParams(window.location.search);
    const urlVersion = urlParams.get('v');
    if (urlVersion) return urlVersion;

    // 2. 从 meta 标签获取
    const metaVersion = document.querySelector('meta[name="version"]');
    if (metaVersion) return metaVersion.content;

    // 3. 默认版本
    return 'v1.0';
  }

  /** 初始化 */
  _init() {
    this._createDOM();
    this._bindEvents();
    this._loadNotes();
  }

  /** 创建 DOM 结构 */
  _createDOM() {
    // 悬浮按钮
    this.fabButton = document.createElement('button');
    this.fabButton.className = 'note-fab';
    this.fabButton.setAttribute('aria-label', '打开笔记面板');
    this.fabButton.innerHTML = `
      <svg class="icon-note" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <line x1="10" y1="9" x2="8" y2="9"/>
      </svg>
      <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
      <span class="badge">0</span>
    `;

    // 笔记面板
    this.panel = document.createElement('div');
    this.panel.className = 'note-panel';
    this.panel.innerHTML = `
      <div class="note-panel-header">
        <div class="note-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          我的笔记
        </div>
        <span class="note-panel-version">${this.config.version}</span>
      </div>

      <div class="note-tabs">
        <button class="note-tab active" data-tab="global">
          全局笔记
          <span class="tab-count" id="globalCount">0</span>
        </button>
        <button class="note-tab" data-tab="version">
          版本笔记
          <span class="tab-count" id="versionCount">0</span>
        </button>
      </div>

      <div class="note-panel-body">
        <div class="note-list" id="noteList"></div>
        <div class="note-empty" id="noteEmpty" style="display: none;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
          </svg>
          <p>暂无笔记</p>
        </div>
      </div>

      <div class="note-input-area">
        <div class="note-input-wrapper">
          <textarea
            class="note-textarea"
            id="noteInput"
            placeholder="输入笔记内容..."
            rows="3"
          ></textarea>
          <div class="note-input-footer">
            <div class="note-tag-input">
              <input
                type="text"
                id="tagInput"
                placeholder="添加标签（可选）"
              />
            </div>
            <button class="note-submit-btn" id="submitBtn">
              添加笔记
            </button>
          </div>
        </div>
      </div>
    `;

    // 插入到页面
    document.body.appendChild(this.fabButton);
    document.body.appendChild(this.panel);
  }

  /** 绑定事件 */
  _bindEvents() {
    // 悬浮按钮点击
    this.fabButton.addEventListener('click', () => this.toggle());

    // 标签页切换
    this.panel.querySelectorAll('.note-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.switchTab(tab.dataset.tab);
      });
    });

    // 提交笔记
    this.panel.querySelector('#submitBtn').addEventListener('click', () => {
      this._addNote();
    });

    // 快捷键支持 (Ctrl/Cmd + Enter)
    this.panel.querySelector('#noteInput').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        this._addNote();
      }
    });

    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (this.isOpen &&
          !this.panel.contains(e.target) &&
          !this.fabButton.contains(e.target)) {
        this.close();
      }
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  /** 加载笔记 */
  async _loadNotes() {
    // 并行加载全局笔记和版本笔记
    await Promise.all([
      this._loadGlobalNotes(),
      this._loadVersionNotes()
    ]);

    // 渲染列表
    this._renderNotes();
    this._updateBadge();
  }

  /** 加载全局笔记 (JSON 文件) */
  async _loadGlobalNotes() {
    try {
      const response = await fetch(this.config.globalNotesFile);
      if (response.ok) {
        const data = await response.json();
        this.globalNotes = data.notes || [];
        // 同步缓存到 localStorage
        this._cacheGlobalNotes();
      } else {
        // 文件加载失败时回退到 localStorage 缓存
        this.globalNotes = this._getCachedGlobalNotes();
      }
    } catch (e) {
      // fetch 失败时回退到 localStorage 缓存
      console.warn('加载全局笔记失败，使用本地缓存:', e);
      this.globalNotes = this._getCachedGlobalNotes();
    }
  }

  /** 保存全局笔记 (下载 JSON 文件) */
  _saveGlobalNotes() {
    const data = {
      notes: this.globalNotes,
      lastUpdated: new Date().toISOString()
    };

    // 更新 localStorage 缓存
    this._cacheGlobalNotes();

    // 触发回调
    if (this.config.onUpdate) {
      this.config.onUpdate(data, 'global');
    }

    // 下载 JSON 文件
    this._downloadGlobalJSON(data);

    this._updateBadge();
  }

  /** 缓存全局笔记到 localStorage（作为本地读取回退） */
  _cacheGlobalNotes() {
    try {
      localStorage.setItem('note_panel_global_cache', JSON.stringify(this.globalNotes));
    } catch (e) {
      // localStorage 不可用时静默失败
    }
  }

  /** 从 localStorage 读取缓存 */
  _getCachedGlobalNotes() {
    try {
      const data = localStorage.getItem('note_panel_global_cache');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  /** 加载版本笔记 (JSON 文件) */
  async _loadVersionNotes() {
    try {
      const response = await fetch(this.config.versionNotesFile);
      if (response.ok) {
        const data = await response.json();
        this.versionNotes = data.notes || [];
      } else {
        this.versionNotes = [];
      }
    } catch (e) {
      this.versionNotes = [];
    }
  }

  /** 保存版本笔记 (下载 JSON 文件) */
  _saveVersionNotes() {
    const data = {
      version: this.config.version,
      notes: this.versionNotes,
      lastUpdated: new Date().toISOString()
    };

    if (this.config.onUpdate) {
      this.config.onUpdate(data, 'version');
    }

    this._downloadVersionJSON(data);
    this._updateBadge();
  }

  /** 下载全局笔记 JSON 文件 */
  _downloadGlobalJSON(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notes/overall-notes.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** 下载版本笔记 JSON 文件 */
  _downloadVersionJSON(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes/version-notes-${this.config.version}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** 切换面板 */
  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.panel.classList.add('open');
    this.fabButton.classList.add('active');
    this.fabButton.setAttribute('aria-label', '关闭笔记面板');
    this.panel.querySelector('#noteInput').focus();
  }

  close() {
    this.isOpen = false;
    this.panel.classList.remove('open');
    this.fabButton.classList.remove('active');
    this.fabButton.setAttribute('aria-label', '打开笔记面板');
  }

  /** 切换标签页 */
  switchTab(tab) {
    this.activeTab = tab;
    this.panel.querySelectorAll('.note-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    this._renderNotes();
  }

  /** 添加笔记 */
  _addNote() {
    const input = this.panel.querySelector('#noteInput');
    const tagInput = this.panel.querySelector('#tagInput');
    const content = input.value.trim();

    if (!content) return;

    const note = {
      id: this._generateId(),
      content: content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 添加版本标签（版本笔记）
    if (this.activeTab === 'version') {
      note.tags = [this.config.version];
      const customTags = tagInput.value.trim();
      if (customTags) {
        note.tags.push(...customTags.split(',').map(t => t.trim()).filter(Boolean));
      }
      this.versionNotes.unshift(note);
      this._saveVersionNotes();
    } else {
      this.globalNotes.unshift(note);
      this._saveGlobalNotes();
    }

    // 清空输入
    input.value = '';
    tagInput.value = '';

    // 渲染并滚动到新笔记
    this._renderNotes(note.id);
  }

  /** 删除笔记 */
  _deleteNote(id) {
    if (this.activeTab === 'version') {
      this.versionNotes = this.versionNotes.filter(n => n.id !== id);
      this._saveVersionNotes();
    } else {
      this.globalNotes = this.globalNotes.filter(n => n.id !== id);
      this._saveGlobalNotes();
    }
    this._renderNotes();
  }

  /** 渲染笔记列表 */
  _renderNotes(highlightId = null) {
    const list = this.panel.querySelector('#noteList');
    const empty = this.panel.querySelector('#noteEmpty');
    const notes = this.activeTab === 'version' ? this.versionNotes : this.globalNotes;

    // 更新计数
    this.panel.querySelector('#globalCount').textContent = this.globalNotes.length;
    this.panel.querySelector('#versionCount').textContent = this.versionNotes.length;

    if (notes.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    list.innerHTML = notes.map(note => this._renderNoteItem(note, highlightId)).join('');

    // 绑定删除事件
    list.querySelectorAll('.note-item-action.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteNote(btn.dataset.id);
      });
    });

    // 如果有新笔记，滚动到它
    if (highlightId) {
      const newItem = list.querySelector(`[data-id="${highlightId}"]`);
      if (newItem) {
        newItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  /** 渲染单个笔记项 */
  _renderNoteItem(note, highlightId = null) {
    const time = this._formatTime(note.createdAt);
    const tagsHtml = note.tags
      ? note.tags.map(tag => `<span class="note-item-tag">${tag}</span>`).join('')
      : '';

    const isNew = note.id === highlightId;

    return `
      <div class="note-item${isNew ? ' new' : ''}" data-id="${note.id}">
        <div class="note-item-header">
          <span class="note-item-time">${time}</span>
          <div class="note-item-actions">
            <button class="note-item-action delete" data-id="${note.id}" title="删除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="note-item-content">${this._escapeHtml(note.content)}</div>
        ${tagsHtml ? `<div class="note-item-tags">${tagsHtml}</div>` : ''}
      </div>
    `;
  }

  /** 更新徽章 */
  _updateBadge() {
    const total = this.globalNotes.length + this.versionNotes.length;
    const badge = this.fabButton.querySelector('.badge');
    badge.textContent = total;
    badge.classList.toggle('show', total > 0);
    this.fabButton.classList.toggle('has-notes', total > 0);
  }

  /** 生成唯一 ID */
  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /** 格式化时间 */
  _formatTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    // 1 分钟内
    if (diff < 60000) return '刚刚';

    // 1 小时内
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;

    // 24 小时内
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

    // 超过 24 小时
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /** HTML 转义 */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 导出
window.NotePanel = NotePanel;
