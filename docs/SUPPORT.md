# AgentForge Support & Troubleshooting Guide

This guide provides support resources, diagnostics procedures, and answers to common operational issues in AgentForge.

---

## 1. Where to Get Help

- **Documentation:** Review the [Architecture Guide](ARCHITECTURE.md), [Installation Guide](INSTALLATION.md), and [Integrations Reference](INTEGRATIONS.md).
- **GitHub Issues:** Search existing [Issues](https://github.com/HamzaShaikhAI/AgentForge/issues) for reported bugs and solutions.
- **Security Inquiries:** For sensitive security reports, see [SECURITY.md](../SECURITY.md) or email `hamza.shaikh.ai@gmail.com`.

---

## 2. Common Diagnostics Procedures

### A. Verifying Node & Dependency Environment
Ensure you are running a supported Node.js version (Node 20+):
```bash
node -v
npm test
```
If dependencies are out of sync:
```bash
npm ci
npm run build
```

### B. Checking System Health via CLI
Run the diagnostic status check:
```bash
node dist/cli/index.js auth status
```
This inspects local credential vaults, DPAPI accessibility, and OAuth registration state without transmitting secrets.

### C. Inspecting the Manager Dashboard
Start the local Manager dashboard to view real-time diagnostics:
```bash
npm run manager
```
Open `http://localhost:9470` and navigate to the **Overview** view to see the live **Capability Truth Matrix** and adapter status.

---

## 3. Frequently Encountered Issues

### Issue 1: `Awaiting publisher configuration` in Google Sign-In
- **Cause:** Fresh checkouts and public releases ship without embedded Google Cloud OAuth credentials to respect publisher verification.
- **Resolution:**
  - For development and local testing, provide your own Google Cloud client credentials via `google-client.json` or environment variables (`AGENTFORGE_BUILTIN_CLIENT_ID`).
  - See [docs/OAUTH_PUBLISHER_READINESS.md](OAUTH_PUBLISHER_READINESS.md) for step-by-step setup instructions.

### Issue 2: `EADDRINUSE` (Port Conflict on 9470 or 8910)
- **Port 9470 (Manager UI):** Another instance of the Manager or another local service is using port 9470.
  - *Fix:* Terminate the stale node process or configure an alternate port using the `PORT` environment variable:
    ```bash
    PORT=9475 npm run manager
    ```
- **Port 8910 (OAuth Loopback):** A prior authentication attempt did not release the loopback socket.
  - *Fix:* Wait 30 seconds for socket timeout or restart your terminal.

### Issue 3: Stdio MCP Server Fails to Spawn
- **Cause:** The external MCP server command (e.g. `uvx`, `docker`, `python`) is not installed on the system PATH.
  - *Fix:* Verify that the required runtime is available in your shell:
    ```bash
    docker --version
    uv --version
    python --version
    ```
  - AgentForge's `CapabilityTruthEngine` dynamically checks tool availability and flags unexecutable servers as `not executable on host`.

### Issue 4: Windows DPAPI Decryption Error across Accounts
- **Cause:** Windows DPAPI protects secrets using keys tied to the specific Windows user profile. Moving `%APPDATA%\AgentForge\auth\` files to a different user account or machine will prevent decryption.
- **Resolution:** Use the Encrypted Vault Backup feature (`src/auth/vault-backup.ts`) to export credentials with a password before moving machines, and restore on the destination profile.
