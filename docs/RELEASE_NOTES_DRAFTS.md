# AgentForge GitHub Release Notes Drafts

This file contains production-ready release note drafts for GitHub Releases.

---

## Draft: AgentForge V0 Developer Preview

**Tag:** `v0.1.0` (Proposed baseline)  
**Target Commit:** `05e37de` (`feat: prepare AgentForge V0 developer preview`)  
**Status:** Developer Preview Archive (Ready for tagging upon operator confirmation)

### Overview
AgentForge V0 establishes the foundational integration and capability runtime for Google Antigravity. It enables Antigravity to discover local tools, enforce deterministic execution boundaries, and execute multi-step workflows with human-in-the-loop approvals.

### Key Capabilities in V0
- **Bridge Manifest Schema:** Formal specification and validation for integration bridges (`schema: "1.0"`).
- **Deterministic Permission Model:** Strict 5-tier permission classification (`read`, `local-write`, `external-write`, `publish`, `destructive`).
- **Native Git Executor:** Safe local repository inspection, branch queries, commit log analysis, and release verification.
- **Workflow Orchestration Engine:** Multi-step DAG workflow execution with input-bound approval checkpoints (`paused_for_approval`).
- **Local Control Surface:** Lightweight single-page web dashboard on port 9470 (`manager/index.html`).
- **Antigravity Plugin Integration:** Native plugin manifest (`plugin.json`), agent rules (`rules/AGENTS.md`), and core skill instructions (`skills/agentforge/SKILL.md`).

---

## Draft: AgentForge V1.0.0 Production Release

**Tag:** `v1.0.0` (Target release)  
**Target Commit:** Staged master  
**Status:** **NOT RELEASED — PENDING INDEPENDENT VERIFICATION GATE & OPERATOR APPROVAL**

> **Note on Release Readiness:**  
> All 326 test cases are passing and the build is qualified. However, the official Google Cloud Desktop Client ID for zero-config Google sign-in is awaiting publisher registration in Google Cloud Console. Developer Mode remains available for local setups.

### What's New in V1
AgentForge V1 upgrades the developer preview into a full local-first integration, workflow, and capability platform for Google Antigravity.

#### 1. Universal MCP Ecosystem (52 Curated Presets)
- Curated catalog of 52 verified Model Context Protocol (MCP) server presets across 12 categories: Databases, Developer Tools, Cloud Infrastructure, Search, Communication, Productivity, APIs, Source Control, AI/ML, Google Workspace, and Browser Automation.
- Support for `stdio` and `http` transports with dynamic tool permission inference and runtime environment configuration.

#### 2. 25 Native Production Adapters
- Standardized `BaseIntegrationAdapter` framework with built-in health checks and schema enforcement.
- 25 native adapters covering Filesystem, HTTP, SQLite, Git, YouTube, Docker, Cloudflare, AWS S3, PostgreSQL, Redis, MongoDB, Slack, Discord, Notion, Linear, Jira, Sentry, Stripe, Twilio, SendGrid, Brave Search, Tavily, and Working Memory.
- 26 validated bridge manifests in `bridges/`.

#### 3. 15 Advanced Platform Features
- **Workflow Engine:** Dynamic step conditions, pipe transformation filters (`upper`, `lower`, `trim`, `json`, `length`), environment variable interpolation, step timeout overrides, cancellation cleanup hooks, and DAG dry-run validation.
- **Security & Governance:** Cryptographic audit hash chain (SHA-256) with tamper detection, timing-safe webhook ingress triggers (`crypto.timingSafeEqual`), token-bucket rate limiting, scoped delegation tokens, and PBKDF2/AES-256-GCM encrypted vault backup and restore.
- **Developer Observability:** Adapter health monitoring, interactive step-level debugging, Antigravity skill generation, and structured run artifacts/logs.

#### 4. Flagship Production Workflows
- **Autonomous Release Pipeline:** Full repository verification, changelog generation, and approval-gated tag publication.
- **Multi-Channel Publishing:** Asset validation, resumable YouTube video upload, and broadcast announcements to Slack and Discord.
- **Incident Response & Triage:** Sentry crash telemetry monitoring, condition evaluation, and automated GitHub issue creation.
- **Data Pipeline & Local Database Sync:** Filesystem dataset ingestion, local SQLite staging, HTTP notification, and guaranteed cleanup.

#### 5. Local Security & Zero-Configuration Google OAuth
- RFC 8252 loopback authorization on `127.0.0.1:8910` with SHA-256 PKCE verifiers.
- Automatic secret redaction filtering tokens, keys, and session URLs.
- Windows DPAPI credential protection with AES-256-GCM fallback outside the repository.

#### 6. Redesigned Local Manager Dashboard
- Complete dark/light tokenized theme with persistent local storage.
- 12 operational views providing real-time diagnostics, visual workflow status, and approval controls.

### Installation
```bash
git clone https://github.com/HamzaShaikhAI/AgentForge.git
cd AgentForge
npm install
npm run build
npm test
npm run manager
```
