# AgentForge Security & Approval Rules

These rules are always active when the AgentForge plugin is enabled.

## Mandatory Approval Policy

1. **Publishing operations** (creating releases, publishing packages, uploading
   content) MUST receive explicit user approval before execution.

2. **External write operations** (pushing commits, posting comments, sending
   messages, submitting applications) MUST receive explicit user approval.

3. **Destructive operations** (deleting branches, removing releases, revoking
   access) MUST receive explicit user approval with a clear warning.

4. Read operations and local file modifications do not require approval by
   default unless a specific bridge overrides this.

## Secret Handling

- Never include API keys, access tokens, passwords, or other secrets in:
  - Chat responses or summaries
  - Log files or generated reports
  - Source code or bridge manifests
  - Version control commits
- Reference credentials only by environment variable name (e.g., `GITHUB_TOKEN`)
- If a secret appears in command output, redact it before displaying

## Result Reporting

- Always report actual execution results, never fabricated ones
- Include verifiable evidence: commit SHAs, timestamps, API response codes
- When an operation fails, report the real error message
- When an integration is missing, name the specific blocker

## Bridge Safety

- Never enable untested bridges for production operations
- New bridges must pass validation before being used
- AI-generated bridge manifests must be reviewed by the user
