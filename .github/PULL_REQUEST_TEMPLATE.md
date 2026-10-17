## Description

Please include a summary of the changes and the related issue/feature motivation. Include relevant architectural rationale and context.

Fixes #(issue)

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds capability)
- [ ] Breaking change (fix or feature that would cause existing workflows/bridges to behave differently)
- [ ] Documentation update
- [ ] Security enhancement

## Architectural & Security Verification

- [ ] **Local-First Invariant:** No centralized external telemetry, proxy relays, or telemetry endpoints introduced.
- [ ] **Deterministic Permissions:** Any new action properly declares its permission tier (`read`, `local-write`, `external-write`, `publish`, `destructive`) and approval requirements.
- [ ] **Secret Redaction:** No credentials, API tokens, or secrets are leaked into logs, test fixtures, or state outputs.
- [ ] **OS-Protected Storage:** Any new token persistence integrates with `CredentialStore` (Windows DPAPI / AES-256-GCM).
- [ ] **Test Coverage:** Added corresponding unit and integration tests under `src/` validating positive paths, edge cases, and failure modes.

## Verification Checklist

- [ ] `npm run typecheck` passes with 0 errors.
- [ ] `npm run build` compiles clean to `dist/`.
- [ ] `npm test` passes all test suites.
- [ ] `npm pack --dry-run` confirms clean tarball contents without unneeded files or secrets.
- [ ] Documentation updated in `docs/` where relevant.
