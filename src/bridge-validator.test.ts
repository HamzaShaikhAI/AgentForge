import { describe, it, expect } from 'vitest';
import { BridgeValidator } from './bridge-validator.js';

const validManifest = {
  schema: '1.0',
  name: 'test-bridge',
  displayName: 'Test Bridge',
  description: 'A test bridge for validation',
  version: '1.0.0',
  category: 'development',
  capabilities: [
    {
      action: 'test-action',
      description: 'A test action',
      permissionLevel: 'read',
      sideEffects: false,
    },
  ],
  integrations: [],
  auth: [],
  permissions: [
    {
      actions: 'test-action',
      level: 'read',
      requiresApproval: false,
    },
  ],
};

describe('BridgeValidator', () => {
  const validator = new BridgeValidator();

  describe('validate()', () => {
    it('accepts a valid minimal manifest', () => {
      const result = validator.validate(validManifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects null input', () => {
      const result = validator.validate(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('non-null object');
    });

    it('rejects non-object input', () => {
      const result = validator.validate('not an object');
      expect(result.valid).toBe(false);
    });

    it('rejects wrong schema version', () => {
      const result = validator.validate({ ...validManifest, schema: '2.0' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'schema')).toBe(true);
    });

    it('rejects invalid name format', () => {
      const result = validator.validate({ ...validManifest, name: 'Invalid Name!' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'name')).toBe(true);
    });

    it('rejects missing displayName', () => {
      const { displayName, ...noDisplay } = validManifest;
      const result = validator.validate(noDisplay);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'displayName')).toBe(true);
    });

    it('rejects invalid semver', () => {
      const result = validator.validate({ ...validManifest, version: 'not-semver' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'version')).toBe(true);
    });

    it('rejects empty capabilities', () => {
      const result = validator.validate({ ...validManifest, capabilities: [] });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'capabilities')).toBe(true);
    });

    it('rejects duplicate action names', () => {
      const dupe = {
        ...validManifest,
        capabilities: [
          { action: 'dup', description: 'First', permissionLevel: 'read', sideEffects: false },
          { action: 'dup', description: 'Second', permissionLevel: 'read', sideEffects: false },
        ],
      };
      const result = validator.validate(dupe);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Duplicate'))).toBe(true);
    });

    it('rejects invalid permission level in capability', () => {
      const bad = {
        ...validManifest,
        capabilities: [
          { action: 'x', description: 'X', permissionLevel: 'super-admin', sideEffects: false },
        ],
      };
      const result = validator.validate(bad);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid category', () => {
      const result = validator.validate({ ...validManifest, category: 'invalid-cat' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'category')).toBe(true);
    });

    it('warns when no category is specified', () => {
      const { category, ...noCat } = validManifest;
      const result = validator.validate(noCat);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('validates integration check fields', () => {
      const bad = {
        ...validManifest,
        integrations: [
          { name: 'test', check: { type: 'invalid', value: '' }, required: true },
        ],
      };
      const result = validator.validate(bad);
      expect(result.valid).toBe(false);
    });

    it('validates auth requirement fields', () => {
      const bad = {
        ...validManifest,
        auth: [
          { name: 'token', type: 'magic', description: 'Magic auth', required: true },
        ],
      };
      const result = validator.validate(bad);
      expect(result.valid).toBe(false);
    });

    it('accepts valid auth with all types', () => {
      const good = {
        ...validManifest,
        auth: [
          { name: 'a', type: 'env-var', envVar: 'MY_TOKEN', description: 'Token', required: true },
          { name: 'b', type: 'cli-auth', description: 'CLI', required: false },
        ],
      };
      const result = validator.validate(good);
      expect(result.valid).toBe(true);
    });

    it('warns when env-var auth has no envVar', () => {
      const manifest = {
        ...validManifest,
        auth: [
          { name: 'token', type: 'env-var', description: 'Token', required: false },
        ],
      };
      const result = validator.validate(manifest);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('envVar'))).toBe(true);
    });
  });

  describe('validateJSON()', () => {
    it('parses valid JSON and validates', () => {
      const result = validator.validateJSON(JSON.stringify(validManifest));
      expect(result.valid).toBe(true);
      expect(result.manifest).toBeDefined();
      expect(result.manifest!.name).toBe('test-bridge');
    });

    it('rejects invalid JSON', () => {
      const result = validator.validateJSON('{not json}');
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Invalid JSON');
    });

    it('does not return manifest when validation fails', () => {
      const result = validator.validateJSON(JSON.stringify({ schema: 'wrong' }));
      expect(result.valid).toBe(false);
      expect(result.manifest).toBeUndefined();
    });
  });
});
