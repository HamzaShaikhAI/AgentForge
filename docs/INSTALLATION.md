# AgentForge Installation Guide

This guide provides verified, step-by-step instructions for installing and running AgentForge on Windows, macOS, and Linux, as well as integrating it into Google Antigravity as an active plugin.

---

## 1. Prerequisites

Before installing AgentForge, ensure your environment meets the following requirements:

| Component | Minimum Version | Verified Version | Notes |
|---|---|---|---|
| **Node.js** | `>= 20.0.0` | `v20.x` / `v22.x` | Required for ES Modules, fetch API, and crypto primitives |
| **npm** | `>= 10.0.0` | Included with Node | Used for dependency installation and scripts |
| **Git** | `>= 2.30.0` | Any modern release | Required for local repository inspections |
| **OS** | Windows 10/11, macOS 12+, Ubuntu 22.04+ | Windows 10 x64 | Windows DPAPI supported natively on Windows |

---

## 2. Installation from Source

### Step 1: Clone the Repository
```bash
git clone https://github.com/HamzaShaikhAI/AgentForge.git
cd AgentForge
```

### Step 2: Install Dependencies
```bash
npm ci
```

### Step 3: Build the TypeScript Source
```bash
npm run build
```

### Step 4: Verify with the Test Suite
```bash
npm test
```
All 18 test files (256 unit and integration tests) should pass cleanly.

---

## 3. Integrating with Google Antigravity

AgentForge is natively structured as an Antigravity plugin, including:
- Plugin manifest (`plugin.json`)
- System prompt rules (`rules/AGENTS.md`)
- Progressive disclosure skill (`skills/agentforge/SKILL.md`)

To register AgentForge in Antigravity, link the repository into your Antigravity plugins directory.

### Windows (PowerShell, Recommended)
Run PowerShell as Administrator or with developer mode enabled:
```powershell
# Create directory junction in the Antigravity user plugin directory
New-Item -ItemType Junction -Path "$env:USERPROFILE\.gemini\config\plugins\agentforge" -Target "$PWD"
```

### macOS / Linux
```bash
mkdir -p ~/.gemini/config/plugins
ln -s "$(pwd)" ~/.gemini/config/plugins/agentforge
```

### Verifying Antigravity Discovery
1. Launch Antigravity.
2. In the chat prompt, type: `List available AgentForge bridges and their status`.
3. Antigravity should invoke the `agentforge` skill and report active bridge capabilities.

---

## 4. Starting the Local Manager Dashboard

AgentForge includes a local web-based control center:
```bash
npm run manager
```
Output:
```
  ⚒️  AgentForge Manager
  ─────────────────────
  Dashboard:    http://localhost:9470
  Health Check: http://localhost:9470/api/status
  API Bridges:  http://localhost:9470/api/bridges
  Press Ctrl+C to stop
```
Open **`http://localhost:9470`** in your browser to access:
- Bridge capability cards and status indicators
- The unified capability catalog
- Workflow run history and pending approval checkpoints
- Google OAuth connection panel and Developer Mode settings
- Custom Bridge Builder interface

---

## 5. CLI Verification Commands

You can verify AgentForge functionality directly from the command line:

```bash
# Display CLI help
npm run cli -- --help

# Check authentication and credential storage status
npm run auth status

# Inspect catalog
node dist/cli/index.js catalog list

# Inspect bridges
node dist/cli/index.js bridges list
```
