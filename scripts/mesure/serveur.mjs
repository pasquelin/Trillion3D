// Static harness server, for `banc.mjs`. Nothing is written here: the server
// reads the dists, the browser dependencies and the bench assets, and takes in the
// RGBA captures the page posts to it.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import http from 'node:http';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
};

/** The harness page: an import map, and nothing else. Everything else comes from `evaluate`. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>WebGeometry measurement bench</title>
<script type="importmap">{"imports":{
 "three":"/vendor/three/build/three.module.js",
 "three/addons/":"/vendor/three/examples/jsm/",
 "meshoptimizer":"/vendor/meshoptimizer/index.module.js"
}}</script>
<style>html,body{margin:0;background:#2a303c}</style>
`;

function serveFile(mount, pathname, res) {
  const rest = decodeURIComponent(pathname.slice(mount.prefix.length));
  if (rest.includes('..')) {
    res.statusCode = 400;
    return res.end('path refused');
  }
  const file = join(mount.dir, rest);
  if (!file.startsWith(mount.dir) || !existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    return res.end('not found');
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

function takeCapture(req, url, captures, res) {
  const parts = [];
  req.on('data', (chunk) => parts.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(parts);
    const w = Number(url.searchParams.get('w')),
      h = Number(url.searchParams.get('h'));
    const complete = body.length === w * h * 4;
    captures.set(url.searchParams.get('file'), complete ? { body, w, h } : null);
    res.statusCode = complete ? 200 : 400;
    res.end(String(body.length));
  });
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
export function startServer({ port, mounts, captures, isolation = false }) {
  const server = http.createServer((req, res) => {
    if (isolation)
      for (const [name, value] of Object.entries(ISOLATION)) res.setHeader(name, value);
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/capture')
      return takeCapture(req, url, captures, res);
    // The browser asks for a tab icon this harness does not have: answer rather than
    // let a 404 pollute page errors.
    if (url.pathname === '/favicon.ico') {
      res.statusCode = 204;
      return res.end();
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      return res.end(PAGE);
    }
    const mount = mounts.find((candidate) => url.pathname.startsWith(candidate.prefix));
    if (!mount) {
      res.statusCode = 404;
      return res.end('no mount point');
    }
    serveFile(mount, url.pathname, res);
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}
