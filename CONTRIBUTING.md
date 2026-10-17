# Contributing to AgentForge

Thank you for your interest in contributing to **AgentForge**! We welcome contributions from the community to expand capabilities, improve developer workflows, and strengthen local-first security.

---

## 1. Core Architecture Philosophy

Before submitting contributions, please understand AgentForge's guiding architecture:

1. **Antigravity is the Primary Reasoning Agent:** AgentForge does not attempt to be an autonomous decision engine or replace Antigravity's cognitive loop. Instead, AgentForge serves as a local capability, integration, and security harness.
2. **Local-First & OS-Protected:** All credentials, tokens, and authorization states are stored locally using OS-native encryption (Windows DPAPI with AES-256-GCM fallback). No external relay servers or central proxies are permitted.
3. **Explicit Operator Approvals:** Actions with external side effects (`publish`, `external-write`, `destructive`) require deterministic approval checkpoints. Approvals are strictly bound to exact inputs, actions, and operator identities.
4. **Verifiable Truthfulness:** Bridges, status commands, and error handlers must report actual execution states, HTTP response codes, and genuine blockers. Never return fabricated success responses or mock strings as live data.

---

## 2. Development Setup

### Prerequisites
- **Node.js:** `>= 20.0.0` (LTS recommended)
- **Git:** `>= 2.30.0`
- **Operating System:** Windows, macOS, or Linux (Windows DPAPI storage is verified natively on Windows; encrypted file storage is used on Linux/macOS).

### Quick Start
```bash
# 1. Clone the repository
git clone https://github.com/HamzaShaikhAI/AgentForge.git
cd AgentForge

# 2. Install dependencies
npm ci

# 3. Compile TypeScript
npm run build

# 4. Run the full test suite
npm test

# 5. Type-check without emitting
npm run typecheck
```

---

## 3. Repository Structure

```
AgentForge/
├── bridges/                # Production bridge definitions (manifests)
│   ├── example/            # Example echo bridge for testing
│   ├── github/             # Local Git CLI & GitHub REST bridge
│   └── youtube/            # YouTube Data API v3 bridge
├── manager/                # Web dashboard assets
│   └── index.html          # Single-page local control surface
├── rules/                  # Always-on Antigravity agent rules
│   └── AGENTS.md           # Mandatory security & approval rules
├── skills/                 # Antigravity skill definitions
│   └── agentforge/         # Skill progressive disclosure & instructions
├── src/                    # TypeScript source code
│   ├── auth/               # Google OAuth, DPAPI store, publisher config, redaction
│   ├── builder/            # Custom Bridge Builder & security analyzer
│   ├── cli/                # Unified command-line interface
│   ├── executors/          # Step executors (Git, YouTube, router)
│   ├── manager/            # Manager HTTP server and REST endpoints
│   ├── mcp/                # External MCP client manager (stdio / HTTP)
│   ├── bridge-registry.ts  # Bridge manifest loading and cataloging
│   ├── bridge-validator.ts # Schema validation for bridge manifests
│   ├── catalog.ts          # Unified capability catalog
│   ├── permissions.ts      # Permission engine and approval checkpoints
│   ├── types.ts            # Shared TypeScript interfaces
│   └── workflow-engine.ts  # Multi-step workflow orchestration
├── docs/                   # Detailed subsystem documentation
└── test/                   # Co-located unit and regression tests (*.test.ts)
```

---

## 4. Development Guidelines

### Adding or Modifying Bridges
- Bridge manifests must conform to `schema: "1.0"` defined in [`src/types.ts`](src/types.ts).
- Every declared action must map to an executable method in its respective executor. If an action is planned but not yet implemented, document it clearly as planned in `docs/INTEGRATIONS.md`.
- Never hardcode credentials in bridge manifests or source code. Reference credentials only by environment variable names or OAuth provider IDs.

### Secret Handling & Test Fixtures
- **Automated Scanning:** All pull requests are scanned for credential patterns (OAuth access tokens `ya29.*`, refresh tokens `1//*`, client secrets `GOCSPX-*`, GitHub tokens `ghp_*`).
- **Dummy Test Data:** When writing unit tests for redaction or error handling, always prefix dummy test fixtures with `mock-` or `test-` (e.g., `'ya29.mock-sample-token-123'`). Never use realistic-looking base64 strings that trigger external scanner false positives.

### Storage Isolation in Tests
- Tests must never access or modify real user credentials in `%APPDATA%\AgentForge\auth\` or `~/.config/agentforge/auth/`.
- Ensure tests run with `process.env.AGENTFORGE_CREDENTIALS_DIR` pointed to a temporary directory (`mkdtemp`), as configured in `vitest.config.ts`.

---

## 5. Pull Request Process

1. **Branch Naming:** Use descriptive branch names (e.g., `feature/custom-bridge-export`, `fix/oauth-loopback-port`).
2. **Quality Gates:** Before opening a pull request, ensure all local checks pass:
   ```bash
   npm run typecheck
   npm run build
   npm test
   npm pack --dry-run
   ```
3. **Commit Messages:** Follow standard conventional commit conventions (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
4. **Documentation:** If introducing new CLI options, API endpoints, or bridge capabilities, update the relevant files in `docs/` and `README.md`.

---

## 6. Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone. Please be respectful, constructive, and collaborative in all discussions and code reviews.
