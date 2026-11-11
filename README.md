<div align="center">

# 金流 RAG · JL_RAG

**The knowledge engine of 金流智能 ERP — document parsing, retrieval-augmented QA and an agent workbench**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Base](https://img.shields.io/badge/base-RAGFlow%20v0.26.4-4e6b99.svg)](https://github.com/infiniflow/ragflow)
[![Web](https://img.shields.io/badge/web-React%2018%20%2B%20TypeScript-61dafb.svg)](web)
[![Engine](https://img.shields.io/badge/engine-Python%20%2B%20Go-3776ab.svg)](rag)
[![Deploy](https://img.shields.io/badge/deploy-Docker%20Compose-2496ed.svg)](docker)

</div>

## What this is

`JL_RAG` is the knowledge backend of 金流智能 ERP. It powers four ERP modules — knowledge spaces, knowledge documents, the assistant and Q&A audit — with document parsing, vector retrieval and grounded answer generation.

It is a fork of the open-source RAG engine [RAGFlow](https://github.com/infiniflow/ragflow) (v0.26.4). The upstream engine is kept intact — DeepDoc parsing, template based chunking, hybrid retrieval, agent orchestration and memory — while the product layer (branding, Chinese UI, capability pruning, and a full rework of the workbench interactions) is rebuilt for this project.

- Retrieval scope = space ACL ∩ business-object visibility ∩ documents that are `READY` and `is_current`.
- Every question is audited on the ERP side (`kb_query_audit`: trace id, status, latency, citations).

## Where it sits

| Layer | Component | Address | Notes |
| --- | --- | --- | --- |
| ERP web | `JL_ERP/ruoyi-ui` (Vue 3 + Vite) | <http://127.0.0.1:8081/> | business workbench, `/dev-api` proxied to the backend |
| ERP backend | `JL_ERP` (Spring Boot) | <http://127.0.0.1:18085> | `ruoyi-knowledge` calls the HTTP API of this repository |
| RAG workbench | this repo, `web/` (React) | <http://127.0.0.1:18081/> | knowledge bases, chat, search, agents, memory, files |
| RAGFlow API | this repo, `rag/` + `internal/`, `cmd/` | <http://127.0.0.1:9380> | health check at `/api/v1/system/version` |
| Dependencies | MySQL 8 / Elasticsearch 8.11 / MinIO / Valkey | Docker network | provided by `docker/docker-compose.yml` |

## Changes on top of upstream

39 commits ahead of RAGFlow upstream, in three groups:

| Area | What changed |
| --- | --- |
| Brand & language | fully Chinese UI; branding unified as 金流 RAG; upstream promo links and logo removed; navigation trimmed to the capabilities the backend actually exposes |
| Workbench | animated GooeyNav header and home shortcut rail; knowledge-base cards rebuilt as CSS 3D disk / matchbox sleeves that slide out on hover; pixel-curtain search result cards; chat as bubble cards with a liquid-metal reply bubble; random "thinking orbs" with elapsed time; memory cards as 3D turntables; glass folder cards in file management; grid transitions for the composer and results to remove dropped frames |
| Capabilities & fixes | multi-agent team collaboration, task delegation and context compression (see [`docs/develop/agent_team_delegation_zh.md`](docs/develop/agent_team_delegation_zh.md)); session titles generated from the first question; inline AI-summary switch with model/strength selection in the search bar; temperature / Top P / penalties restored; agent card clicks fixed; Langfuse save failures no longer reported as an expired session |

## Features

| Module | Capability |
| --- | --- |
| Knowledge base (dataset) | parser, chunking template and embedding configuration; metadata and tag sets; RAPTOR, knowledge graph, TOC extraction, PageRank |
| Documents | upload and parse progress, chunk preview/editing, batch move/delete, multi-KB linking |
| Retrieval & QA | vector / keyword / hybrid retrieval test, similarity thresholds, citation tracing; chat assistant with multiple models, variables and AI summary |
| Agents | visual workflow canvas, parser/chunker/indexer/retrieval/tool components, import & export, web embedding |
| Memory | conversation memory configuration, memory list and message pages |
| System | model providers and API keys, team members and resource sharing, system status and migration |

## Tech stack

- **Web** `web/`: React 18 + TypeScript + Vite + Tailwind CSS + Radix/shadcn; zustand and TanStack Query for state; `@xyflow/react` for the canvas; Monaco / Lexical editors; i18next for i18n.
- **Retrieval engine** `rag/`: Python — parsing (DeepDoc), chunking, hybrid retrieval, LLM calls.
- **Service layer** `internal/`, `cmd/`, `api/`: Go — HTTP API and task scheduling.
- **Deployment**: Docker Compose with the `infiniflow/ragflow:v0.26.4` (CPU) image.

## Getting started

### With the ERP (recommended)

From `E:\金流epr`, the one-shot script checks Docker, brings up the RAGFlow stack plus MySQL/Redis and then starts the ERP backend and web:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-all.ps1
# extra flags: -UiPort, -BackendPort, -RagWebPort 18082
```

### RAGFlow only

```bash
cd docker
# adjust .env (image registry, ports, memory) first
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml ps
```

Then open <http://127.0.0.1:18081/> and check <http://127.0.0.1:9380/api/v1/system/version>.

On first launch create the administrator, configure LLM / Embedding / Rerank providers (Ollama works, see `docs/guides/models/llm_api_key_setup.md`) and issue an API key for the ERP backend.

## How the ERP talks to it

`ruoyi-knowledge` calls the RAGFlow HTTP API with an API key:

| Capability | Endpoint |
| --- | --- |
| Knowledge spaces (datasets) | `POST/GET/DELETE /api/v1/datasets` |
| Document upload / parse / delete | `/api/v1/datasets/{dataset_id}/documents`, `.../parse` |
| Retrieval | `POST /api/v1/retrieval` |
| Assistant sessions | `POST/GET /api/v1/chats`, `POST /api/v1/chat/completions` |

## Repository layout

```
JL_RAG/
├── web/            # React workbench (knowledge bases, chat, search, agents, memory, files)
├── rag/            # Python engine: parsing, chunking, retrieval, LLM, DeepDoc
├── internal/       # Go service implementation (API, tasks, scheduling)
├── cmd/            # Go entry points
├── api/            # server-side API definitions
├── deepdoc/        # deep document understanding
├── agent/          # agent components and sandbox
├── docker/         # compose files, .env, nginx, init SQL
├── docs/           # guides / administrator / develop
├── sdk/            # Python and Go SDKs
├── mcp/            # MCP server
└── conf/           # service configuration templates and model list
```

## Documentation

- Guides: `docs/guides/` (datasets, files, chat, agents, memory, team permissions)
- Administration: `docs/administrator/` (configuration, backup and migration, CLI)
- Development: `docs/develop/` (build from source, MCP, switching document engines, agent team delegation)
- Upstream docs: <https://ragflow.io/docs/dev/>

## Acknowledgements & license

Built on [RAGFlow](https://github.com/infiniflow/ragflow), licensed under the **Apache License 2.0**; `LICENSE` and the original copyright notices are kept. Thanks to the RAGFlow team and all upstream contributors.
