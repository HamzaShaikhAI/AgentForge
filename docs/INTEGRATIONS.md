# AgentForge Integrations Guide

This guide details the built-in bridges, external Model Context Protocol (MCP) server connectivity, and custom bridge authoring in AgentForge.

---

## 1. Capability Status Matrix

| Bridge / System | Action Name | Permission Level | Implemented & Tested? | External Prerequisites |
|---|---|---|---|---|
| **GitHub** | `repo-info` | `read` | ✅ **Yes** | Local Git repository |
| **GitHub** | `status-check` | `read` | ✅ **Yes** | Local Git repository |
| **GitHub** | `branch-list` | `read` | ✅ **Yes** | Local Git repository |
| **GitHub** | `log-inspect` | `read` | ✅ **Yes** | Local Git repository |
| **GitHub** | `diff-review` | `read` | ✅ **Yes** | Local Git repository |
| **GitHub** | `release-verify` | `read` | ✅ **Yes** | Local Git repo + optional `GITHUB_TOKEN` |
| **GitHub** | `changelog-prepare` | `local-write` | ⏳ *Declared in Manifest* | Planned Milestone |
| **GitHub** | `tag-create` | `local-write` | ⏳ *Declared in Manifest* | Planned Milestone |
| **GitHub** | `push-commits` | `external-write` | ⏳ *Declared in Manifest* | Planned Milestone |
| **GitHub** | `push-tags` | `publish` | ⏳ *Declared in Manifest* | Planned Milestone |
| **GitHub** | `release-create` | `publish` | ⏳ *Declared in Manifest* | Planned Milestone |
| **GitHub** | `branch-delete` | `destructive` | ⏳ *Declared in Manifest* | Planned Milestone |
| **YouTube** | `channel-inspect` | `read` | ✅ **Yes** | Google OAuth (`youtube.readonly`) |
| **YouTube** | `channel-metadata` | `read` | ✅ **Yes** | Google OAuth (`youtube.readonly`) |
| **YouTube** | `video-list` | `read` | ✅ **Yes** | Google OAuth (`youtube.readonly`) |
| **YouTube** | `video-upload` | `publish` | ✅ **Yes** | Google OAuth (`youtube.upload`) + Approval |
| **External MCP** | Dynamic Tools | Inferred | ✅ **Yes** | Running MCP server (`stdio` or `http`) |
| **Custom Bridges** | User-defined | Configured | ✅ **Yes** | Staged and approved by operator |

---

## 2. GitHub Bridge (`bridges/github/bridge.json`)

The GitHub bridge manages local Git repositories and remote release verification using `GitExecutor` (`src/executors/git-executor.ts`).

### Executable Actions:
- **`repo-info`**: Retrieves current branch, configured remote URLs, and latest commit details (SHA, author, date, subject).
- **`status-check`**: Inspects working tree clean status, staged files, modified files, and untracked files.
- **`branch-list`**: Lists all local and remote tracking branches.
- **`log-inspect`**: Returns structured commit history with optional `count` and `since` filters.
- **`diff-review`**: Returns raw and patch diffs between git references or working tree (`base`, `head`).
- **`release-verify`**: Verifies local tags and queries GitHub REST API releases. If `GITHUB_TOKEN` is unset, it truthfully reports the blocker while still providing local tags.

---

## 3. YouTube Bridge (`bridges/youtube/bridge.json`)

The YouTube bridge interacts with the official YouTube Data API v3 using `YouTubeExecutor` (`src/executors/youtube-executor.ts`).

### Prerequisites:
1. Google OAuth Client configured (zero-config publisher client or Developer Mode credentials).
2. Connect account and grant requested YouTube scopes.

### OAuth Scopes:
- **`https://www.googleapis.com/auth/youtube.readonly`**: Required for channel inspection, metadata, and listing videos.
- **`https://www.googleapis.com/auth/youtube.upload`**: Required for publishing videos.

### Executable Actions:
- **`channel-inspect`**: Retrieves the authenticated user's YouTube channel ID, uploads playlist ID, view count, video count, and subscriber statistics.
- **`channel-metadata`**: Looks up channel metadata for the connected user or a specified `channelId` or `forHandle`.
- **`video-list`**: Retrieves video snippets from the user's uploads playlist with pagination support (`maxResults`, `pageToken`).
- **`video-upload`**: Uploads local video files via official resumable upload protocol.
  - **Inputs:** `filePath` (required), `title` (required), `description`, `tags`, `categoryId` (default `'22'`), `privacyStatus` (`'private'`, `'unlisted'`, `'public'`).
  - **Verification:** Calculates local SHA-256 and byte size before upload; verifies against YouTube response post-upload.
  - **Operator Approval:** Requires explicit operator confirmation before commencing upload.
  - **Quota Cost:** YouTube video upload consumes **1,600 quota units** (default free quota is 10,000 units/day). If quota is exceeded, the executor throws a clear `HTTP 403 quotaExceeded` error with current quota status.

---

## 4. External Model Context Protocol (MCP) Connectivity

AgentForge connects to external MCP servers using `McpManager` (`src/mcp/mcp-manager.ts`), allowing Antigravity workflows to invoke any third-party MCP tool.

### 4.1 Supported Transports
1. **`stdio` Transport (Local Process):**
   Spawns a local executable with JSON-RPC 2.0 communication over standard input/output.
   ```json
   {
     "id": "filesystem",
     "name": "Local Filesystem Server",
     "transport": "stdio",
     "command": "npx",
     "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\user\\Projects"]
   }
   ```
2. **`sse` / `http` Transport (Remote Endpoint):**
   Connects to an HTTP/SSE server endpoint with optional custom authorization headers.
   ```json
   {
     "id": "remote-db",
     "name": "Remote Database MCP",
     "transport": "sse",
     "url": "http://127.0.0.1:8000/sse",
     "headers": {
       "Authorization": "Bearer <TOKEN>"
     }
   }
   ```

### 4.2 Permission Inference
AgentForge inspects third-party MCP tool names and descriptions to automatically infer safety tiers:
- Names containing `get`, `list`, `read`, `search`, `inspect` -> `read` (auto-allowed).
- Names containing `write`, `update`, `create`, `save` -> `local-write` or `external-write`.
- Names containing `publish`, `deploy`, `release` -> `publish` (requires approval).
- Names containing `delete`, `drop`, `destroy`, `purge` -> `destructive` (requires approval).

### 4.3 Invoking MCP Tools in Workflows
Reference the server ID and tool name in workflow step definitions:
```json
{
  "id": "query-data",
  "bridge": "mcp:remote-db",
  "action": "execute_query",
  "inputs": {
    "query": "SELECT * FROM users LIMIT 10"
  }
}
```

---

## 5. Custom Bridge Builder

Users can create and register new bridges without writing code by hand using `BridgeBuilder` (`src/builder/bridge-builder.ts`).

### 5.1 Staging Lifecycle
```
[Draft Request] ──> [Template Generation] ──> [Security Analysis] ──> [Sandbox Tests] ──> [Awaiting Review] ──> [Operator Approval] ──> [Active Bridge]
```

1. **Generation:** Generates manifest `bridge.json` and TypeScript executor from request.
2. **Security Audit:** Static analyzer checks for forbidden `eval()`, shell injection, and leaked secrets.
3. **Sandbox Test:** Runs automated unit tests in an isolated sandbox.
4. **Approval & Activation:** Staged bridges remain inactive until an operator provides an explicit approval identity (`approvedBy`), promoting the bridge to active status.
