# Hamza Shaikh

**Systems & Full-Stack TypeScript Software Engineer**  
Specializing in agentic runtime harnesses, local-first architectures, Model Context Protocol (MCP) ecosystems, and cryptographic security boundaries for Large Language Models.

GitHub: [@HamzaShaikhAI](https://github.com/HamzaShaikhAI) • Location: Pakistan • Focus: Local-First AI Infrastructure & Deterministic Execution

---

## Featured Project: AgentForge

### [AgentForge](https://github.com/HamzaShaikhAI/AgentForge)
*Local-first capability, integration, and deterministic workflow platform for Google Antigravity.*

AgentForge solves the "uncontrolled side-effects" problem in autonomous LLM reasoning. While reasoning models excel at high-level planning, executing arbitrary external actions poses severe security risks. AgentForge equips Antigravity with a secure, OS-protected capability runtime:

- **Universal MCP Presets (52 Presets):** Sourced and verified configurations across 12 categories supporting `stdio` and `http` transports with dynamic permission inference.
- **25 Native Service Adapters:** Standardized on `BaseIntegrationAdapter` covering Databases (PostgreSQL, SQLite, Redis, MongoDB), Cloud (AWS S3, Cloudflare), Developer Tools (Docker, Git, Sentry, Jira, Linear), and Communication (Slack, Discord, Notion).
- **Deterministic 5-Tier Permission Boundary:** Enforces mandatory operator approval checkpoints for high-risk operations (`external-write`, `publish`, `destructive`).
- **RFC 8252 Desktop OAuth & PKCE:** Direct loopback authorization on `127.0.0.1:8910` with SHA-256 PKCE code challenges, zero intermediate relays, and Windows DPAPI encrypted token storage.
- **Durable Workflow Orchestration:** Directed Acyclic Graph (DAG) workflow engine featuring dynamic step conditions, pipe transformation filters, non-idempotent crash recovery, and compensation cleanup hooks.
- **Local Control Surface:** Single-page Manager web dashboard (`http://localhost:9470`) with dark/light themes and 12 operational views.

[Explore Repository](https://github.com/HamzaShaikhAI/AgentForge) • [Architecture Guide](https://github.com/HamzaShaikhAI/AgentForge/blob/master/docs/ARCHITECTURE.md) • [CI Workflows](https://github.com/HamzaShaikhAI/AgentForge/actions)

---

## Technical Disciplines & Demonstrated Competencies

### 1. Agentic Systems & Model Context Protocol (MCP)
- Authored native Antigravity skills, plugin manifests (`plugin.json`), and system-level agent rules.
- Designed and built full MCP client lifecycle managers handling child process spawning, JSON-RPC 2.0 framing, capability negotiation, and dynamic tool routing.
- Curated and validated schemas for 52 universal MCP servers.

### 2. Applied Cryptography & Local-First Security
- **Native OS Protection:** Windows Data Protection API (DPAPI via `CryptProtectData`) integration with AES-256-GCM fallback for credential isolation.
- **RFC 7636 PKCE:** High-entropy code verifiers, S256 code challenge generation, and timing-safe state comparison (`crypto.timingSafeEqual`) to prevent timing attacks.
- **Audit Hash Chaining:** SHA-256 forward-linked cryptographic ledger detecting single-byte tampering in execution logs.
- **Scoped Delegation Tokens:** Time-bounded, HMAC-signed authorization tokens constraining bridge and action scope.

### 3. Distributed Workflow Orchestration
- DAG dependency resolution with cycle detection and topological sorting.
- Input-bound human approval checkpoints pausing execution until cryptographic approval is supplied.
- Failure reconciliation states (`needs_reconciliation`) ensuring non-idempotent operations (such as video uploads or Git tags) are never erroneously repeated after network drops.
- Rate-limiting via token-bucket algorithms with precise millisecond replenishment.

### 4. Rigorous Software Engineering & Testing
- Strict TypeScript codebase configured with `strict: true` and zero compiler warnings.
- 100% automated test coverage across 25 suites and 326 tests using `vitest`.
- Zero-leak packaging pipelines audited via `npm pack --dry-run` to ensure pristine distribution tarballs.

---

## Setup Instructions for Profile README

To activate this profile on GitHub:
1. Create a public repository named exactly `HamzaShaikhAI` on your GitHub account (`https://github.com/HamzaShaikhAI/HamzaShaikhAI`).
2. Add a `README.md` file in the root of that repository.
3. Paste the contents of this document into that `README.md`.
4. Commit and push. GitHub will automatically display this profile README on your user landing page (`https://github.com/HamzaShaikhAI`).
