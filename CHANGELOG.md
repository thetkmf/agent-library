# Changelog

本项目的所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned

- 工作台总览页（最近条目、待办、索引状态）
- 代码签名与自动更新
- 跨版本升级/回滚实测

## [0.1.0-beta.1] - 2026-11-25

首个公开内测版，Windows x64。

### Added

- 笔记、TeX 便签与文件附件管理；标签、时间轴、软删除与恢复、版本冲突保护。
- 关键词（SQLite FTS5）、语义（Chroma）与混合（RRF）检索，支持类型/标签过滤与片段高亮。
- 内置 `BAAI/bge-small-zh-v1.5` 离线 ONNX 嵌入模型（512 维），安装后无需下载。
- DeepSeek 流式对话、知识库工具调用与引用；摘要、打标、关联、画像、图谱等 AI 任务与建议确认。
- 提醒（重复规则、桌面通知、稍后提醒）、学习计划与里程碑/进度、知识图谱、设置与画像。
- 全部数据本地存储；API Key 写入 Windows 凭据管理器；AI 外联默认关闭。
- PyInstaller 后端 sidecar 与 NSIS 安装包；卸载保留用户数据。
- 后端契约测试、前端单元测试与 Playwright 关键路径 E2E。

### Security

- 后端仅监听回环地址，使用每次启动生成的 Bearer token。
- 密钥不进入数据库、日志与接口响应。
- 模型随包分发，运行时不联网下载。

### Known limitations

- 安装包未代码签名，Windows SmartScreen 会提示未知发布者。
- 仅支持 Windows x64；暂无自动更新。
- 跨版本降级未实测；升级前请备份数据目录。
- 工作台总览页仍为占位页。
- AI 功能需要用户自备 DeepSeek API Key。

[Unreleased]: https://github.com/thetkmf/agent-library/compare/v0.1.0-beta.1...HEAD
[0.1.0-beta.1]: https://github.com/thetkmf/agent-library/releases/tag/v0.1.0-beta.1
