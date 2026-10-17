# Changelog

All notable changes to **AgentForge** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - Unreleased (Target Release Qualified)

### Added
- **Universal MCP Presets (Phase 3):**
  - Curated catalog of 52 verified MCP server presets across 12 distinct categories.
  - Stdio and HTTP transport execution with permission inference and environment schema validation.
- **25 Native Service Adapters (Phase 4):**
  - Standardized `BaseIntegrationAdapter` framework with health checks and schema enforcement.
  - 25 native adapters covering Filesystem, HTTP, SQLite, Git, YouTube, Docker, Cloudflare, S3, PostgreSQL, Redis, MongoDB, Slack, Discord, Notion, Jira, Linear, Sentry, Stripe, Twilio, SendGrid, Brave Search, Tavily, and Working Memory.
  - 26 validated bridge manifests in `bridges/`.
- **15 Advanced Platform Features (Phase 5):**
  - Workflow dynamic step conditions, pipe transformation filters, env interpolation, timeout overrides, cleanup compensation hooks, dry-run mode.
  - Cryptographic audit hash chain (SHA-256) with tamper detection, timing-safe webhook ingress (`crypto.timingSafeEqual`), token-bucket rate limiter, scoped delegation tokens, encrypted vault backup/restore.
  - Adapter health monitoring, interactive step debugging, Antigravity skill generator, structured run artifacts.
- **4 Flagship Production Workflows (Phase 6):**
  - Autonomous Release Pipeline (`wf-autonomous-release`).
  - Multi-Channel Content Publishing (`wf-multichannel-publish`).
  - Incident Response & Triage (`wf-incident-triage`).
  - Data Pipeline & Local Database Sync (`wf-data-pipeline-sync`).
- **Local Manager UI Redesign:**
  - Complete dark/light tokenized theme with persistent local storage.
  - 12 operational views providing real-time diagnostics, visual workflow execution, and approval gates.
- **Open-Source Maintenance Infrastructure:**
  - GitHub issue templates for bug reports and feature requests.
  - Pull request template with security and local-first checklists.
  - Contributor Covenant Code of Conduct v2.1.
  - Release engineering guide, support/diagnostics guide, and multi-version roadmap.

---

## [0.2.0] - 2026-10-17


### Added
- **Production Google OAuth Readiness (Milestone 7.2):**
  - Native Desktop RFC 8252 authorization with SHA-256 PKCE code challenge and verifier.
  - Zero-configuration publisher discovery via bundled `publisher-client.json` or binary release constant.
  - Placeholder client ID blocker (`client-validator.ts`) preventing malformed authorization requests.
  - Interactive loopback callback server (`http://127.0.0.1:8910/callback`) with detailed in-browser error classification (`access_denied`, `invalid_client`, `org_internal`, `unauthorized_client`).
  - Incremental OAuth scope authorization (minimal `openid`, `email`, `profile` default; `youtube.readonly` and `youtube.upload` on demand).
- **YouTube Publishing Bridge (Milestone 6A, 6B, 6C):**
  - Real YouTube Data API v3 operations: `channel-inspect`, `channel-metadata`, `video-list`.
  - Resumable video upload (`video-upload`) with local file existence, readability, size, and SHA-256 tamper verification.
  - Video quota cost tracking (1,600 units per upload) and secret-redacted error handling.
  - Input-bound approval requirement before initiating video uploads.
- **Custom Bridge Builder (Milestone 7):**
  - Natural language template generation for `generic-service`, `github-repo`, and `local-files`.
  - Static security analyzer detecting `eval()`, shell interpolation, path traversal, and hardcoded tokens.
  - Isolated test execution in sandbox directories with staged promotion lifecycle (`draft` -> `testing` -> `awaiting-review` -> `approved` -> `active`).
  - Mandatory operator approval identity required for bridge registration.
- **External MCP Integration & Client Manager:**
  - Support for `stdio` (subprocess execution) and `sse`/`http` transports with JSON-RPC 2.0.
  - Automatic tool permission inference (`read`, `local-write`, `external-write`, `publish`, `destructive`).
  - Direct execution in workflows using `mcp:<server_id>` action routing.
- **Durable Workflow Orchestration:**
  - Input-bound approval checkpoints (`paused_for_approval`) bound to exact argument hashes.
  - Chained step reference resolution (`$steps.<id>.output.<field>` and `{{...}}`) with structured object preservation.
  - Cooperative workflow cancellation via `AbortController`.
  - Non-idempotent crash and retry recovery.
- **Release Safety & Credential Isolation (Milestone 7.3):**
  - Windows DPAPI storage and AES-256-GCM fallback writing strictly to user APPDATA/config outside the repository.
  - Test sandbox credential isolation ensuring test suites never touch host user credentials.
  - Zero-leak secret scan verification across all files and git history.
  - Sanitized templates: `publisher-client.example.json`, `google-client.example.json`, `.env.example`.

---

## [0.1.0] - 2026-10-15

### Added
- **Core Capability Harness:**
  - Bridge manifest schema validation (`schema: "1.0"`).
  - Deterministic permission manager with 5-tier classification.
  - Step executor registry with local Git CLI execution (`repo-info`, `status-check`, `branch-list`, `log-inspect`, `diff-review`, `release-verify`).
  - Local Manager web dashboard (`manager/index.html`) on port 9470 with REST endpoints.
  - Antigravity plugin manifest (`plugin.json`), agent rules (`rules/AGENTS.md`), and skill instructions (`skills/agentforge/SKILL.md`).
  - Unified catalog engine merging native bridges and tools.
