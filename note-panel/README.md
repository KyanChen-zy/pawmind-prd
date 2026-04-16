# 笔记悬浮功能组件

## 功能概述

为 HTML PRD 原型添加笔记功能，支持：
- 全局笔记（所有版本共享）
- 版本笔记（按版本记录，支持标签）

## 文件结构

```
├── note-panel.js        # 笔记功能核心逻辑
├── note-panel.css       # 笔记样式
├── index.html           # 笔记功能演示页面
└── notes/
    ├── template.json        # JSON 格式模板
    ├── overall-notes.json   # 全局笔记（本地模式使用）
    └── version-notes-v*.json # 版本笔记（本地模式使用）
```

## 存储策略

根据访问方式自动选择存储后端：

| 环境 | 判断条件 | 保存方式 | 加载方式 |
|------|---------|---------|---------|
| 本地打开 | `file://` 协议 | File System Access API → `notes/*.json` | 从 JSON 文件读取 |
| GitHub Pages | `http://` / `https://` 协议 | localStorage | localStorage |

### 本地模式（File System Access API）

当检测到 `location.protocol === 'file:'` 时，笔记自动保存到项目 `notes/` 目录下的 JSON 文件：

- 全局笔记 → `notes/overall-notes.json`
- 版本笔记 → `notes/version-notes-{版本号}.json`

**授权流程：**

1. 首次保存笔记时，浏览器弹出目录选择器，用户选择项目的 `notes/` 文件夹
2. 浏览器通过 `id: 'note-panel-notes'` 记住授权，后续保存静默写入，无需重复授权
3. 如果用户取消授权或权限失效，自动降级到 localStorage，不影响使用
4. 保存成功后输入区下方显示"已保存到文件"提示，2 秒后消失

**兼容性要求：** Chrome 86+、Edge 86+（Firefox 和 Safari 暂不支持 File System Access API，会降级到 localStorage）。

### 在线模式（localStorage）

GitHub Pages 等线上环境，由于无法写入文件系统，使用浏览器 localStorage：

- 全局笔记 → key: `note_panel_global`
- 版本笔记 → key: `note_panel_version_{版本号}`

**注意：** localStorage 数据仅存储在当前浏览器中，清除浏览器数据会丢失笔记。

## 数据格式

### 全局笔记

```json
{
  "notes": [
    {
      "id": "note_001",
      "content": "笔记内容",
      "createdAt": "2026-04-17T00:00:00.000Z",
      "updatedAt": "2026-04-17T00:00:00.000Z"
    }
  ],
  "lastUpdated": "2026-04-17T00:00:00.000Z"
}
```

### 版本笔记

```json
{
  "notes": [
    {
      "id": "note_002",
      "content": "版本特定笔记",
      "tags": ["v2.0", "重要"],
      "createdAt": "2026-04-17T00:00:00.000Z",
      "updatedAt": "2026-04-17T00:00:00.000Z"
    }
  ],
  "lastUpdated": "2026-04-17T00:00:00.000Z"
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识，格式 `note_xxx` 或时间戳 hash |
| `content` | string | ✅ | 笔记正文 |
| `tags` | string[] | ❌ | 标签数组，仅版本笔记有 |
| `createdAt` | ISO 8601 | ✅ | 创建时间 |
| `updatedAt` | ISO 8601 | ✅ | 最后修改时间 |

## 集成方式

1. 在 HTML `<head>` 中添加 CSS：
   ```html
   <link rel="stylesheet" href="../note-panel/note-panel.css">
   ```

2. 在 HTML `<head>` 中添加版本 meta 标签：
   ```html
   <meta name="version" content="v2.0">
   ```

3. 在 `</body>` 前引入 JS 并初始化：
   ```html
   <script src="../note-panel/note-panel.js"></script>
   <script>new NotePanel({});</script>
   ```

4. 确保项目目录有 `notes/` 子目录（本地模式需要）

## 版本检测

版本从以下方式获取（按优先级）：
1. URL 参数 `?v=2.0`
2. `<meta name="version">` 标签
3. 默认值 "v1.0"
