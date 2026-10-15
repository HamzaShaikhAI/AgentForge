---
name: agentforge
description: >-
  Use this skill when the user asks to perform tasks across external services
  (GitHub, YouTube, LinkedIn, etc.) using AgentForge bridges, when they ask
  about available integrations, when they want to create or manage bridges,
  or when they want to run multi-step workflows with approval policies.
---

# AgentForge — Capability Harness for Antigravity

AgentForge extends your capabilities with **bridges** — validated integration
definitions that connect you to external services. You remain the reasoning
agent; AgentForge provides the registry, permissions, workflows and evidence.

## Core Concepts

| Concept       | What it is                                                          |
| :------------ | :------------------------------------------------------------------ |
| **Bridge**    | A validated manifest defining how to interact with a service        |
| **Registry**  | Discovers and validates bridge definitions from `bridges/`          |
| **Workflow**  | Ordered steps combining multiple bridge actions                     |
| **Permission**| Policy tier controlling what requires approval                      |
| **Manager**   | Local dashboard for viewing bridges, runs, and integration status   |

## Permission Tiers

Every bridge action declares a permission level. **Follow these rules strictly:**

| Level              | Default Policy          | Examples                             |
| :----------------- | :---------------------- | :----------------------------------- |
| `read`             | Always allowed          | List repos, check status, read files |
| `local-write`      | Allowed by default      | Create local files, modify config    |
| `external-write`   | **Requires approval**   | Push commits, post comments          |
| `publish`          | **Requires approval**   | Create releases, publish packages    |
| `destructive`      | **Requires approval**   | Delete branches, remove releases     |

> [!IMPORTANT]
> Never perform `external-write`, `publish`, or `destructive` operations
> without explicit user approval. Record the approval and report the result.

## How to Discover Capabilities

1. Check the bridge registry: read `bridges/*/bridge.json` files
2. Each bridge lists its capabilities, required integrations, and auth
3. Report honestly which integrations are configured vs missing
4. Never pretend an integration works if the required tool/auth is absent

## How to Use a Bridge

1. **Identify** the bridge and action needed for the user's request
2. **Check integrations** — verify required CLI tools, env vars, MCP servers
3. **Check permissions** — determine the approval level needed
4. **Request approval** if the action is external-write or above
5. **Execute** the action using the bridge's documented method
6. **Report results** with evidence (commit SHAs, API responses, timestamps)
7. **Verify** the outcome when the service exposes confirmation

## How to Run a Workflow

1. Present the planned steps to the user before starting
2. Execute steps in dependency order
3. Stop at any step requiring approval and ask the user
4. On failure, report the error and ask whether to continue or stop
5. Retry only when the step is marked retryable and the error is transient
6. Present a final summary with status of each step

## How to Create a New Bridge

Guide the user through the bridge creation process:

1. Choose a name (lowercase-kebab-case) and category
2. Define capabilities with permission levels
3. Specify required integrations and auth methods
4. Add test/verification instructions
5. Write the bridge.json manifest following schema v1.0
6. Validate with: `npm run build && npm test`
7. Place in `bridges/<name>/bridge.json`

> [!CAUTION]
> Never claim a bridge is production-ready without validation and testing.
> New bridges must be reviewed before being enabled for real operations.

## Diagnosing Missing Connections

When an integration is not available:

1. **Name the specific blocker** (e.g., "GitHub CLI `gh` is not installed")
2. **Provide setup instructions** from the bridge manifest
3. **Suggest alternatives** if available (e.g., use git + API token instead)
4. **Never fabricate** results or pretend the operation succeeded

## Security Rules

- **Never** expose API keys, tokens, or passwords in logs or responses
- **Never** store plaintext secrets in bridge manifests or source code
- Auth credentials are referenced by environment variable name only
- Approval records log the decision, not the credentials used

## Manager Dashboard

The AgentForge Manager is a local HTML dashboard (not embedded in Antigravity).
To open it, run:

```
npm run manager
```

Or open `manager/index.html` directly in a browser.

It shows: installed bridges, integration status, workflow runs, and approvals.

## File Structure

```
AgentForge/
├── plugin.json          # Antigravity plugin manifest
├── skills/agentforge/   # This skill
├── rules/AGENTS.md      # Always-on security rules
├── bridges/             # Bridge manifests (bridge.json per bridge)
│   ├── github/
│   └── example/
├── src/                 # Core TypeScript library
│   ├── bridge-validator.ts
│   ├── bridge-registry.ts
│   ├── workflow-engine.ts
│   └── permissions.ts
├── manager/             # Local dashboard
└── data/                # Runtime state (runs, approvals)
```
