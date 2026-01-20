import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import logger from '../utils/logger.js';
import { env } from '../utils/env.js';
import { getDashboardSummary, getDashboardTimeseries } from './dashboard-metrics.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (method === 'GET' && url.pathname === '/healthz') {
    sendText(res, 200, 'ok');
    return;
  }

  if (method === 'GET' && url.pathname === '/api/dashboard/summary') {
    const summary = await getDashboardSummary();
    sendJson(res, 200, summary);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/dashboard/timeseries') {
    const days = Number(url.searchParams.get('days') ?? 30);
    const result = await getDashboardTimeseries(days);
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

export function startHttpServer(): http.Server {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      logger.error('HTTP server request error:', err);
      sendJson(res, 500, { error: 'Internal error' });
    });
  });

  server.listen(env.HTTP_PORT, () => {
    logger.info(`HTTP server listening on :${env.HTTP_PORT}`);
  });

  return server;
}

