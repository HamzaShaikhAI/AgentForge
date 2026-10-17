# Security Policy

AgentForge prioritizes local-first privacy, deterministic permission gating, and the absolute isolation of user credentials.

---

## 1. Reporting a Vulnerability

If you discover a security vulnerability in AgentForge, please do **NOT** open a public issue.

Instead, please send a responsible disclosure report to:
- **Security Contact:** `hamza.shaikh.ai@gmail.com` or via [GitHub Security Advisories](https://github.com/HamzaShaikhAI/AgentForge/security/advisories)

Include as much of the following information as possible:
- Type of issue (e.g., credential exposure, unauthorized command execution, path traversal, CSRF bypass).
- Step-by-step instructions or proof-of-concept script to reproduce the vulnerability.
- Affected components (CLI, Manager server, OAuth service, Bridge Builder, MCP manager).
- Proposed mitigation or remediation, if known.

We will acknowledge receipt within 48 hours and work with you to validate, patch, and coordinate responsible disclosure.

---

## 2. Core Security Invariants

### 2.1 Local-First Architecture (Zero External Relays)
- AgentForge contains **zero external telemetry servers**, zero analytics beacons, and zero intermediate proxy relays.
- All network interactions occur directly between the local native client and the official third-party API endpoint (e.g., Google OAuth endpoints, YouTube Data API v3, GitHub REST API).

### 2.2 Native Desktop OAuth 2.0 (RFC 8252 & RFC 7636)
- **Direct Loopback Server:** Native loopback redirect (`http://127.0.0.1:8910/callback`) binds strictly to loopback interfaces.
- **Header & Origin Validation:** The loopback callback server rejects requests with untrusted `Host` headers (protecting against DNS rebinding) and blocks cross-origin requests.
- **PKCE (`S256`):** Every authorization request generates high-entropy cryptographic code verifiers and SHA-256 code challenges. Client secrets are never embedded in client binaries or required from native users.
- **CSRF State Verification:** Authorization sessions generate cryptographically random state tokens, verified using constant-time comparison (`timingSafeEqual`) to prevent side-channel timing attacks.

### 2.3 OS-Protected Encrypted Credential Storage
- **Windows DPAPI:** On Windows systems, tokens are encrypted using the Windows Data Protection API (`System.Security.Cryptography.ProtectedData`), encrypted under the logged-in user's Windows master key.
- **Encrypted File Fallback:** On non-Windows platforms, credentials are encrypted with `AES-256-GCM` using keys derived via `scrypt` with cryptographic salts and authentication tags.
- **Storage Location:** Credentials write to user-specific directories completely outside the source code repository (`%APPDATA%\AgentForge\auth\` on Windows, `~/.config/agentforge/auth/` on Unix).

### 2.4 Deep Secret Redaction
- All sensitive strings (OAuth access tokens `ya29.*`, refresh tokens `1//*`, client secrets `GOCSPX-*`, auth codes `4/*`, upload session URLs `upload_id=*`, and Bearer tokens) are automatically scrubbed from:
  - Error messages and stack traces
  - Workflow run history and persisted files
  - REST API responses
  - Terminal logs and CLI output
- User email addresses are masked for privacy (e.g., `d*******r@example.com`).

### 2.5 Input-Bound Approval Checkpoints
- Actions with external side effects (`publish`, `external-write`, `destructive`) halt workflow execution and require explicit operator confirmation.
- Approvals are cryptographically bound to the exact action name, target arguments, and operator identity. Modifications to inputs invalidate approval state.

### 2.6 Custom Bridge Builder Security Boundaries
- The Custom Bridge Builder statically analyzes generated executor code for:
  - Forbidden `eval()` and dynamic `Function()` invocation
  - Unsafe shell execution with template interpolation
  - Path traversal (`../`)
  - Hardcoded tokens, secrets, or API keys
- **Explicit Boundary:** Bridge testing runs in an isolated child process using temporary directories. This is an execution sandbox for validation, **not** a hardware or OS-level virtualization hypervisor. Custom bridges run with the permissions of the local user process.
