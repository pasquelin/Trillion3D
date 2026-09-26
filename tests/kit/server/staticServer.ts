// The bench harness server, on the one static server: the harness page, the RGBA captures the page
// posts, and page modules served as TypeScript stripped of their types, without a build step.
import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { transformSync } from 'esbuild';
import {
  contentType,
  listen,
  reply,
  staticServer,
  type Mount,
} from '../../../scripts/static-server.ts';

const TYPESCRIPT = /\.m?ts$/;

/** One RGBA capture the page posted, or `null` when its byte count did not match `w × h × 4`. */
export type Capture = { body: Buffer; w: number; h: number } | null;

/** The harness page: an import map, and nothing else. Everything else comes from `evaluate`. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Trillion3D measurement bench</title>
<script type="importmap">{"imports":{
 "three":"/vendor/three/build/three.module.js",
 "three/addons/":"/vendor/three/examples/jsm/",
 "meshoptimizer":"/vendor/meshoptimizer/index.module.js"
}}</script>
<style>html,body{margin:0;background:#2a303c}</style>
`;

/** `source`, the TypeScript module read from `file`, as the ES module a browser runs. */
export function stripTypes(source: string, file: string): string {
  return transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022', sourcefile: file })
    .code;
}

function takeCapture(
  req: IncomingMessage,
  url: URL,
  captures: Map<string, Capture>,
  res: ServerResponse,
) {
  const parts: Buffer[] = [];
  req.on('data', (chunk: Buffer) => parts.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(parts);
    const w = Number(url.searchParams.get('w')),
      h = Number(url.searchParams.get('h'));
    const complete = body.length === w * h * 4;
    captures.set(url.searchParams.get('file') ?? '', complete ? { body, w, h } : null);
    reply(res, complete ? 200 : 400, undefined, String(body.length));
  });
  return true;
}

/**
 * Headers that isolate the page across origins, and nothing else. Without them, `crossOriginIsolated`
 * is false in the browser and the SDK keeps its transfer path: it is this flag, and it
 * alone, that puts the harness on the shared-memory side. False by default, so the
 * reference measurement does not change path unless asked.
 */
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};

/** Listens on `port`, serves `mounts`, stores captures in `captures`. `isolation` sets COOP and
 *  COEP on each response. */
export async function startServer({
  port = 0,
  mounts,
  captures = new Map(),
  isolation = false,
}: {
  port?: number;
  mounts: Mount[];
  captures?: Map<string, Capture>;
  isolation?: boolean;
}): Promise<{ server: Server; port: number }> {
  const server = staticServer({
    mounts,
    headers: { 'cache-control': 'no-store', ...(isolation ? ISOLATION : {}) },
    transform: (file) =>
      TYPESCRIPT.test(file)
        ? { type: contentType('.js'), text: stripTypes(readFileSync(file, 'utf8'), file) }
        : undefined,
    answer: (req, res, url) => {
      if (req.method === 'POST' && url.pathname === '/capture')
        return takeCapture(req, url, captures, res);
      // The browser asks for a tab icon this harness does not have: answer rather than
      // let a 404 pollute page errors.
      if (url.pathname === '/favicon.ico') return reply(res, 204);
      if (url.pathname === '/' || url.pathname === '/index.html')
        return reply(res, 200, contentType('.html'), PAGE);
      return false;
    },
  });
  return { server, port: await listen(server, port) };
}
