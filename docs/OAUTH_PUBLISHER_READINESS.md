# Google Cloud OAuth 2.0 Publisher Readiness Checklist

**Project:** AgentForge  
**Repository:** `https://github.com/HamzaShaikhAI/AgentForge`  
**Protocol:** RFC 8252 (OAuth 2.0 for Native Apps) with PKCE (RFC 7636)  
**Target:** Production Zero-Configuration Google Sign-In & YouTube Publishing  

---

## 1. Overview & Architectural Invariants

AgentForge employs a **local-first Native Desktop Application architecture** for Google OAuth 2.0:

```
┌─────────────────────────────────────────────────────────────┐
│                      User's Machine                         │
│                                                             │
│  ┌──────────────────┐           ┌────────────────────────┐  │
│  │   AgentForge     │           │   Default Web Browser  │  │
│  │   (Local Core)   │           │                        │  │
│  └────────┬─────────┘           └───────────┬────────────┘  │
│           │                                 │               │
│           │ 1. Spawns loopback server       │               │
│           │    (http://127.0.0.1:8910)      │ 2. Navigates  │
│           │                                 │    to auth URL│
└───────────┼─────────────────────────────────┼───────────────┘
            │                                 │
            │                                 ▼
            │                   ┌───────────────────────────┐
            │                   │   accounts.google.com     │
            │                   │   (Google Consent Screen) │
            │                   └─────────────┬─────────────┘
            │                                 │
            │ 3. Browser redirects with code  │
            │    http://127.0.0.1:8910/callback
            ◄─────────────────────────────────┘
            │
            │ 4. Exchanges code directly with oauth2.googleapis.com
            │    using PKCE verifier (S256)
            ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Stores tokens in OS-protected storage (DPAPI / AES-256) │
│    Tokens never leave the local machine.                    │
└─────────────────────────────────────────────────────────────┘
```

- **Zero-External-Relay:** No centralized broker, proxy server, or third-party cloud service handles user tokens or authorization codes.
- **Direct Loopback Server:** Callback occurs dynamically on `http://127.0.0.1:8910/callback`.
- **Integrity:** Code challenges are hashed using `SHA-256` (`S256`), and state parameters are validated using timing-safe constant-time string comparison (`timingSafeStringEqual`).

---

## 2. Google Cloud Console Registration Checklist (Publisher Action Items)

