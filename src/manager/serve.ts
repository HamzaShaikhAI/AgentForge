import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { BridgeRegistry } from '../bridge-registry.js';

const PORT = 9470;
const ROOT = resolve(import.meta.dirname, '..', '..');
const MANAGER_DIR = join(ROOT, 'manager');
const BRIDGES_DIR = join(ROOT, 'bridges');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function main() {
  const registry = new BridgeRegistry(BRIDGES_DIR);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // API routes
    if (url.pathname === '/api/bridges') {
      await registry.discover();
      const bridges = registry.list();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(bridges));
      return;
    }

    // Static files
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    
    // Serve from manager/ directory first, then root
    let fullPath = join(MANAGER_DIR, filePath);
    let content: string | Buffer;
    try {
      content = await readFile(fullPath);
    } catch {
      // Try from project root
      fullPath = join(ROOT, filePath);
      try {
        content = await readFile(fullPath);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
    }

    const ext = extname(fullPath);
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  });

  server.listen(PORT, () => {
    console.log(`\n  ⚒️  AgentForge Manager`);
    console.log(`  ─────────────────────`);
    console.log(`  Dashboard:  http://localhost:${PORT}`);
    console.log(`  Bridges:    http://localhost:${PORT}/api/bridges`);
    console.log(`  Press Ctrl+C to stop\n`);
  });
}

main().catch(console.error);
