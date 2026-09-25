import type { Server } from 'node:http';
import { relative } from 'node:path';
import { contentType, reply, staticServer } from './static-server.ts';

const CHARSET = ['.html', '.js'];

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
): Server {
  return staticServer({
    mounts: [{ prefix: '/', dir: root }],
    headers: { 'access-control-allow-origin': '*' },
    charset: CHARSET,
    refuse: (file) => !allowNodeModules && relative(root, file).includes('node_modules'),
    answer: (_request, response, { pathname }) => {
      if (pathname === '/') return reply(response, 200, contentType('.html', CHARSET), html);
      if (pathname === '/favicon.ico') return reply(response, 204);
      response.once('finish', () => requests.push({ path: pathname, status: response.statusCode }));
      return false;
    },
  });
}

export const evidenceRequests = (requests: RequestRecord[]): RequestRecord[] =>
  requests.filter(
    ({ path, status }) =>
      status >= 400 ||
      path.endsWith('.js') ||
      path.includes('/native-cache') ||
      path.endsWith('.wasm'),
  );
