import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import logger from '../utils/logger.js';
import { handleWebAppApi } from './api.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

let server: http.Server | null = null;

function resolveWebAppFile(urlPath: string): string | null {
  const root = path.resolve(process.cwd(), 'webapp');
  const requested = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, requested);
  const relativeToRoot = path.relative(root, filePath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  return filePath;
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const filePath = resolveWebAppFile(urlPath);

  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const extension = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

export function startWebAppServer(port: number): void {
  if (server) {
    return;
  }

  server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    void handleWebAppApi(req, res, urlPath).then((handled) => {
      if (!handled) {
        serveStatic(res, urlPath);
      }
    }).catch((error) => {
      logger.error('WebApp request error:', error);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal error');
      }
    });
  });

  server.on('error', (error) => {
    logger.error('WebApp server error:', error);
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info(`WebApp server listening on port ${port}`);
  });
}

export function stopWebAppServer(): Promise<void> {
  if (!server) {
    return Promise.resolve();
  }

  const current = server;
  server = null;

  return new Promise((resolve, reject) => {
    current.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
