# AgentForge V1 — Acceptance Traceability Matrix

This document provides a strict, verifiable mapping between every V1 requirement, its implementing code, corresponding automated test suites, and empirical verification evidence.

---

## 1. Core Platform Architecture & Security Foundation

| Requirement ID | Requirement Description | Implementation Files | Test Suites | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-TRUTH-01** | Truth Engine: Disambiguate declared vs verified capabilities; never report unverified credentials as operational | [`src/truth/capability-truth-engine.ts`](file:///C:/Users/win10/Documents/AgentForge/src/truth/capability-truth-engine.ts) | [`src/truth/capability-truth-engine.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/truth/capability-truth-engine.test.ts) | 7/7 tests passing; API endpoint `GET /api/truth/capabilities` returns live verification status |
| **REQ-RECON-02** | Workflow Engine: Ambiguous network errors on non-idempotent steps pause into `needs_reconciliation` state | [`src/workflow-engine.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflow-engine.ts) | [`src/workflow-reconciliation.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflow-reconciliation.test.ts) | 4/4 tests passing; prevents duplicate remote side effects; API `POST /api/workflows/runs/:id/reconcile` |
| **REQ-EXEC-03** | Step Executor Hardening: Point-of-execution input validation, configurable timeout timer cleanup, output secret redaction | [`src/executors/index.ts`](file:///C:/Users/win10/Documents/AgentForge/src/executors/index.ts) | [`src/permissions-execution.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/permissions-execution.test.ts) | 4/4 tests passing; validates schema prior to dispatch; redacts tokens matching sensitive regexes |
| **REQ-PERM-04** | Hierarchical Permission Enforcement: 5 distinct tiers (`read`, `local-write`, `external-write`, `publish`, `destructive`) | [`src/permissions.ts`](file:///C:/Users/win10/Documents/AgentForge/src/permissions.ts) | [`src/permissions.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/permissions.test.ts) | 12/12 tests passing; explicit human confirmation enforced on publish/destructive actions |

---

## 2. Manager UI & Operator Dashboard

| Requirement ID | Requirement Description | Implementation Files | Test Suites | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-UI-01** | Modern Design System: CSS design tokens, dynamic dark/light theme switching with `localStorage` persistence | [`manager/index.html`](file:///C:/Users/win10/Documents/AgentForge/manager/index.html) | [`src/manager/serve.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/manager/serve.test.ts) | 24/24 tests passing; validated theme attribute toggle and CSS variable binding |
| **REQ-UI-02** | 12 Required Operational Views: Overview, Truth Matrix, Catalog, Bridges, MCP Marketplace, MCP Manager, Studio, Runs, Approvals, Reconciliation, Vault, Settings | [`manager/index.html`](file:///C:/Users/win10/Documents/AgentForge/manager/index.html) | [`src/manager/serve.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/manager/serve.test.ts) | Single-page architecture with live sidebar navigation, view switching, and responsive viewport support |
| **REQ-UI-03** | Human-in-the-Loop Checkpoints: Interactive approval modal, reason rendering, input inspection, and decision recording | [`manager/index.html`](file:///C:/Users/win10/Documents/AgentForge/manager/index.html), [`src/manager/serve.ts`](file:///C:/Users/win10/Documents/AgentForge/src/manager/serve.ts) | [`src/manager/serve.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/manager/serve.test.ts) | Approvals view exposes real-time pending approvals, approval decisions record actor identity |

---

## 3. Universal MCP Ecosystem ($\ge 50$ Curated Presets)

| Requirement ID | Requirement Description | Implementation Files | Test Suites | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-MCP-01** | Verified Preset Catalog: $\ge 50$ fully sourced, structured, versioned MCP presets across 8 mandated categories | [`src/mcp/presets.ts`](file:///C:/Users/win10/Documents/AgentForge/src/mcp/presets.ts) | [`src/mcp/presets.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/mcp/presets.test.ts), [`src/catalog.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/catalog.test.ts) | Exactly 52 unique presets; 100% verified schema compliance across 12 categories; stdio MCP runtime tested via local child process; external services require credentials |
| **REQ-MCP-02** | Transport Support & Management: stdio and http transports, tool discovery, dynamic registration, one-click installation | [`src/mcp/mcp-manager.ts`](file:///C:/Users/win10/Documents/AgentForge/src/mcp/mcp-manager.ts), [`src/catalog.ts`](file:///C:/Users/win10/Documents/AgentForge/src/catalog.ts) | [`src/mcp/mcp-manager.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/mcp/mcp-manager.test.ts) | 8/8 tests passing; auto-generates executable server configs from presets; masks credentials |

---

## 4. Native Integrations ($\ge 20$ Adapters with `BaseIntegrationAdapter`)

| Requirement ID | Requirement Description | Implementation Files | Test Suites | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-ADAPT-01** | Reusable Adapter Contract: `BaseIntegrationAdapter` abstract class enforcing health checks, action metadata, schema validation, permissions | [`src/adapters/base-adapter.ts`](file:///C:/Users/win10/Documents/AgentForge/src/adapters/base-adapter.ts) | [`src/adapters/adapters.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/adapters/adapters.test.ts) | 9/9 tests passing; verified across all 25 native adapters |
| **REQ-ADAPT-02** | 25 Native Production Adapters: Local Filesystem, HTTP Client, SQLite, Git & GitHub CLI, YouTube Data API, Docker, GitHub API, GitLab, Jira, Linear, Sentry, AWS S3, Cloudflare, PostgreSQL, Redis, MongoDB, Slack, Discord, Notion, SendGrid, Twilio, Brave Search, Tavily, Working Memory, Stripe | `src/adapters/*.ts` | [`src/adapters/adapters.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/adapters/adapters.test.ts) | 25 distinct adapters implemented, auto-registered with `StandardStepExecutor` |
| **REQ-BRIDGE-03** | Validated Bridge Manifests: Complete `bridge.json` definitions in `bridges/` conforming to `BridgeValidator` schema | `bridges/*/bridge.json` | [`src/bridge-registry.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/bridge-registry.test.ts), [`src/bridge-validator.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/bridge-validator.test.ts) | 26 loaded bridge manifests in registry with 0 validation errors |

---

## 5. 15 Product Features with Acceptance Criteria

| Feature # | Feature Name | Implementation File | Verification Test Suite | Acceptance Evidence |
| :---: | :--- | :--- | :--- | :--- |
| **F-01** | Dynamic Step Conditions | [`src/workflow-engine.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflow-engine.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Safe expression evaluation (`==`, `!=`, `>`, `<`, `!`, truthy); skips step without failure |
| **F-02** | Output Transformation & Filters | [`src/workflow-engine.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflow-engine.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Pipe filters supported: `\| upper`, `\| lower`, `\| trim`, `\| json`, `\| length` |
| **F-03** | Workflow Env Interpolation | [`src/workflow-engine.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflow-engine.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Interpolates `${env:VAR}` and `{{env.VAR}}` safely from runtime environment |
| **F-04** | Step Timeout Override | [`src/workflow-engine.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflow-engine.ts), [`src/executors/index.ts`](file:///C:/Users/win10/Documents/AgentForge/src/executors/index.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Per-step `timeoutMs` enforced with timer cancellation to prevent dangling handles |
| **F-05** | Cancellation / Compensation Hooks | [`src/workflow-engine.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflow-engine.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | `cleanup: true` steps execute reliably during workflow cancellation or step failure |
| **F-06** | Workflow Dry-Run Mode | [`src/workflow-engine.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflow-engine.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Validates DAG, step order, missing credentials, approval gates, and idempotency |
| **F-07** | Cryptographic Audit Hash-Chain | [`src/audit/audit-chain.ts`](file:///C:/Users/win10/Documents/AgentForge/src/audit/audit-chain.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | SHA-256 chain; detects data tampering; supports query filters, JSON export/import |
| **F-08** | Webhook Ingress Trigger | [`src/triggers/webhook-ingress.ts`](file:///C:/Users/win10/Documents/AgentForge/src/triggers/webhook-ingress.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Timing-safe HMAC SHA-256 verification (`crypto.timingSafeEqual`); routes to workflow |
| **F-09** | Token-Bucket Rate Limiter | [`src/governance/rate-limiter.ts`](file:///C:/Users/win10/Documents/AgentForge/src/governance/rate-limiter.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Configurable capacity and refill rate; non-blocking tryAcquire and queueable acquire |
| **F-10** | Scoped Delegation Tokens | [`src/governance/delegation-tokens.ts`](file:///C:/Users/win10/Documents/AgentForge/src/governance/delegation-tokens.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | HMAC-SHA256 signed tokens; bounds bridges, actions, max permission level, and TTL |
| **F-11** | Encrypted Vault Backup & Restore | [`src/auth/vault-backup.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/vault-backup.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | PBKDF2 (100,000 iter) + AES-256-GCM; inspects metadata; rejects wrong passphrases |
| **F-12** | Adapter Health Polling & Metrics | [`src/adapters/health-monitor.ts`](file:///C:/Users/win10/Documents/AgentForge/src/adapters/health-monitor.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Tracks latency, consecutive failures, and state transitions (`healthy`, `degraded`, etc.) |
| **F-13** | Step-by-Step Interactive Debugger | [`src/debugger/step-debugger.ts`](file:///C:/Users/win10/Documents/AgentForge/src/debugger/step-debugger.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Breakpoints, pause, input inspection & mutation at breakpoint, step-over, resume |
| **F-14** | Antigravity Skill Generator | [`src/antigravity/skill-generator.ts`](file:///C:/Users/win10/Documents/AgentForge/src/antigravity/skill-generator.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Generates valid Antigravity `SKILL.md` documents from any bridge manifest or workflow |
| **F-15** | Run Artifacts & Log Streaming | [`src/audit/run-artifacts.ts`](file:///C:/Users/win10/Documents/AgentForge/src/audit/run-artifacts.ts) | [`src/features-v1.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/features-v1.test.ts) | Attaches output artifacts; streams structured execution logs in real-time |

---

## 6. Flagship End-to-End Workflows

| Workflow Name | Workflow ID | Purpose & Key Steps | Verification Test Suite | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **Autonomous Release Pipeline** | `wf-autonomous-release` | Git metadata inspect $\rightarrow$ status check $\rightarrow$ package manifest verify $\rightarrow$ changelog prepare $\rightarrow$ tag release $\rightarrow$ approval gate $\rightarrow$ push tags | [`src/workflows/flagship.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflows/flagship.test.ts) | Pauses before remote push; executes local git commands safely |
| **Multi-Channel Publishing** | `wf-multichannel-publish` | Stat asset file $\rightarrow$ approval gate $\rightarrow$ YouTube resumable upload $\rightarrow$ Discord announce $\rightarrow$ Slack announce | [`src/workflows/flagship.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflows/flagship.test.ts) | Enforces publish approval; preserves asset inputs; coordinates multi-channel broadcast |
| **Incident Response & Triage** | `wf-incident-triage` | Sentry crash poll $\rightarrow$ conditional evaluation $\rightarrow$ approval gate $\rightarrow$ GitHub issue open $\rightarrow$ Slack alert | [`src/workflows/flagship.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflows/flagship.test.ts) | Evaluates step condition dynamically; pauses for approval on external-write |
| **Data Pipeline & Sync** | `wf-data-pipeline-sync` | Read dataset $\rightarrow$ inspect SQLite schema $\rightarrow$ external HTTP notify $\rightarrow$ guaranteed cleanup | [`src/workflows/flagship.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/workflows/flagship.test.ts) | End-to-end execution completes with cleanup hook verified |

---

## 7. Google OAuth & YouTube Publishing Security

| Security Boundary | Specification | Implementation Files | Test Suites | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **PKCE & State Validation** | RFC 7636 (S256 code challenge) & RFC 6749 state parameter | [`src/auth/google-oauth.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/google-oauth.ts) | [`src/auth/google-oauth.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/google-oauth.test.ts) | 47/47 tests passing; state and verifier generated cryptographically per session |
| **Loopback Redirect URI** | RFC 8252 Section 7.3 loopback interface on `127.0.0.1` | [`src/auth/google-oauth.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/google-oauth.ts) | [`src/auth/google-oauth.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/google-oauth.test.ts) | Rejects non-loopback redirects; prevents port conflicts |
| **Encrypted Token Storage** | OS-level DPAPI on Windows (`CryptProtectData`), AES-256 fallback on Linux/macOS | [`src/auth/credential-store.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/credential-store.ts) | [`src/auth/credential-store.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/credential-store.test.ts) | 5/5 tests passing; DPAPI protects tokens at rest |
| **Zero-Config vs Dev Mode** | Clean precedence: Verified Publisher Client $\rightarrow$ Developer Mode $\rightarrow$ Unconfigured | [`src/auth/publisher-config.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/publisher-config.ts) | [`src/auth/publisher-config.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/publisher-config.test.ts) | 17/17 tests passing; rejects placeholders; reports honest configuration status |
| **Secret Redaction** | Strips API keys, access tokens, refresh tokens, auth headers, and upload URLs | [`src/auth/redact.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/redact.ts) | [`src/auth/redact.test.ts`](file:///C:/Users/win10/Documents/AgentForge/src/auth/redact.test.ts) | 5/5 tests passing; redactObject invoked prior to disk persistence and API serialization |
