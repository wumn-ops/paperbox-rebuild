# 数据库设计

## 核心实体

### `papers`

文献主表，保存元数据、本地路径、内容抽取结果和 AI 摘要。

关键字段：

- `title`
- `authors`
- `year`
- `abstract`
- `keywords`
- `doi`
- `file_path`
- `file_content`
- `ai_summary`

### `folders`

支持树级目录，适合做研究主题、项目分组、资料来源分组。

### `tags`

轻量分类，适合标记状态、方法、方向、优先级。

### `notes`

同时支持普通笔记和分组节点，方便后续做树形知识卡片。

### `conversations` / `messages`

保存 AI 对话会话与消息历史；`paper_ids` 记录本次对话关联的文献上下文。

### `ai_presets`

保存模型预设，兼容 OpenAI、Qwen、Ollama 等不同 provider。

## FTS 方案

使用 SQLite `fts5` 为以下字段建索引：

- `title`
- `authors`
- `abstract`
- `keywords`
- `file_content`

这套设计足够支撑 MVP，后面如果搜索体验要增强，再补：

1. 高亮片段
2. BM25 排序
3. 中文分词优化
4. 向量检索
