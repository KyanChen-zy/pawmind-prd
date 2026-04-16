# 笔记悬浮功能组件

## 功能概述

为 HTML PRD 原型添加笔记功能，支持：
- 全局笔记（所有版本共享，存储于 localStorage）
- 版本笔记（按版本记录，存储于项目 JSON 文件）

## 文件结构

```
├── note-panel.html      # 笔记功能演示页面
├── note-panel.js        # 笔记功能核心逻辑
├── note-panel.css       # 笔记样式
└── notes/
    └── v*.json          # 版本笔记存储文件
```

## 数据格式

### 全局笔记 (JSON 文件: `notes/overall-notes.json`)
```json
{
  "globalNotes": [
    {
      "id": "uuid",
      "content": "笔记内容",
      "createdAt": "2026-04-17T01:07:00Z",
      "updatedAt": "2026-04-17T01:07:00Z"
    }
  ]
}
```

### 版本笔记 (JSON 文件)
```json
{
  "version": "v2.0",
  "notes": [
    {
      "id": "uuid",
      "content": "版本特定笔记",
      "createdAt": "2026-04-17T01:07:00Z",
      "tags": ["v2.0", "重要"]
    }
  ],
  "lastUpdated": "2026-04-17T01:07:00Z"
}
```

## 集成方式

1. 复制 `note-panel.js` 和 `note-panel.css` 到项目
2. 在 HTML 中引入 CSS 和 JS
3. 在 `<body>` 末尾添加初始化代码
4. 确保项目目录有 `notes/` 子目录（用于版本笔记）

## 版本检测

版本从以下方式获取（按优先级）：
1. URL 参数 `?v=2.0`
2. `<meta name="version">` 标签
3. 默认值 "v1.0"
