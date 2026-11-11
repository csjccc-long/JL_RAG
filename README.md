<div align="center">

# 金流 RAG · JL_RAG

**金流智能 ERP 的知识引擎 —— 文档解析入库、检索问答与智能体工作台**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Base](https://img.shields.io/badge/base-RAGFlow%20v0.26.4-4e6b99.svg)](https://github.com/infiniflow/ragflow)
[![Web](https://img.shields.io/badge/web-React%2018%20%2B%20TypeScript-61dafb.svg)](web)
[![Engine](https://img.shields.io/badge/engine-Python%20%2B%20Go-3776ab.svg)](rag)
[![Deploy](https://img.shields.io/badge/deploy-Docker%20Compose-2496ed.svg)](docker)

</div>

## 项目简介

`JL_RAG` 是金流智能 ERP 的知识中台，为 ERP 的「知识空间 / 知识文档 / 智能助手 / 问答审计」四个模块提供文档解析、向量检索与问答生成能力。

它基于开源检索增强引擎 [RAGFlow](https://github.com/infiniflow/ragflow)（v0.26.4）二次开发：保留 RAGFlow 的 DeepDoc 文档解析、模板化分块、混合检索、Agent 编排与记忆等引擎能力，并在此之上完成品牌、中文界面、按后端能力裁剪，以及知识库工作台交互的整体重做。

- 检索口径：检索结果 = 空间权限（ACL）∩ 业务对象可见性 ∩ 文档 `READY` 且 `is_current`；
- 问答留痕：ERP 侧 `kb_query_audit` 记录每次问答的追踪 ID、状态、耗时与引用，可在「问答审计」中回看。

## 在系统中的位置

| 层 | 组件 | 地址 | 说明 |
| --- | --- | --- | --- |
| ERP 前端 | `JL_ERP/ruoyi-ui`（Vue 3 + Vite） | <http://127.0.0.1:8081/> | 业务工作台，`/dev-api` 代理到后端 |
| ERP 后端 | `JL_ERP`（Spring Boot） | <http://127.0.0.1:18085> | `ruoyi-knowledge` 模块调用本仓库的 HTTP API |
| RAG 工作台 | 本仓库 `web/`（React） | <http://127.0.0.1:18081/> | 知识库、聊天、搜索、智能体、记忆、文件管理 |
| RAGFlow API | 本仓库 `rag/` + `internal/`、`cmd/` | <http://127.0.0.1:9380> | `/api/v1/system/version` 健康检查 |
| 依赖组件 | MySQL 8 / Elasticsearch 8.11 / MinIO / Valkey | Docker 内网 | 由 `docker/docker-compose.yml` 提供，宿主端口仅供调试 |

## 相对上游的改动

本仓库相对 RAGFlow 上游领先 39 个提交，集中在三件事：

| 方向 | 内容 |
| --- | --- |
| 品牌与语言 | 全站中文界面；品牌统一为「金流 RAG」；移除官方外链与官方 logo；按后端实际能力裁剪前端入口 |
| 工作台交互 | 顶部 GooeyNav 动效导航与首页快捷栏；知识库卡片改为 CSS 3D 磁盘 / 火柴盒套筒（悬停抽出盘体）；搜索结果页像素帘幕卡片；聊天改为气泡卡 + 悬停液态金属回复气泡；等待态随机思考球并显示思考耗时；记忆模块三维唱片机卡片；文件管理玻璃文件夹卡片视图；输入框与检索结果展开改用网格过渡消除掉帧 |
| 能力与修复 | 多智能体团队协作、任务委派与上下文压缩（见 [`docs/develop/agent_team_delegation_zh.md`](docs/develop/agent_team_delegation_zh.md)）；会话标题按用户首问摘要生成；搜索框内嵌 AI 总结开关与模型/强度选择；温度 / Top P / 惩罚滑杆恢复；智能体卡片点击修复；Langfuse 保存失败不再误报为登录失效 |

## 功能一览

| 模块 | 能力 |
| --- | --- |
| 知识库（数据集） | 创建与配置解析方式、分块模板、嵌入模型；元数据与标签集；RAPTOR、知识图谱、目录（TOC）提取、PageRank |
| 文档 | 上传与解析进度、chunk 预览与编辑、批量移动/删除、多知识库关联 |
| 检索与问答 | 检索测试（向量 / 关键词 / 混合）、相似度阈值、引用溯源；聊天助手支持多模型、变量、AI 总结 |
| 智能体 | 可视化工作流画布、解析/分块/索引/检索/工具组件、导入导出、嵌入网页 |
| 记忆 | 会话记忆配置、记忆列表与消息页 |
| 系统 | 模型供应商与 API Key、团队成员与资源共享、系统状态与迁移 |

## 技术栈

- **前端** `web/`：React 18 + TypeScript + Vite + Tailwind CSS + Radix/shadcn，状态用 zustand 与 TanStack Query，图编排用 `@xyflow/react`，编辑器用 Monaco / Lexical，i18n 用 i18next。
- **检索引擎** `rag/`：Python，负责文档解析（DeepDoc）、分块、向量与关键词混合检索、LLM 调用。
- **服务层** `internal/`、`cmd/`、`api/`：Go，提供 HTTP API 与任务调度。
- **部署**：Docker Compose，镜像 `infiniflow/ragflow:v0.26.4`（CPU 版）。

## 快速开始

### 方式一：随 ERP 一起启动（推荐）

在 `E:\金流epr` 下执行一键脚本，会自动检查 Docker、拉起 RAGFlow 容器组与 MySQL/Redis，再启动 ERP 前后端：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-all.ps1
# 只起 RAG 相关：-NoRag 反向使用；换端口：-RagWebPort 18082
```

### 方式二：只启动 RAGFlow

```bash
cd docker
# 按需修改 .env（镜像源、端口、内存）后启动
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml ps
```

启动后：

- 工作台：<http://127.0.0.1:18081/>
- API 健康检查：<http://127.0.0.1:9380/api/v1/system/version>

首次启动需要在控制台创建管理员账号，并在「模型供应商」中配置 LLM / Embedding / Rerank（本机可用 Ollama，见 `docs/guides/models/llm_api_key_setup.md`）；之后为 ERP 生成一个 API Key 填入后端配置。

## 与 ERP 的对接

ERP 侧 `ruoyi-knowledge` 模块以 API Key 鉴权调用 RAGFlow HTTP API：

| 能力 | 接口 |
| --- | --- |
| 知识空间（数据集） | `POST/GET/DELETE /api/v1/datasets` |
| 文档上传 / 解析 / 删除 | `/api/v1/datasets/{dataset_id}/documents`、`.../parse` |
| 检索 | `POST /api/v1/retrieval` |
| 助手会话 | `POST/GET /api/v1/chats`、`POST /api/v1/chat/completions` |

## 目录结构

```
JL_RAG/
├── web/            # React 工作台（知识库 / 聊天 / 搜索 / 智能体 / 记忆 / 文件）
├── rag/            # Python 检索引擎：解析、分块、检索、LLM、DeepDoc
├── internal/       # Go 服务实现（API、任务、调度）
├── cmd/            # Go 入口
├── api/            # 服务端接口定义
├── deepdoc/        # 深度文档理解
├── agent/          # Agent 组件与沙箱
├── docker/         # docker-compose、.env、nginx、初始化 SQL
├── docs/           # 使用与开发文档（guides / administrator / develop）
├── sdk/            # Python / Go SDK
├── mcp/            # MCP Server
└── conf/           # 服务配置模板与模型清单
```

## 文档

- 使用指南：`docs/guides/`（数据集、文件、聊天、智能体、记忆、团队权限）
- 管理手册：`docs/administrator/`（配置、备份与迁移、CLI）
- 开发指南：`docs/develop/`（源码启动、MCP、文档引擎切换、Agent 团队委派）
- 上游文档：<https://ragflow.io/docs/dev/>

## 致谢与许可

本项目基于 [RAGFlow](https://github.com/infiniflow/ragflow) 二次开发，遵循 **Apache License 2.0**，`LICENSE` 与原始版权声明一并保留。感谢 RAGFlow 团队与所有上游贡献者。
