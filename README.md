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
New-Item -ItemType Junction -Path "$env:USERPROFILE\.gemini\config\plugins\agentforge" -Target "C:\Users\win10\Documents\AgentForge"
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
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run all tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Type-check without emitting |
| `npm run manager` | Start the Manager dashboard |

## Manager Dashboard

The Manager is a local web dashboard for viewing bridges, workflow runs, and approvals. It is **not** embedded inside Antigravity — it's a standalone local page.

```bash
npm run manager
# Opens at http://localhost:9470
```

Or open `manager/index.html` directly in a browser for a static view.

Features:
- View installed bridges with capabilities and permission levels
- See integration requirements and auth status
- Create new bridge scaffolds
- Inspect workflow runs and approval history

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

### GitHub Integration Requirements

- **Required:** `git` CLI
- **Optional:** `gh` CLI (GitHub CLI) or `GITHUB_TOKEN` environment variable
- API operations (releases) need either `gh auth` or `GITHUB_TOKEN`

## Security

- API keys and tokens are **never stored in manifests or source code**
- Credentials are referenced only by environment variable name
- Publishing, sending, and destructive operations require explicit approval
- Approval records log the decision, not the credentials used
- All execution results report actual outcomes, never fabricated ones

## Limitations & Next Steps

### Current Limitations

- GitHub bridge defines the manifest but does not include a runtime executor yet (Antigravity executes git commands directly via its existing tools)
- Manager dashboard reads bridge manifests but doesn't show live integration status checks yet
- No MCP server included yet (bridges use Antigravity's existing tool capabilities)
- Workflow runs are in-memory only (no persistent storage yet)

### Planned Next Steps

1. **Bridge executors** — Runtime implementations for each bridge action
2. **MCP server** — Expose AgentForge capabilities as MCP tools
3. **Persistent state** — Save workflow runs and approvals to `data/`
4. **Integration checker** — Verify CLI tools and env vars at startup
5. **Video bridge scaffold** — Architecture for video generation workflows
6. **Bridge templates** — Quick-start templates for common service types
7. **GitHub CLI fallback** — Install `gh` CLI or use REST API directly

## License

MIT
