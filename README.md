# PaperBox Rebuild

`PaperBox` 的首版重建骨架，目标是尽快跑通下面这条主链路：

1. 导入本地论文与文档
2. 建立全文索引和分类
3. 查看详情并写笔记
4. 基于选中文献发起 AI 对话

## 技术栈

- Electron
- React 19
- Vite
- SQLite (`better-sqlite3`)
- Zustand
- OpenAI SDK 兼容多家模型服务

## 目录

```text
src/
  main/        Electron 主进程、数据库、IPC
  preload/     安全桥接层
  renderer/    React 界面
docs/          方案说明、路线图
```

## 启动

```bash
npm install
npm run dev
```

## 当前状态

这是一个“可开工骨架”，重点先把结构、数据模型和开发顺序定下来。
接下来优先做：

1. 文献导入与元数据解析
2. SQLite 初始化与全文搜索
3. 三栏界面和文献详情页
4. AI 设置与对话能力
