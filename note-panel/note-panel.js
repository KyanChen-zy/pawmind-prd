/**
 * 笔记悬浮面板核心逻辑
 * 存储策略：
 *   - 本地 (file://) → File System Access API，自动写入 notes/ 下的 JSON 文件
 *   - 在线 (http/https) → localStorage
 */

class NotePanel {
  constructor(options = {}) {
    // 配置
    this.config = {
      version: options.version || this._detectVersion(),
      onUpdate: options.onUpdate || null
    };

    // localStorage 键名（在线模式使用）
    this.keys = {
      global: 'note_panel_global',
      version: `note_panel_version_${this.config.version}`
    };

    // 状态
    this.isOpen = false;
    this.activeTab = 'global'; // 'global' | 'version'
    this.globalNotes = [];
    this.versionNotes = [];

    // 存储模式
    this.isLocal = location.protocol === 'file:';

    // File System Access API 句柄缓存
    this._fsHandles = null; // { global: FileSystemDirectoryHandle, version: FileSystemDirectoryHandle }

    // JSON 文件名
    this._fileNames = {
      global: 'overall-notes.json',
      version: `version-notes-${this.config.version}.json`
    };

    // 计算 notes 目录的相对 URL
    this._notesBaseUrl = this._resolveNotesUrl();

    // 初始化
    this._init();
  }

  /** 检测当前版本 */
  _detectVersion() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlVersion = urlParams.get('v');
    if (urlVersion) return urlVersion;

    const metaVersion = document.querySelector('meta[name="version"]');
    if (metaVersion) return metaVersion.content;

