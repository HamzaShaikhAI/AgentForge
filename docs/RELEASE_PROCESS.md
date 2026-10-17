# AgentForge Release Engineering & Verification Process

This document defines the strict, reproducible procedure for qualifying, tagging, and publishing releases of AgentForge.

---

## 1. Guiding Release Principles

1. **Evidence-Based Qualification:** A release is never published based on claims or partial runs. Every release requires a passing type check, clean build, 100% test pass rate, and an uncorrupted package dry-run.
2. **Explicit Operator Authorization:** The release workflow strictly forbids autonomous agents from pushing commits, creating tags, or creating GitHub Releases without explicit human confirmation.
3. **No Committed Secrets or Machine Paths:** Release artifacts must be audited against local paths, `.env` files, credential directories, and private user configurations.
4. **Transparent Blocker Reporting:** When external prerequisites (such as Google OAuth Cloud Console publisher verification) are pending, they must be documented as known boundaries rather than falsely claimed as complete.

---

## 2. Release Qualification Checklist

Before creating any release tag (`v*.*.*`), the operator must execute the following qualification sequence:

### Step 1: Clean Working Tree Check
```bash
git status --short
```
*Requirement:* No untracked temporary files, scratch scripts, or unintended edits.

### Step 2: Canonical Typecheck
```bash
npm run typecheck
```
*Requirement:* `tsc --noEmit` must exit with **code 0** and **0 errors**.

### Step 3: Canonical Build
```bash
npm run build
```
*Requirement:* `tsc` must compile all source files cleanly into `dist/`.

### Step 4: Full Test Suite Execution
```bash
npm test
```
*Requirement:* All vitest suites must pass with **0 skipped, 0 failing, and 0 focused tests**.

### Step 5: Package Contents & Size Audit
```bash
npm pack --dry-run
```
*Requirement:*
- Output archive must contain strictly: `dist/`, `manager/index.html`, `bridges/`, `rules/`, `skills/`, `plugin.json`, `mcp_config.json`, example configs, `README.md`, `LICENSE`.
- Archive must NOT contain `.env`, `data/`, `auth/`, test files, or node_modules.

### Step 6: Version Alignment Verification
Verify that the target release version matches across all project metadata files:
- `package.json` (`"version": "X.Y.Z"`)
- `package-lock.json` (`"version": "X.Y.Z"`)
- `plugin.json` (`"version": "X.Y.Z"`)
- `CHANGELOG.md` (`## [X.Y.Z] - YYYY-MM-DD`)

---

## 3. Tagging & Publication Procedure

Once the qualification checklist is fully verified and explicit approval is granted:

```bash
# 1. Create signed or annotated git tag
git tag -a v1.0.0 -m "Release v1.0.0: AgentForge V1 Production Platform"

# 2. Push tag to upstream origin
git push origin v1.0.0

# 3. Create GitHub Release
# Use the draft release notes prepared in docs/ releases
```

---

## 4. Rollback & Emergency Triage Procedure

If an unrecoverable bug or security regression is discovered in a published release:
1. Immediately file a security advisory or tracking issue.
2. If credentials or tokens were potentially exposed, revoke the affected OAuth credentials or tokens immediately at the provider console.
3. If necessary, mark the GitHub release as pre-release or deprecated with an advisory note directing users to a safe patch.
4. Prepare a patch release (`vX.Y.Z+1`) following the full qualification procedure.