To enable zero-configuration login for all end users of AgentForge without requiring them to supply their own credentials, the project publisher must complete the following steps in the [Google Cloud Console](https://console.cloud.google.com):

### Step 1: Create or Select Google Cloud Project
- [ ] Log in to [Google Cloud Console](https://console.cloud.google.com).
- [ ] Create a new project (recommended name: `AgentForge Desktop`).
- [ ] Note the **Project Number** and **Project ID**.

### Step 2: Enable Required APIs
In **APIs & Services > Library**, search for and enable:
- [ ] **YouTube Data API v3** (`youtube.googleapis.com`) — required for channel inspection, video listings, and video uploads.
- [ ] **Google People API** or **Userinfo API** — required for email/profile retrieval during sign-in.

### Step 3: Configure OAuth Consent Screen
In **APIs & Services > OAuth consent screen**:
- [ ] **User Type:** Select **External** (allows any Google account to sign in).
- [ ] **App Information:**
  - **App name:** `AgentForge`
  - **User support email:** (e.g. `support@agentforge.dev` or publisher email)
  - **App logo:** (Upload official AgentForge square icon)
- [ ] **App Domain Information:**
  - **Application home page:** `https://github.com/HamzaShaikhAI/AgentForge`
  - **Application privacy policy link:** `https://github.com/HamzaShaikhAI/AgentForge/blob/master/SECURITY.md`
  - **Application terms of service link:** `https://github.com/HamzaShaikhAI/AgentForge/blob/master/LICENSE`
- [ ] **Authorized Domains:** `github.com` (or publisher custom domain if applicable).
- [ ] **Developer Contact Information:** Enter publisher technical contact email.

### Step 4: Declare Scopes
Configure the minimum necessary scopes to satisfy least-privilege principles:
- [ ] **Non-Sensitive Scopes (Default Sign-In):**
  - `openid`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`
  - *Justification:* Used to identify the authenticated account in the local Manager dashboard and verify active sessions.
- [ ] **Sensitive Scope (YouTube Read-Only):**
  - `https://www.googleapis.com/auth/youtube.readonly`
  - *Justification:* Allows users to inspect their channel metadata, playlists, and video listings locally before publishing.
- [ ] **Restricted Scope (YouTube Video Upload):**
  - `https://www.googleapis.com/auth/youtube.upload`
  - *Justification:* Allows users to upload and publish video files to their YouTube channels only after explicit operator approval.

### Step 5: Create OAuth 2.0 Client ID (Application Type: Desktop app)
In **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
- [ ] **Application type:** Select **Desktop app** *(CRITICAL: Do NOT select "Web application")*.
  > [!IMPORTANT]
  > Google Cloud automatically permits loopback redirects (`http://127.0.0.1:<port>/callback` and `http://localhost:<port>/callback`) for "Desktop app" clients. Selecting "Web application" will cause redirect URI validation errors (`redirect_uri_mismatch`).
- [ ] **Name:** `AgentForge Desktop Client`
- [ ] Click **Create**.
- [ ] Copy the generated **Client ID** (`<project-number>-<hash>.apps.googleusercontent.com`).
- [ ] Note the **Client Secret** (optional for public desktop clients, but can be configured in Google Cloud).

---

## 3. Google OAuth Verification Tiers

Google categorizes OAuth apps into two operational states:

### Phase 1: Testing Mode (Developer Preview & Test Users)
- **Status:** Unverified.
- **User Cap:** Up to 100 designated Google accounts in the "Test users" list.
- **Screen Behavior:** Displays an "Unverified app" interstitial. Users can proceed by clicking **Advanced > Go to AgentForge (unsafe)**.
- **Action Required for Publisher:** Add collaborator and tester email addresses under **OAuth consent screen > Test users**.

### Phase 2: In Production / Public Verification
To remove the "Unverified app" interstitial and allow any user to connect with zero configuration:
- [ ] Complete the **Google Cloud App Verification** process:
  - Submit the app for verification in Google Cloud Console.
  - Provide a demonstration video (hosted unlisted on YouTube) showing:
    1. The AgentForge Manager dashboard opening the browser sign-in flow.
    2. The Google OAuth consent screen clearly displaying the Project ID and requested scopes.
    3. The successful return to AgentForge and display of the connected account.
    4. Execution of a workflow requiring YouTube read or upload scopes, demonstrating why each scope is necessary.
  - Review Google Cloud Trust & Safety review feedback and address any requested policy disclosures.

---

## 4. Bundling the Registered Client ID into AgentForge

Once the official client ID is generated in Google Cloud Console, it can be activated in AgentForge distributions using any of the following methods:

### Method A: Environment Variable (CI / Staging Releases)
Set in the release environment:
```powershell
$env:AGENTFORGE_BUILTIN_CLIENT_ID = "<PROJECT_NUMBER>-<HASH>.apps.googleusercontent.com"
```

### Method B: Bundled Package Configuration File
Create `publisher-client.json` (or `data/publisher-client.json`) in the package root:
```json
{
  "installed": {
    "client_id": "<PROJECT_NUMBER>-<HASH>.apps.googleusercontent.com",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token"
  },
  "verificationStatus": "verified"
}
```

### Method C: Embedded Release Constant
Set `BUNDLED_PUBLISHER_CLIENT_ID` in `src/auth/publisher-config.ts`:
```typescript
export const BUNDLED_PUBLISHER_CLIENT_ID: string | undefined =
  '<PROJECT_NUMBER>-<HASH>.apps.googleusercontent.com';
```

---

## 5. Developer Mode for Self-Hosting (No Publisher Dependency)

If users or developers wish to self-host or develop on AgentForge before official verification is completed, they do not need to wait for the publisher. They can activate Developer Mode immediately:

1. Create a personal project and "Desktop app" OAuth Client in Google Cloud Console.
2. Save the credentials using the AgentForge CLI:
   ```powershell
   agentforge auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"
   ```
3. Or open the Manager dashboard (`http://localhost:9470`), click **Developer Mode**, paste the Client ID, and click **Save & Enable**.
4. Run `agentforge auth google` or click **Connect Google**.

---

## 6. Diagnostic Reference & Error Discrimination

| Error Code | Root Cause | Resolution |
| :--- | :--- | :--- |
| `invalid_client` | Client ID was not found by Google Cloud or has been deleted. | Check client ID format; ensure no placeholder strings are present. |
| `unauthorized_client` | Client was created with wrong Application Type (e.g. Web instead of Desktop). | Recreate client in Google Cloud Console with Application Type: **Desktop app**. |
| `access_denied` | User clicked Cancel, OR user is not in "Test users" list while app is in Testing mode. | Add user's Google account to "Test users" in Google Cloud Console or submit for verification. |
| `accessNotConfigured` | YouTube Data API v3 has not been enabled in Google Cloud Console project. | Open Google Cloud Console > APIs & Services > Library > Enable YouTube Data API v3. |
| `quotaExceeded` | Daily YouTube Data API v3 quota exhausted (10,000 units default). Video upload = 1,600 units. | Wait for midnight Pacific Time reset or request quota increase in Google Cloud Console. |
