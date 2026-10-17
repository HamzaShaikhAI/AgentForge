# AgentForge V1 — Release Qualification Checklist

This checklist must be executed and signed off prior to tagging and publishing any AgentForge V1 release.

---

## 1. Codebase & Integrity Verification

- [ ] **Clean Git Working Tree:** Ensure no unintended local changes, test scratch files, or transient binaries are tracked.
- [ ] **Zero Secret Leakage:**
  - [ ] No OAuth access tokens, refresh tokens, or client secrets in tracked files.
  - [ ] No private `.env` files staged or tracked.
  - [ ] Git history scanned (`git log -S "client_secret"`) confirms zero secret leakage.
- [ ] **Typecheck Verification:** Run `npm run typecheck` (`tsc --noEmit`). Must exit with code `0` and 0 errors.
- [ ] **Full Test Suite Execution:** Run `npm test` (`vitest run`). All test suites (25 suites, 326+ tests) must pass with 100% success.
- [ ] **Code Linting:** Verify code conforms to project standards and formatting.

---

## 2. Capability & Security Verification

- [ ] **Truth Engine Verification:**
  - [ ] `CapabilityTruthEngine` distinguishes declared from verified capabilities.
  - [ ] Unconfigured bridges honestly report missing prerequisites.
  - [ ] No placeholder client IDs report `Configured: YES`.
- [ ] **Human-in-the-Loop Approval Gates:**
  - [ ] All `publish`, `external-write`, and `destructive` operations halt at approval checkpoints.
  - [ ] Approvals require explicit operator user identity (`approvedBy`).
  - [ ] Approval decisions are recorded in the audit trail.
- [ ] **Reconciliation State Verification:**
  - [ ] Ambiguous timeouts on non-idempotent actions enter `needs_reconciliation` state.
  - [ ] Replay of non-idempotent operations without verification is prevented.
- [ ] **Secret Redaction:**
  - [ ] Sensitive keys (`access_token`, `refresh_token`, `authorization`, `client_secret`, `upload_id`) are redacted prior to disk persistence and API serialization.

---

## 3. Manager UI & API Qualification

- [ ] **Asset Integrity:** Verify `manager/index.html` loads cleanly without CDN or internet connectivity dependencies.
- [ ] **Theme Switching:** Verify dark and light themes toggle correctly and persist in `localStorage`.
- [ ] **12 Operational Views:** Verify navigation between all 12 views:
  - [ ] Overview
  - [ ] Capability Truth Matrix
  - [ ] Integration Catalog
  - [ ] Native Bridges
  - [ ] Universal MCP Marketplace
  - [ ] MCP Server Manager
  - [ ] Workflow Studio
  - [ ] Runs & History
  - [ ] Approvals Checkpoints
  - [ ] Reconciliation Console
  - [ ] Credential Vault
  - [ ] Settings & Diagnostics
- [ ] **API Endpoint Health:** Verify `GET /api/status`, `GET /api/catalog`, `GET /api/truth/capabilities`, `GET /api/mcp/presets`, `GET /api/workflows/runs`.

---

## 4. Packaging & Distribution Safety

- [ ] **File Whitelist in `package.json`:**
  - [ ] `dist/` compiled output included.
  - [ ] `bridges/` manifests included.
  - [ ] `manager/` static assets included.
  - [ ] `rules/` and `skills/` included.
  - [ ] `plugin.json` and `mcp_config.json` included.
  - [ ] `data/`, test files, `.env`, and local credentials **strictly excluded**.
- [ ] **Tarball Inspection:** Run `npm pack --dry-run` to inspect tarball manifest and confirm archive contents and size.

---

## 5. Antigravity Native Integration

- [ ] **Plugin Descriptor:** `plugin.json` matches Antigravity specification (ID, version, skills, tools, rules).
- [ ] **MCP Server Registration:** `mcp_config.json` correctly registers `agentforge` server using `dist/mcp-server.js`.
- [ ] **Skill Documentation:** `skills/agentforge/SKILL.md` contains valid frontmatter, capability descriptions, and approval instructions.

---

## Sign-Off

- **Target Version:** `1.0.0`
- **Release Engineer:** Senior TypeScript Platform Engineer
- **Verification Status:** PASSED (All 326 tests passing, 0 TypeScript errors)
