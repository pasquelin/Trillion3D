import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

/** One HTTP request the fixture server served, kept as evidence of what the browser proof reached. */
export interface RequestRecord {
  path: string;
  status: number;
}

export function installedServer(
  root: string,
  html: string,
  requests: RequestRecord[],
  allowNodeModules: boolean,
) {
  return createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    const url = new URL(request.url ?? '/', 'http://fixture');
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
    if (!relative) {
      response.writeHead(200, { 'content-type': MIME['.html'] });
      response.end(html);
      return;
    }
    if (relative === 'favicon.ico') return response.writeHead(204).end();
    if (relative.startsWith('..') || (!allowNodeModules && relative.includes('node_modules'))) {
      requests.push({ path: url.pathname, status: 403 });
      return response.writeHead(403).end();
    }
    try {
      const body = await readFile(join(root, relative));
      requests.push({ path: url.pathname, status: 200 });
      response.writeHead(200, {
        'content-type': MIME[extname(relative)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      requests.push({ path: url.pathname, status: 404 });
      response.writeHead(404).end();
    }
  });
}

export const evidenceRequests = (requests: RequestRecord[]): RequestRecord[] =>
  requests.filter(
    ({ path, status }) =>
      status >= 400 ||
      path === '/explorer.js' ||
      path.startsWith('/chunks/') ||
      path.includes('/native-cache') ||
      path.endsWith('Worker.js') ||
      path.endsWith('.wasm'),
  );
