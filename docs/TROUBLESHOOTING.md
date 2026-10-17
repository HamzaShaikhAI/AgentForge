# AgentForge Troubleshooting & FAQ

This document provides verified resolutions for common configuration, network, authentication, and permission issues.

---

## 1. Google OAuth & Authentication Issues

### Issue 1.1: `Error 401: invalid_client` ("The OAuth client was not found")
- **Cause:** The configured OAuth Client ID is either a placeholder (e.g., `custom-manager-client...`) or has not been registered in Google Cloud Console.
- **Resolution:**
  1. Open [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
  2. Create an OAuth 2.0 Client ID with Application Type: **Desktop app**.
  3. Copy the client ID (`<project-num>-<hash>.apps.googleusercontent.com`).
  4. Configure AgentForge:
     ```bash
     node dist/cli/index.js auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"
     ```
  5. Or clear stale developer configuration:
     ```bash
     node dist/cli/index.js auth configure --reset
     ```

### Issue 1.2: `Error 403: access_denied` ("Google test user restriction")
- **Cause:** While your Google Cloud OAuth consent screen is in **Testing** status, Google restricts authorization exclusively to whitelisted developer test accounts.
- **Resolution:**
  1. Go to **Google Cloud Console > APIs & Services > OAuth consent screen**.
  2. Scroll down to **Test users** and click **+ Add Users**.
  3. Enter the exact email address you are attempting to log in with.
  4. Re-run `agentforge auth google` or sign in via the Manager dashboard.

### Issue 1.3: "Google hasn't verified this app" (Unverified App Interstitial)
- **Cause:** Normal behavior when requesting sensitive scopes (like `youtube.readonly` or `youtube.upload`) with an OAuth consent screen that has not completed Google's official brand verification.
- **Resolution:**
  - Click **Advanced** in the bottom left of the Google warning screen.
  - Click **Go to AgentForge (unsafe)**.
  - Review permissions and click **Continue**.

### Issue 1.4: `Error: unauthorized_client`
- **Cause:** The OAuth client ID in Google Cloud Console was created with Application Type **Web application** instead of **Desktop app**. Web applications require client secrets and fixed redirect URIs, whereas native desktop applications use RFC 8252 loopback redirects.
- **Resolution:** Create a new client ID in Google Cloud Console specifically selecting **Desktop app**.

---

## 2. Port Conflicts & Server Errors

### Issue 2.1: `EADDRINUSE: Port 9470 already in use`
- **Cause:** Another process or an existing AgentForge Manager instance is already listening on port 9470.
- **Resolution:**
  - On Windows:
    ```powershell
    Get-NetTCPConnection -LocalPort 9470 | Select-Object OwningProcess
    Stop-Process -Id <PID>
    ```
  - Or specify a custom port:
    ```powershell
    $env:PORT = "9480"
    npm run manager
    ```

### Issue 2.2: `EADDRINUSE: Port 8910 already in use`
- **Cause:** The OAuth loopback callback server (`http://127.0.0.1:8910/callback`) cannot bind because port 8910 is occupied.
- **Resolution:** Stop the conflicting process or close active browser authentication flows before re-authenticating.

---

## 3. YouTube Operations & API Errors

### Issue 3.1: `YouTube API quota exceeded (HTTP 403: quotaExceeded)`
- **Cause:** Google allocates 10,000 free quota units per day per Google Cloud project. A video upload (`video-upload`) consumes **1,600 units**. If you upload multiple videos within 24 hours, the project quota may be exhausted.
- **Resolution:** Quota resets daily at midnight Pacific Time (PT). You can inspect your quota usage in [Google Cloud Console Quotas](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas).

### Issue 3.2: `YouTube channel not found (hasChannel: false)`
- **Cause:** The connected Google account has never created a YouTube channel.
- **Resolution:** Open [YouTube](https://www.youtube.com), sign in with the connected Google account, and click **Create a Channel**.

---

## 4. MCP & Bridge Builder Troubleshooting

### Issue 4.1: `MCP server spawn ENOENT`
- **Cause:** An external MCP server configured with `stdio` transport cannot find the specified executable on the system `PATH`.
- **Resolution:** Verify the command in `cmd` or `powershell` (e.g. `npx --version` or `node --version`) and use absolute paths if needed.

### Issue 4.2: Staged Bridge Fails Security Analysis
- **Cause:** The Custom Bridge Builder detected dangerous patterns (such as dynamic `eval()` or unescaped shell commands).
- **Resolution:** Inspect the security finding reported by the builder and adjust your prompt to request standard library functions or the `local-files` template.
