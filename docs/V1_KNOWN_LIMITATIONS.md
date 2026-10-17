# AgentForge V1 — Known Limitations & System Boundaries

This document provides a transparent, truthful inventory of known technical constraints, platform dependencies, provider quota budgets, and architectural boundaries in AgentForge V1.

---

## 1. External Provider Quota Budgets & Rate Limits

### A. YouTube Data API v3
- **Daily Default Quota:** 10,000 quota units per project per calendar day (resets at midnight Pacific Time).
- **Operation Costs:**
  - `channel-inspect` (channels.list): 1 unit
  - `channel-metadata` (channels.list): 1 unit
  - `video-list` (playlistItems.list): 1 unit
  - `video-upload` (videos.insert): **1,600 units**
- **Budget Implication:** Under default Google Cloud quotas, a single AgentForge project can perform a maximum of 6 video uploads per 24-hour cycle before receiving `quotaExceeded (HTTP 403)`.
- **Handling in AgentForge:** YouTubeExecutor distinguishes quota errors (`quotaExceeded`) from authentication failures, advises the user of daily quota reset timing, and aborts without repeating failed upload chunks.

### B. GitHub REST & GraphQL API
- **Rate Limits:**
  - Authenticated requests with `GITHUB_TOKEN`: 5,000 requests per hour per user.
  - Unauthenticated requests: 60 requests per hour per IP.
- **Handling in AgentForge:**
  - Read actions (`repo-info`, `status-check`, `branch-list`, `log-inspect`, `diff-review`) execute through local `git` CLI whenever possible, consuming **0 API quota units**.
  - Remote release queries and issue creation fall back to explicit `GITHUB_TOKEN` requirement when remote inspection is needed.

### C. Cloud & AI Search Endpoints (Brave, Tavily, AWS, Stripe)
- Third-party endpoints require active accounts and pre-configured API keys.
- If keys are missing, AgentForge reports `unconfigured` state honestly rather than simulating mock API responses.

---

## 2. Operating System & Security Architecture

### A. Credential Storage & Encryption
- **Windows:** Leverages native Windows Data Protection API (DPAPI via `CryptProtectData` and `CryptUnprotectData`). Tokens and secrets are bound to the local Windows user profile and cannot be decrypted by other user accounts on the same machine.
- **macOS & Linux:** DPAPI is unavailable. AgentForge falls back to machine-derived PBKDF2/AES-256-GCM encrypted file storage. For enterprise deployments, hardware security module (HSM) or system keychain integration can be configured.

### B. OAuth Loopback Redirect Server
- RFC 8252 Native Desktop flow requires binding a temporary loopback HTTP server to `127.0.0.1:8910` (or an ephemeral high port).
- **Firewall & Proxy Considerations:**
  - Corporate VPNs or local HTTP proxies configured to intercept all localhost traffic may reject loopback socket connections.
  - Users with restrictive software firewalls must permit loopback traffic on `127.0.0.1`.

---

## 3. Workflow Engine & Idempotency Boundaries

### A. Non-Idempotent Operations and Crash Recovery
- Operations classified as `publish` (e.g. YouTube video upload, Git release tag creation) or `destructive` (e.g. file deletion, branch deletion) have real-world remote side effects.
- If a socket drops or an ambiguous timeout occurs during execution, AgentForge **strictly disables automatic retry**. Instead, the run enters `needs_reconciliation` state.
- **Operator Requirement:** The operator must verify remote state (e.g. check if the video was received by YouTube) before selecting `mark_completed`, `mark_failed`, or `retry_after_verification`.

### B. Step Input Reference Scope
- Step reference syntax (`$steps.<stepId>.output.<field>` and `{{steps.<stepId>.output.<field>}}`) only resolves values from steps that have already reached `completed` status.
- Forward references or references to failed/skipped steps throw a descriptive reference error during input resolution.

---

## 4. MCP Ecosystem & Transport Boundaries

### A. STDIO Transport Subprocesses
- stdio-based MCP servers spawn local child processes (`npx`, `python`, `node`, `docker`).
- If the host system lacks Node.js, Python, or Docker, stdio MCP servers requiring those runtimes will fail to spawn.
- AgentForge's `CapabilityTruthEngine` inspects runtime tool availability on PATH and reports unexecutable MCP servers as `not executable on host`.

### B. HTTP Transport Latency & Network Timeouts
- Remote HTTP MCP servers are subject to network latency and firewall ingress.
- Default request timeout is set to 15,000ms. Operations on slow external endpoints may require configuring a higher `timeoutMs` in server settings.

---

## 5. Universal MCP Presets & External Verification Boundaries

### A. Verification Tier Distinction
- **Listed & Schema-Validated (52 / 52):** All 52 presets in `src/mcp/presets.ts` are verified for complete metadata, unique kebab-case IDs, valid transport settings (`stdio` or `http`), HTTP/HTTPS documentation/repository URLs, valid command/argument structures, and sample-tool permission declarations.
- **Hermetic Test Isolation (0 / 52 package downloads during test suite):** To ensure offline test reliability, security, and reproducible builds, automated CI/local test runs do NOT execute network package installations (`npx -y ...`, `uvx ...`) or spawn arbitrary third-party executables.
- **Runtime Client Verification:** The MCP client runtime (`McpManager`, stdio protocol handling, JSON-RPC 2.0 handshake, tool listing, tool invocation, ping, and credential masking) is verified against a controlled local stdio child process.
- **Live Provider Verification:** Third-party cloud presets (e.g. AWS, Slack, Jira, Stripe, Notion, Tavily) require valid external provider API tokens. Without active credentials, their status is truthfully reported as `unconfigured` external prerequisites rather than live verified.

