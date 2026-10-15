import {
  BridgeManifest,
  BridgeCapability,
  IntegrationRequirement,
  AuthRequirement,
  PermissionRule,
  PermissionLevel,
  PERMISSION_HIERARCHY,
  ValidationResult,
  ValidationError,
  BridgeCategory,
} from './types.js';

const VALID_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const VALID_SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
const VALID_CATEGORIES: BridgeCategory[] = [
  'source-control', 'ci-cd', 'communication', 'content-creation',
  'social-media', 'cloud-services', 'productivity', 'development', 'media', 'other',
];
const VALID_PERMISSION_LEVELS: PermissionLevel[] = ['read', 'local-write', 'external-write', 'publish', 'destructive'];
const VALID_CHECK_TYPES = ['command', 'env-var', 'file', 'mcp-server'] as const;
const VALID_AUTH_TYPES = ['env-var', 'oauth', 'token-file', 'cli-auth', 'api-key'] as const;

export class BridgeValidator {
  /**
   * Validate a bridge manifest object.
   * Returns errors for invalid definitions with useful messages.
   */
  validate(manifest: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, errors: [{ field: '(root)', message: 'Manifest must be a non-null object' }], warnings };
    }

    const m = manifest as Record<string, unknown>;

    // Schema version
    if (m.schema !== '1.0') {
      errors.push({ field: 'schema', message: "Must be '1.0'", value: m.schema });
    }

    // Name
    if (typeof m.name !== 'string' || !m.name) {
      errors.push({ field: 'name', message: 'Required string, lowercase kebab-case' });
    } else if (!VALID_NAME_PATTERN.test(m.name)) {
      errors.push({ field: 'name', message: 'Must be lowercase kebab-case (e.g., "my-bridge")', value: m.name });
    }

    // Display name
    if (typeof m.displayName !== 'string' || !m.displayName) {
      errors.push({ field: 'displayName', message: 'Required non-empty string' });
    }

    // Description
    if (typeof m.description !== 'string' || !m.description) {
      errors.push({ field: 'description', message: 'Required non-empty string' });
    }

    // Version
    if (typeof m.version !== 'string' || !m.version) {
      errors.push({ field: 'version', message: 'Required semver string' });
    } else if (!VALID_SEMVER_PATTERN.test(m.version)) {
      errors.push({ field: 'version', message: 'Must be valid semver (e.g., "1.0.0")', value: m.version });
    }

    // Category (optional)
    if (m.category !== undefined) {
      if (!VALID_CATEGORIES.includes(m.category as BridgeCategory)) {
        errors.push({ field: 'category', message: `Must be one of: ${VALID_CATEGORIES.join(', ')}`, value: m.category });
      }
    } else {
      warnings.push('No category specified; consider adding one for discoverability');
    }

    // Author (optional)
    if (m.author !== undefined && typeof m.author !== 'string') {
      errors.push({ field: 'author', message: 'Must be a string if provided' });
    }

    // Capabilities (required array)
    if (!Array.isArray(m.capabilities)) {
      errors.push({ field: 'capabilities', message: 'Required array of capability definitions' });
    } else if (m.capabilities.length === 0) {
      errors.push({ field: 'capabilities', message: 'Must define at least one capability' });
    } else {
      const actionNames = new Set<string>();
      for (let i = 0; i < m.capabilities.length; i++) {
        const cap = m.capabilities[i];
        const prefix = `capabilities[${i}]`;
        this.validateCapability(cap, prefix, errors, actionNames);
      }
    }

    // Integrations (required array, can be empty)
    if (!Array.isArray(m.integrations)) {
      errors.push({ field: 'integrations', message: 'Required array (can be empty)' });
    } else {
      for (let i = 0; i < m.integrations.length; i++) {
        this.validateIntegration(m.integrations[i], `integrations[${i}]`, errors);
      }
    }

    // Auth (required array, can be empty)
    if (!Array.isArray(m.auth)) {
      errors.push({ field: 'auth', message: 'Required array (can be empty)' });
    } else {
      for (let i = 0; i < m.auth.length; i++) {
        this.validateAuth(m.auth[i], `auth[${i}]`, errors, warnings);
      }
    }

    // Permissions (required array)
    if (!Array.isArray(m.permissions)) {
      errors.push({ field: 'permissions', message: 'Required array' });
    } else {
      for (let i = 0; i < m.permissions.length; i++) {
        this.validatePermission(m.permissions[i], `permissions[${i}]`, errors);
      }
    }

    // Tags (optional)
    if (m.tags !== undefined) {
      if (!Array.isArray(m.tags) || !m.tags.every((t: unknown) => typeof t === 'string')) {
        errors.push({ field: 'tags', message: 'Must be an array of strings' });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate and parse a JSON string as a bridge manifest.
   */
  validateJSON(json: string): ValidationResult & { manifest?: BridgeManifest } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      return {
        valid: false,
        errors: [{ field: '(root)', message: `Invalid JSON: ${(e as Error).message}` }],
        warnings: [],
      };
    }
    const result = this.validate(parsed);
    return {
      ...result,
      manifest: result.valid ? (parsed as BridgeManifest) : undefined,
    };
  }

  private validateCapability(
    cap: unknown,
    prefix: string,
    errors: ValidationError[],
    actionNames: Set<string>,
  ): void {
    if (!cap || typeof cap !== 'object') {
      errors.push({ field: prefix, message: 'Must be an object' });
      return;
    }
    const c = cap as Record<string, unknown>;

    if (typeof c.action !== 'string' || !c.action) {
      errors.push({ field: `${prefix}.action`, message: 'Required non-empty string' });
    } else if (actionNames.has(c.action)) {
      errors.push({ field: `${prefix}.action`, message: `Duplicate action name: "${c.action}"`, value: c.action });
    } else {
      actionNames.add(c.action);
    }

    if (typeof c.description !== 'string' || !c.description) {
      errors.push({ field: `${prefix}.description`, message: 'Required non-empty string' });
    }

    if (!VALID_PERMISSION_LEVELS.includes(c.permissionLevel as PermissionLevel)) {
      errors.push({
        field: `${prefix}.permissionLevel`,
        message: `Must be one of: ${VALID_PERMISSION_LEVELS.join(', ')}`,
        value: c.permissionLevel,
      });
    }

    if (typeof c.sideEffects !== 'boolean') {
      errors.push({ field: `${prefix}.sideEffects`, message: 'Required boolean' });
    }
  }

  private validateIntegration(
    integ: unknown,
    prefix: string,
    errors: ValidationError[],
  ): void {
    if (!integ || typeof integ !== 'object') {
      errors.push({ field: prefix, message: 'Must be an object' });
      return;
    }
    const i = integ as Record<string, unknown>;

    if (typeof i.name !== 'string' || !i.name) {
      errors.push({ field: `${prefix}.name`, message: 'Required non-empty string' });
    }
    if (typeof i.required !== 'boolean') {
      errors.push({ field: `${prefix}.required`, message: 'Required boolean' });
    }

    // Check
    if (!i.check || typeof i.check !== 'object') {
      errors.push({ field: `${prefix}.check`, message: 'Required object with type and value' });
    } else {
      const check = i.check as Record<string, unknown>;
      if (!VALID_CHECK_TYPES.includes(check.type as typeof VALID_CHECK_TYPES[number])) {
        errors.push({
          field: `${prefix}.check.type`,
          message: `Must be one of: ${VALID_CHECK_TYPES.join(', ')}`,
          value: check.type,
        });
      }
      if (typeof check.value !== 'string' || !check.value) {
        errors.push({ field: `${prefix}.check.value`, message: 'Required non-empty string' });
      }
    }
  }

  private validateAuth(
    auth: unknown,
    prefix: string,
    errors: ValidationError[],
    warnings: string[],
  ): void {
    if (!auth || typeof auth !== 'object') {
      errors.push({ field: prefix, message: 'Must be an object' });
      return;
    }
    const a = auth as Record<string, unknown>;

    if (typeof a.name !== 'string' || !a.name) {
      errors.push({ field: `${prefix}.name`, message: 'Required non-empty string' });
    }
    if (!VALID_AUTH_TYPES.includes(a.type as typeof VALID_AUTH_TYPES[number])) {
      errors.push({
        field: `${prefix}.type`,
        message: `Must be one of: ${VALID_AUTH_TYPES.join(', ')}`,
        value: a.type,
      });
    }
    if (typeof a.description !== 'string' || !a.description) {
      errors.push({ field: `${prefix}.description`, message: 'Required non-empty string' });
    }
    if (typeof a.required !== 'boolean') {
      errors.push({ field: `${prefix}.required`, message: 'Required boolean' });
    }

    // Warn if env-var type but no envVar specified
    if (a.type === 'env-var' && !a.envVar) {
      warnings.push(`${prefix}: auth type is 'env-var' but no envVar name specified`);
    }
  }

  private validatePermission(
    perm: unknown,
    prefix: string,
    errors: ValidationError[],
  ): void {
    if (!perm || typeof perm !== 'object') {
      errors.push({ field: prefix, message: 'Must be an object' });
      return;
    }
    const p = perm as Record<string, unknown>;

    if (typeof p.actions !== 'string' || !p.actions) {
      errors.push({ field: `${prefix}.actions`, message: 'Required non-empty string (glob pattern)' });
    }
    if (!VALID_PERMISSION_LEVELS.includes(p.level as PermissionLevel)) {
      errors.push({
        field: `${prefix}.level`,
        message: `Must be one of: ${VALID_PERMISSION_LEVELS.join(', ')}`,
        value: p.level,
      });
    }
    if (typeof p.requiresApproval !== 'boolean') {
      errors.push({ field: `${prefix}.requiresApproval`, message: 'Required boolean' });
    }
  }
}
