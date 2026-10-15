import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname, normalize } from 'node:path';
import { BridgeRegistry } from '../bridge-registry.js';
import { BridgeValidator } from '../bridge-validator.js';
import { GitExecutor } from '../executors/git-executor.js';

export const DEFAULT_PORT = 9470;
const ROOT = resolve(import.meta.dirname, '..', '..');
const MANAGER_DIR = join(ROOT, 'manager');
const BRIDGES_DIR = join(ROOT, 'bridges');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Read request body safely with a maximum byte limit to prevent DoS.
 */
function readRequestBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        rejectPromise(new Error('Payload too large'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf-8');
    });
    req.on('end', () => resolvePromise(body));
    req.on('error', rejectPromise);
  });
}

export function createManagerServer(port = DEFAULT_PORT): Server {
  const registry = new BridgeRegistry(BRIDGES_DIR);
  const validator = new BridgeValidator();
  const gitExecutor = new GitExecutor();

  const server = createServer(async (req, res) => {
    // Basic security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    const rawUrl = req.url ?? '/';
    let url: URL;
    try {
      url = new URL(rawUrl, `http://localhost:${port}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Malformed URL' }));
      return;
    }

    // ─── API Routes ───────────────────────────────────────────────

    // GET /api/status - Health check
    if (req.method === 'GET' && url.pathname === '/api/status') {
      await registry.discover();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        version: '0.1.0',
        bridgesCount: registry.list().length,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // GET /api/bridges - List installed bridges
    if (req.method === 'GET' && url.pathname === '/api/bridges') {
      try {
        await registry.discover();
        const bridges = registry.list();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bridges));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to load bridges: ${(err as Error).message}` }));
      }
      return;
    }

    // POST /api/validate - Validate a bridge manifest draft
    if (req.method === 'POST' && url.pathname === '/api/validate') {
      try {
        const body = await readRequestBody(req);
        const result = validator.validateJSON(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          valid: false,
          errors: [{ field: '(request)', message: (err as Error).message }],
          warnings: [],
        }));
      }
      return;
    }

    // GET /api/integrations - Check system tools and credentials
    if (req.method === 'GET' && url.pathname === '/api/integrations') {
      let gitOk = false;
      let gitVersion = '';
      try {
        const { stdout } = await gitExecutor.runGit(['--version']);
        gitOk = true;
        gitVersion = stdout;
      } catch {
        // Git missing
      }

      const status = {
        git: { available: gitOk, version: gitVersion, required: true },
        githubCli: { available: false, version: '', required: false, notes: 'Not installed. Optional.' },
        githubToken: {
          configured: Boolean(process.env.GITHUB_TOKEN),
          required: false,
          notes: process.env.GITHUB_TOKEN ? 'Token set via GITHUB_TOKEN environment variable' : 'Missing GITHUB_TOKEN environment variable',
        },
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // ─── Static File Serving (Hardened against Traversal) ─────────

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // Normalize path and prevent directory traversal
    const requestedFile = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const safePath = normalize(join(MANAGER_DIR, requestedFile));

    // Strict boundary enforcement: resolved path MUST be inside MANAGER_DIR
    if (!safePath.startsWith(MANAGER_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: Access outside manager directory is prohibited');
      return;
    }

    try {
      const content = await readFile(safePath);
      const ext = extname(safePath).toLowerCase();
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  });

  return server;
}

async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;
  const server = createManagerServer(port);

  server.listen(port, () => {
    console.log(`\n  ⚒️  AgentForge Manager`);
    console.log(`  ─────────────────────`);
    console.log(`  Dashboard:    http://localhost:${port}`);
    console.log(`  Health Check: http://localhost:${port}/api/status`);
    console.log(`  API Bridges:  http://localhost:${port}/api/bridges`);
    console.log(`  Press Ctrl+C to stop\n`);
  });
}

// Run main if this is the entry point
if (process.argv[1]?.endsWith('serve.ts') || process.argv[1]?.endsWith('serve.js')) {
  main().catch(console.error);
}
