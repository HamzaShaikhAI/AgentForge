import { BridgeManifest, ValidationResult } from '../types.js';
import { BridgeValidator } from '../bridge-validator.js';
import { SecurityAnalysisResult, SecurityFinding } from './types.js';

const DANGEROUS_PATTERNS: Array<{
  check: string;
  pattern: RegExp;
  message: string;
  severity: 'error' | 'warning';
}> = [
  {
    check: 'code-injection',
    pattern: /\beval\s*\(/g,
    message: 'Forbidden use of eval() detected in executor code.',
    severity: 'error',
  },
  {
    check: 'code-injection',
    pattern: /\bnew\s+Function\s*\(/g,
    message: 'Forbidden dynamic Function constructor execution detected.',
    severity: 'error',
  },
  {
    check: 'unsafe-shell-exec',
    pattern: /(?:child_process|cp)\.(?:exec|execSync)\s*\(\s*`[^`]*\$\{/g,
    message: 'Unsafe shell execution with template literal interpolation detected. Use execFile or spawn with argument arrays.',
    severity: 'error',
  },
  {
    check: 'unsafe-shell-exec',
    pattern: /(?:sh\s+-c|cmd(?:\.exe)?\s+\/c)\s+/gi,
    message: 'Direct shell interpreter invocation detected.',
    severity: 'error',
  },
  {
    check: 'path-traversal',
    pattern: /(?:\.\.[\\/]){2,}/g,
    message: 'Suspected path traversal pattern (multiple "../" segments) detected.',
    severity: 'error',
  },
  {
    check: 'secret-leakage',
    pattern: /ya29\.[a-zA-Z0-9_-]{20,}/g,
    message: 'Hardcoded Google OAuth access token detected.',
    severity: 'error',
  },
  {
    check: 'secret-leakage',
    pattern: /ghp_[a-zA-Z0-9]{20,}/g,
    message: 'Hardcoded GitHub personal access token detected.',
    severity: 'error',
  },
  {
    check: 'secret-leakage',
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    message: 'Hardcoded secret API key (sk-*) detected.',
    severity: 'error',
  },
  {
    check: 'secret-leakage',
    pattern: /AIza[0-9A-Za-z-_]{35}/g,
    message: 'Hardcoded Google API key detected.',
    severity: 'error',
  },
  {
    check: 'secret-leakage',
    pattern: /Bearer\s+['"][a-zA-Z0-9_\-\.]{25,}['"]/gi,
    message: 'Hardcoded Bearer authentication token detected.',
    severity: 'error',
  },
  {
    check: 'suspicious-network',
    pattern: /https?:\/\/(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?/g,
    message: 'Hardcoded raw IP address in network endpoint detected.',
    severity: 'warning',
  },
];

export class SecurityAnalyzer {
  private validator = new BridgeValidator();

  /**
   * Run static security analysis on a bridge manifest, its executor code, and test suite.
   */
  analyze(
    manifest: BridgeManifest,
    executorCode: string = '',
    testCode: string = '',
  ): SecurityAnalysisResult {
    const findings: SecurityFinding[] = [];

    // 1. Manifest Schema Validation
    const valResult: ValidationResult = this.validator.validate(manifest);
    if (!valResult.valid) {
      for (const err of valResult.errors) {
        findings.push({
          severity: 'error',
          check: 'manifest-schema',
          message: `Schema error in ${err.field}: ${err.message}`,
        });
      }
    }

    // 2. Permission Rigor & Dangerous Action Analysis
    this.checkPermissionPolicies(manifest, findings);

    // 3. Executor Code Completeness (Every declared capability must have a real handler)
    this.checkActionCompleteness(manifest, executorCode, findings);

    // 4. Code Pattern Scans (Traversal, Shell Exec, Injection, Secret Leaks)
    this.scanCodePatterns(executorCode, 'executor', findings);
    this.scanCodePatterns(testCode, 'test', findings);

    const hasErrors = findings.some(f => f.severity === 'error');
    const safePermissions = !findings.some(f => f.check === 'permission-rigor');
    const noFakeActions = !findings.some(f => f.check === 'action-completeness');
    const noInjections = !findings.some(f => f.check === 'code-injection' || f.check === 'unsafe-shell-exec');
    const noSecretLeaks = !findings.some(f => f.check === 'secret-leakage');

    return {
      passed: !hasErrors,
      findings,
      safePermissions,
      noFakeActions,
      noInjections,
      noSecretLeaks,
    };
  }

  /**
   * Verify that every capability in the manifest is actually handled in the executor.
   */
  private checkActionCompleteness(
    manifest: BridgeManifest,
    executorCode: string,
    findings: SecurityFinding[],
  ): void {
    if (!manifest.capabilities || manifest.capabilities.length === 0) return;

    if (!executorCode || !executorCode.trim()) {
      findings.push({
        severity: 'error',
        check: 'action-completeness',
        message: 'Executor implementation code is empty. Real executable capabilities require an executor.',
      });
      return;
    }

    for (const cap of manifest.capabilities) {
      const action = cap.action;
      // Check if action identifier is referenced in the executor code (e.g. in a case statement, method, or dispatch table)
      const actionMatch = new RegExp(`['"\`]${action}['"\`]|case\\s+['"]${action}['"]|async\\s+${this.toCamelCase(action)}\\s*\\(`, 'i');

      if (!actionMatch.test(executorCode)) {
        findings.push({
          severity: 'error',
          check: 'action-completeness',
          message: `Action "${action}" is advertised in manifest capabilities but has no implementation handler in the executor code.`,
        });
      }
    }
  }

  /**
   * Enforce conservative permission inference and mandatory approval policies.
   */
  private checkPermissionPolicies(
    manifest: BridgeManifest,
    findings: SecurityFinding[],
  ): void {
    if (!manifest.capabilities) return;

    for (const cap of manifest.capabilities) {
      const action = cap.action.toLowerCase();
      const desc = cap.description.toLowerCase();

      // Destructive actions: delete, remove, drop, purge, destroy, terminate, wipe
      const isDestructive = /\b(delete|remove|drop|purge|destroy|terminate|wipe|erase|clear-all)\b/.test(action) ||
                            /\b(delete|remove|drop|purge|destroy|terminate|wipe|erase)\b/.test(desc);

      if (isDestructive) {
        if (cap.permissionLevel !== 'destructive') {
          findings.push({
            severity: 'error',
            check: 'permission-rigor',
            message: `Action "${cap.action}" performs destructive operations but declared permissionLevel is "${cap.permissionLevel}". Must be "destructive".`,
          });
        }
      }

      // Publishing actions: publish, release, deploy, upload, broadcast
      const isPublish = /\b(publish|release|deploy|upload|broadcast)\b/.test(action) ||
                        /\b(publish|release|deploy|upload|broadcast)\b/.test(desc);

      if (isPublish && !isDestructive) {
        if (cap.permissionLevel !== 'publish') {
          findings.push({
            severity: 'error',
            check: 'permission-rigor',
            message: `Action "${cap.action}" publishes external artifacts but declared permissionLevel is "${cap.permissionLevel}". Must be "publish".`,
          });
        }
      }

      // External write actions: push, post, write-remote, send, submit, create-issue, update-record
      const isExternalWrite = /\b(push|post|send|submit|create-|update-|modify-|patch-)\b/.test(action);
      if (isExternalWrite && !isDestructive && !isPublish) {
        if (cap.permissionLevel === 'read' || cap.permissionLevel === 'local-write') {
          findings.push({
            severity: 'error',
            check: 'permission-rigor',
            message: `Action "${cap.action}" performs external state modifications but declared permissionLevel is "${cap.permissionLevel}". Must be at least "external-write".`,
          });
        }
      }

      // Irreversible or externally visible actions MUST require approval in permissions rules
      const highRisk = cap.permissionLevel === 'publish' || cap.permissionLevel === 'destructive' || cap.permissionLevel === 'external-write';
      if (highRisk) {
        const matchingRule = manifest.permissions?.find(p => {
          if (p.actions === '*' || p.actions === cap.action) return true;
          if (p.actions.includes('*')) {
            const regex = new RegExp(`^${p.actions.replace(/\*/g, '.*')}$`);
            return regex.test(cap.action);
          }
          return false;
        });

        if (!matchingRule || !matchingRule.requiresApproval) {
          findings.push({
            severity: 'error',
            check: 'permission-rigor',
            message: `Action "${cap.action}" has high-risk permission level "${cap.permissionLevel}" but does not have a permission rule requiring explicit operator approval (requiresApproval: true).`,
          });
        }
      }
    }
  }

  private scanCodePatterns(
    code: string,
    fileLabel: 'executor' | 'test',
    findings: SecurityFinding[],
  ): void {
    if (!code) return;

    for (const rule of DANGEROUS_PATTERNS) {
      // In test code, ignore path-traversal checks because tests test negative traversal safeguards
      if (fileLabel === 'test' && rule.check === 'path-traversal') {
        continue;
      }
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = rule.pattern.exec(code)) !== null) {
        const snippet = match[0];
        findings.push({
          severity: rule.severity,
          check: rule.check,
          message: `[${fileLabel}] ${rule.message}`,
          codeSnippet: snippet.length > 80 ? snippet.slice(0, 80) + '...' : snippet,
        });
      }
    }
  }

  private toCamelCase(str: string): string {
    return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }
}