    return 'v1.0';
  }

  /** 初始化 */
  _init() {
    this._createDOM();
    this._bindEvents();

    if (this.isLocal) {
      this._initFileSystem().then(() => {
        this._loadNotes();
      }).catch(() => {
        // 授权失败，仍然允许使用，但会降级到内存模式
        this._loadNotes();
      });
    } else {
      this._loadNotes();
    }
  }

  // ==================== File System Access API ====================

  /** 计算 notes 目录的相对 URL（用于 fetch 读取） */
  _resolveNotesUrl() {
    // 从当前 HTML 的 script src 推算 notes 目录
    const script = document.querySelector('script[src*="note-panel"]');
    if (!script) return null;

    const src = script.getAttribute('src');
    // src 形如 "../note-panel/note-panel.js"，向上推一层到项目根目录
    const scriptDir = src.substring(0, src.lastIndexOf('/'));
    // "../note-panel" → 去掉最后一层得到 "../"
    const projectRoot = scriptDir.substring(0, scriptDir.lastIndexOf('/'));
    return projectRoot + '/note-panel/notes/';
  }

  /** 尝试用 fetch 从 notes 目录读取 JSON */
  async _fetchJsonFile(fileName) {
    if (!this._notesBaseUrl) return null;
    try {
      const resp = await fetch(this._notesBaseUrl + fileName);
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.notes || [];
    } catch (e) {
      return null;
    }
  }

  /** 初始化文件系统访问 */
  async _initFileSystem() {
    if (!window.showDirectoryPicker) {
      console.warn('当前浏览器不支持 File System Access API，将使用内存模式');
      this._fsHandles = null;
      return;
    }

    // 尝试从 localStorage 恢复句柄
    const stored = localStorage.getItem('note_panel_fs_handles');
    if (stored) {
      try {
        const handles = JSON.parse(stored);
        this._fsHandles = {};
        // 验证权限并恢复句柄
        if (handles.global) {
          const dirHandle = await window.showDirectoryPicker({ id: 'note-panel-notes', mode: 'readwrite' }).catch(() => null);
          if (dirHandle) {
            this._fsHandles.global = dirHandle;
            this._fsHandles.version = dirHandle; // 同一个 notes 目录
          }
        }
        // 清除旧的存储方式，因为 verifyPermission 已不可靠
        localStorage.removeItem('note_panel_fs_handles');
      } catch (e) {
        this._fsHandles = null;
      }
    }

    // 如果没有有效句柄，等待用户首次保存时请求授权
    if (!this._fsHandles) {
      this._fsReady = false;
    }
  }

  /** 请求 notes 目录的授权 */
  async _requestDirectoryAccess() {
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'note-panel-notes',
        mode: 'readwrite',
        startIn: 'documents'
      });
      this._fsHandles = {
        global: dirHandle,
        version: dirHandle
      };
      this._fsReady = true;
      return true;
    } catch (e) {
      // 用户取消选择
      console.warn('用户取消了目录授权');
      return false;
    }
  }

  /** 确保有目录访问权限 */
  async _ensureDirectoryAccess() {
    if (this._fsHandles) {
      // 检查权限是否仍然有效
      try {
        const perm = await this._fsHandles.global.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') return true;
      } catch (e) {
        // 忽略，重新请求
      }
    }
    return await this._requestDirectoryAccess();
  }

  /** 从文件读取 JSON */
  async _readJsonFile(dirHandle, fileName) {
    try {
      const fileHandle = await dirHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      return data.notes || [];
    } catch (e) {
      // 文件不存在或读取失败，返回空数组
      return [];
    }
  }

  /** 写入 JSON 文件 */
  async _writeJsonFile(dirHandle, fileName, notes) {
    const content = JSON.stringify({
      notes: notes,
      lastUpdated: new Date().toISOString()
    }, null, 2);

    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  // ==================== 笔记加载 ====================

  /** 加载笔记 */
  async _loadNotes() {
    if (this.isLocal) {
      // 本地模式：优先用 File System Access API 读取，否则用 fetch，最后降级 localStorage
      if (this._fsHandles) {
        try {
          this.globalNotes = await this._readJsonFile(this._fsHandles.global, this._fileNames.global);
          this.versionNotes = await this._readJsonFile(this._fsHandles.version, this._fileNames.version);
        } catch (e) {
          console.warn('从文件系统加载笔记失败，尝试 fetch:', e);
          this.globalNotes = (await this._fetchJsonFile(this._fileNames.global)) || [];
          this.versionNotes = (await this._fetchJsonFile(this._fileNames.version)) || [];
        }
      } else {
        // 尝试 fetch 读取（需本地 HTTP 服务，file:// 下会失败）
        const globalData = await this._fetchJsonFile(this._fileNames.global);
        const versionData = await this._fetchJsonFile(this._fileNames.version);
        if (globalData !== null || versionData !== null) {
          this.globalNotes = globalData || [];
          this.versionNotes = versionData || [];
        } else {
          // fetch 也失败，降级到 localStorage
          this._loadGlobalNotes();
          this._loadVersionNotes();
        }
      }
    } else {
      this._loadGlobalNotes();
      this._loadVersionNotes();
    }
    this._renderNotes();
    this._updateBadge();
  }

  /** 从 localStorage 读取全局笔记 */
  _loadGlobalNotes() {
    try {
      const data = localStorage.getItem(this.keys.global);
      this.globalNotes = data ? JSON.parse(data) : [];
    } catch (e) {
      this.globalNotes = [];
    }
  }

  /** 从 localStorage 读取版本笔记 */
  _loadVersionNotes() {
    try {
      const data = localStorage.getItem(this.keys.version);
      this.versionNotes = data ? JSON.parse(data) : [];
    } catch (e) {
      this.versionNotes = [];
    }
  }

  // ==================== 笔记保存 ====================

  /** 保存全局笔记 */
  async _saveGlobalNotes() {
    if (this.isLocal) {
      const granted = await this._ensureDirectoryAccess();
      if (granted) {
        try {
          await this._writeJsonFile(this._fsHandles.global, this._fileNames.global, this.globalNotes);
          this._showSaveStatus('已保存到文件');
        } catch (e) {
          console.warn('保存全局笔记到文件失败:', e);
          this._showSaveStatus('保存失败', true);
          // 降级到 localStorage
          this._saveGlobalToLocalStorage();
        }
        return;
      }
      // 用户取消授权，降级到 localStorage
      this._saveGlobalToLocalStorage();
      return;
    }

    this._saveGlobalToLocalStorage();
  }

  /** 保存全局笔记到 localStorage */
  _saveGlobalToLocalStorage() {
    try {
      localStorage.setItem(this.keys.global, JSON.stringify(this.globalNotes));
      if (this.config.onUpdate) this.config.onUpdate(this.globalNotes, 'global');
    } catch (e) {
      console.warn('保存全局笔记失败:', e);
    }
    this._updateBadge();
  }

  /** 保存版本笔记 */
  async _saveVersionNotes() {
    if (this.isLocal) {
      const granted = await this._ensureDirectoryAccess();
      if (granted) {
        try {
          await this._writeJsonFile(this._fsHandles.version, this._fileNames.version, this.versionNotes);
          this._showSaveStatus('已保存到文件');
        } catch (e) {
          console.warn('保存版本笔记到文件失败:', e);
          this._showSaveStatus('保存失败', true);
          this._saveVersionToLocalStorage();
        }
        return;
      }
      this._saveVersionToLocalStorage();
      return;
    }

    this._saveVersionToLocalStorage();
  }

  /** 保存版本笔记到 localStorage */
  _saveVersionToLocalStorage() {
    try {
      localStorage.setItem(this.keys.version, JSON.stringify(this.versionNotes));
      if (this.config.onUpdate) this.config.onUpdate(this.versionNotes, 'version');
    } catch (e) {
      console.warn('保存版本笔记失败:', e);
    }
    this._updateBadge();
  }

  /** 显示保存状态提示 */
  _showSaveStatus(message, isError = false) {
    // 移除旧提示
    const old = this.panel.querySelector('.note-save-status');
    if (old) old.remove();

    const status = document.createElement('div');
    status.className = `note-save-status${isError ? ' error' : ''}`;
    status.textContent = message;
    this.panel.querySelector('.note-input-area').appendChild(status);

    setTimeout(() => status.remove(), 2000);
  }

  // ==================== UI 交互 ====================

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
        <div class="note-empty hidden" id="noteEmpty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
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
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
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

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

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
