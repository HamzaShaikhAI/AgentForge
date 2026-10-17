# AgentForge

**Extensible Capability Harness for Google Antigravity**

AgentForge is an Antigravity plugin that adds bridge-based integrations, multi-step workflows, approval policies, and a local manager dashboard. Antigravity remains the reasoning agent and primary interface — AgentForge supplies reusable capabilities, permission enforcement, and verifiable execution results.

## Quick Start

### Prerequisites

- **Node.js** 20+ (tested with v24.12.0)
- **Git** (for the GitHub bridge)
- **Google Antigravity** installed

### Install & Build

```bash
# Clone or navigate to the project
cd AgentForge

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test
```

### Install as Antigravity Plugin

**Option A: Symlink (recommended for development)**

```powershell
# Windows (PowerShell, run as Administrator)
New-Item -ItemType Junction -Path "$env:USERPROFILE\.gemini\config\plugins\agentforge" -Target "$PWD"
```

```bash
# macOS / Linux
ln -s /path/to/AgentForge ~/.gemini/config/plugins/agentforge
```

**Option B: Copy**

```bash
cp -r AgentForge ~/.gemini/config/plugins/agentforge
```

After installing, **restart Antigravity** for the plugin to be discovered.

### Install from GitHub (when available)

```bash
git clone https://github.com/<owner>/AgentForge.git
cd AgentForge
npm install && npm run build
# Then symlink or copy to ~/.gemini/config/plugins/agentforge
```

## Architecture

```
AgentForge/
├── plugin.json              # Antigravity plugin manifest
├── skills/
│   └── agentforge/
│       └── SKILL.md         # AgentForge skill for Antigravity
├── rules/
│   └── AGENTS.md            # Always-on security rules
├── bridges/                 # Bridge definitions
│   ├── github/
│   │   └── bridge.json      # GitHub bridge manifest
│   └── example/
│       └── bridge.json      # Example echo bridge (for testing)
├── src/                     # Core TypeScript library
│   ├── types.ts             # Type definitions & bridge schema
│   ├── bridge-validator.ts  # Manifest validation
│   ├── bridge-registry.ts   # Discovery & registry
│   ├── workflow-engine.ts   # Multi-step workflow execution
│   ├── permissions.ts       # Approval policy enforcement
│   ├── manager/
│   │   └── serve.ts         # Manager dashboard server
│   └── *.test.ts            # Test files
├── manager/
│   └── index.html           # Manager dashboard UI
└── data/                    # Runtime state (gitignored)
```

## Key Concepts

### Bridges

A **bridge** is a validated integration definition stored as `bridges/<name>/bridge.json`. Each bridge defines:

- **Capabilities** — actions it can perform (e.g., `repo-info`, `push-commits`)
- **Integrations** — required tools and services (e.g., `git`, `gh` CLI)
- **Authentication** — credentials referenced by env var name (never plaintext)
- **Permissions** — approval tiers for each action
- **Tests** — how to verify the bridge works

### Permission Tiers

| Level | Default Policy | Examples |
|-------|---------------|----------|
| `read` | Always allowed | List repos, check status |
| `local-write` | Allowed by default | Create local files |
| `external-write` | **Requires approval** | Push commits |
| `publish` | **Requires approval** | Create releases |
| `destructive` | **Requires approval** | Delete branches |

### Workflows

Antigravity can combine bridge capabilities into multi-step workflows with:
- Ordered steps with dependency tracking
- Permission checks at each step
- Retry logic for transient failures
- Error reporting with safe stopping
- Timestamped execution results

## Commands

| Command | Description |
|---------|-------------|
| `npm run cli -- <args>` | Execute the unified AgentForge CLI |
| `npm run auth -- status` | Check authentication mode and connection status |
| `npm run auth -- google` | Run guided Google OAuth authorization (Zero-Config or Developer Mode) |
| `npm run auth -- configure --client-id <id>` | Save Developer Mode credentials locally |
| `npm run auth -- logout google` | Revoke and delete stored Google credentials |
| `npm run auth -- help` | Display setup guide and publisher requirements |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run all tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Type-check without emitting |
| `npm run manager` | Start the Manager dashboard |

## Reusable Google OAuth Authentication

AgentForge provides a persistent, OS-protected Google OAuth 2.0 connection system supporting both Zero-Configuration public distribution and local Developer Mode.

