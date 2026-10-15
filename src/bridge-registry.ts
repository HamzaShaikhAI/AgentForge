import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BridgeManifest,
  BridgeRegistryEntry,
  ValidationResult,
} from './types.js';
import { BridgeValidator } from './bridge-validator.js';

/**
 * Bridge registry discovers, loads, validates and manages bridge definitions.
 * Bridges are stored as bridge.json files in the bridges/ directory.
 */
export class BridgeRegistry {
  private entries: Map<string, BridgeRegistryEntry> = new Map();
  private validator = new BridgeValidator();
  private bridgesDir: string;

  constructor(bridgesDir: string) {
    this.bridgesDir = resolve(bridgesDir);
  }

  /**
   * Discover and load all bridge manifests from the bridges directory.
   */
  async discover(): Promise<{ loaded: string[]; errors: Array<{ path: string; errors: string[] }> }> {
    const loaded: string[] = [];
    const errors: Array<{ path: string; errors: string[] }> = [];

    let entries: string[];
    try {
      entries = await readdir(this.bridgesDir);
    } catch {
      // Directory doesn't exist yet — not an error
      return { loaded, errors };
    }

    for (const entry of entries) {
      const entryPath = join(this.bridgesDir, entry);
      const entryStat = await stat(entryPath).catch(() => null);
      if (!entryStat?.isDirectory()) continue;

      const manifestPath = join(entryPath, 'bridge.json');
      try {
        const content = await readFile(manifestPath, 'utf-8');
        const result = this.validator.validateJSON(content);

        if (result.valid && result.manifest) {
          this.entries.set(result.manifest.name, {
            manifest: result.manifest,
            path: manifestPath,
            enabled: true,
            integrationStatus: {},
            lastValidated: new Date().toISOString(),
          });
          loaded.push(result.manifest.name);
        } else {
          errors.push({
            path: manifestPath,
            errors: result.errors.map(e => `${e.field}: ${e.message}`),
          });
        }
      } catch (e) {
        // No bridge.json in this directory — skip silently
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          errors.push({ path: manifestPath, errors: [(e as Error).message] });
        }
      }
    }

    return { loaded, errors };
  }

  /**
   * Register a bridge manifest directly (for programmatic use).
   */
  register(manifest: BridgeManifest, path: string): ValidationResult {
    const result = this.validator.validate(manifest);
    if (result.valid) {
      this.entries.set(manifest.name, {
        manifest,
        path,
        enabled: true,
        integrationStatus: {},
        lastValidated: new Date().toISOString(),
      });
    }
    return result;
  }

  /**
   * Get a bridge by name.
   */
  get(name: string): BridgeRegistryEntry | undefined {
    return this.entries.get(name);
  }

  /**
   * List all registered bridges.
   */
  list(): BridgeRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * List bridges filtered by category.
   */
  listByCategory(category: string): BridgeRegistryEntry[] {
    return this.list().filter(e => e.manifest.category === category);
  }

  /**
   * Search bridges by name, description, or tags.
   */
  search(query: string): BridgeRegistryEntry[] {
    const q = query.toLowerCase();
    return this.list().filter(e => {
      const m = e.manifest;
      return (
        m.name.includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        (m.tags?.some(t => t.toLowerCase().includes(q)) ?? false)
      );
    });
  }

  /**
   * Enable or disable a bridge.
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    entry.enabled = enabled;
    return true;
  }

  /**
   * Remove a bridge from the registry.
   */
  unregister(name: string): boolean {
    return this.entries.delete(name);
  }

  /**
   * Get the bridges directory path.
   */
  getBridgesDir(): string {
    return this.bridgesDir;
  }
}