### User Experience Modes
- **Zero-Configuration Mode**: When AgentForge is bundled with an official registered Desktop Client ID (`AGENTFORGE_BUILTIN_CLIENT_ID`), ordinary users never need to configure client IDs or secrets. They simply click **Connect Google** in the Manager dashboard or run `agentforge auth google`.
- **Developer Mode**: Self-hosters and developers can supply their own Google Cloud Desktop OAuth Client ID without editing source code, either using the interactive Manager modal, running `agentforge auth configure --client-id <id>`, or setting `$env:GOOGLE_CLIENT_ID`.
- **Pending Registration**: When neither built-in publisher credentials nor developer credentials are configured, AgentForge transparently reports the exact publisher requirements needed to register the application with Google Cloud Console.

### Credential Security
- **No Plaintext JSON**: Refresh tokens are stored outside the repository directory (`%APPDATA%\AgentForge\auth\` on Windows) and protected using **Windows DPAPI** (`CurrentUser` scope) or encrypted storage.
- **Redaction**: Access tokens, refresh tokens, client secrets, and authorization codes are automatically redacted from logs, CLI outputs, and MCP responses.
- **Minimal Scopes**: AgentForge requests only minimal identity scopes (`openid`, `email`, `profile`) during initial login. Specific Google service bridges (YouTube, Drive, Calendar) request incremental scopes only when configured and approved.
- **PKCE Verification**: Uses RFC 7636 SHA-256 PKCE challenges and CSRF state validation on a loopback redirect server with single-flight replay rejection and DNS rebinding protection.

### Quick Setup:
1. **Manager UI**:
   - Run `npm run manager` (http://localhost:9470).
   - Click **Connect Google** in the header or in the Integrations card.
2. **Terminal (Zero-Config)**:
   ```bash
   node dist/cli/index.js auth google
   ```
3. **Terminal (Developer Mode)**:
   ```bash
   node dist/cli/index.js auth configure --client-id "your-client-id.apps.googleusercontent.com"
   node dist/cli/index.js auth google
   ```
4. **Revoke anytime via**:
   ```bash
   node dist/cli/index.js auth logout google
   ```

## Manager Dashboard

The Manager is a local web dashboard for viewing bridges, workflow runs, and approvals. It is **not** embedded inside Antigravity — it's a standalone local page.

```bash
npm run manager
# Opens at http://localhost:9470
```

## Universal MCP Integration Engine

AgentForge transforms into a universal capability harness by connecting directly to external Model Context Protocol (MCP) servers and exposing their tools securely to Antigravity.

### Supported Transports

- **Local stdio**: Spawns local child processes communicating over newline-delimited JSON-RPC 2.0. Protects against shell injection, manages process lifecycle, and catches process exits/crashes.
- **Remote HTTP**: Connects to remote MCP endpoints via HTTP JSON-RPC with configurable request timeouts, abort controller signal handling, and header authentication.

### Unified Integration Catalog

AgentForge provides a unified integration catalog that categorizes all available capabilities:
- **Built-in bridges** (`github`, `example-echo`)
- **Custom user bridges** (`bridges/<name>/bridge.json`)
- **External MCP servers** (stdio and HTTP)

The catalog strictly separates:
- **Declared capabilities**: What the manifest or configuration specifies.
- **Verified executable capabilities**: Tools that are live, discovered, and bound to a running executor or connected server.

### Exposing External MCP Tools to Antigravity

AgentForge exposes 4 dedicated MCP tools in addition to its existing bridge management tools:

1. `agentforge_list_catalog`: Returns the complete Unified Integration Catalog including summary metrics, item statuses, and declared vs. verified executable capabilities.
2. `agentforge_list_mcp_servers`: Lists all configured external MCP servers, connection states, and discovered tools.
3. `agentforge_manage_mcp_server`: Adds, connects, pings, disconnects, or removes external MCP servers.
4. `agentforge_run_mcp_tool`: Safely executes a tool on a connected external MCP server with strict input schema validation, least-privilege permission checks, and mandatory approval gating.

### Security & Permission Model

- **Least-privilege permission inference**: Tools are analyzed by name and description and mapped to `read`, `local-write`, `external-write`, `publish`, or `destructive`.
- **Approval gating**: Operations classified as `external-write`, `publish`, or `destructive` are blocked by default and require explicit confirmation (`confirmed: true`).
- **Input schema validation**: Discovered tool schemas are validated against invocation arguments before passing requests to external servers.
- **Secret redaction**: Environment variables and authentication headers matching tokens, keys, passwords, and secrets are masked as `[REDACTED]` in state queries, API endpoints, and Manager UI.

## Manager Dashboard

Run the Manager dashboard locally:

```bash
npm run manager
```

Or open `manager/index.html` directly in a browser.

Features:
- **Bridges Tab**: View installed bridges with capabilities and permission levels.
- **Integrations Tab**: View Git, GitHub CLI/token, and Google OAuth 2.0 authentication status.
- **MCP Servers Tab**: Add, connect, disconnect, ping, and invoke tools on external MCP servers.
- **Unified Catalog Tab**: Inspect real-time metrics, filter by integration type, and compare declared vs. verified executable tools.
- **Workflows Tab**: Workflow Control Center for launching predefined and custom workflows, tracking real-time step execution, reviewing approval checkpoints, and resuming or cancelling runs.
- **Security Approvals Tab**: Immutable audit log of all operator approvals and rejections across bridges and external MCP tools with operator identity and audit notes.
- **Create Bridge Modal**: Interactive form with schema validation and draft generator.

## Creating a New Bridge

1. Create a directory under `bridges/<your-bridge-name>/`
2. Add a `bridge.json` following the schema (see `bridges/example/bridge.json`)
3. Run `npm test` to validate the manifest
4. Or use the Manager dashboard's "+ Create Bridge" button

### Bridge Manifest Schema (v1.0)

See [src/types.ts](src/types.ts) for the complete `BridgeManifest` interface.

Required fields:
- `schema`: Must be `"1.0"`
- `name`: Lowercase kebab-case identifier
- `displayName`: Human-readable name
- `description`: What the bridge does
- `version`: Semver version string
- `capabilities`: Array of action definitions
- `integrations`: Array of required tools/services (can be empty)
- `auth`: Array of authentication requirements (can be empty)
- `permissions`: Array of permission rules

## GitHub Bridge

The included GitHub bridge provides:

| Action | Level | Description |
|--------|-------|-------------|
| `repo-info` | read | Repository information |
| `branch-list` | read | List branches |
| `status-check` | read | Working tree status |
| `log-inspect` | read | Commit history |
| `diff-review` | read | Compare changes |
| `changelog-prepare` | local-write | Generate changelog |
| `tag-create` | local-write | Create local tag |
| `push-commits` | external-write | Push to remote |
| `push-tags` | publish | Push tags |
| `release-create` | publish | Create GitHub release |
| `release-verify` | read | Verify release exists |
| `branch-delete` | destructive | Delete branch |

## YouTube Bridge

The included YouTube bridge provides both read-only channel and video inspection, plus verified resumable video publishing with approval enforcement:

| Action | Level | Requires Approval | Description |
|--------|-------|-------------------|-------------|
| `channel-inspect` | read | No | Inspect authenticated user's YouTube channel and statistics |
| `channel-metadata` | read | No | Retrieve channel metadata by ID or handle |
| `video-list` | read | No | List recent uploads or playlist items |
| `video-upload` | publish | **Yes** | Resumable video upload with pre-flight checks, SHA-256 tamper verification, and post-upload verification |

### YouTube Integration & OAuth Scope Model

- **Read-Only Actions**: Require `https://www.googleapis.com/auth/youtube.readonly` (`agentforge auth youtube`).
- **Publishing Actions**: Require `https://www.googleapis.com/auth/youtube.upload` (`agentforge auth youtube --upload`).
- **Resumable Upload Protocol**: Implements Google's official resumable upload protocol with chunked transfers, automatic interruption recovery via HTTP 308 range queries, and remote duplicate upload prevention.
- **Quota Awareness**: Video upload calls consume **1,600 quota units** (compared to 1 unit for read calls). Quota error messages provide clear diagnostic guidance and reset timing (midnight Pacific Time).
- **Tamper Protection**: Approval is cryptographically bound to the video file's SHA-256 hash and size. If the file is altered on disk after operator approval, the execution engine halts immediately.

## License

MIT
