// Serveur statique du harnais et encodage PNG, pour `banc.mjs`. Rien n'est écrit ici : le serveur
// lit les dists, les dépendances du navigateur et les assets du banc, et encaisse les
// captures RGBA que la page lui poste.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
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

/** La page du harnais : une carte d'imports, et rien d'autre. Tout le reste vient de `evaluate`. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>banc de mesure WebGeometry</title>
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
    return res.end('chemin refusé');
  }
  const file = join(mount.dir, rest);
  if (!file.startsWith(mount.dir) || !existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    return res.end('introuvable');
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
 * Les en-têtes qui isolent la page entre origines, et rien d'autre. Sans eux, `crossOriginIsolated`
 * est faux dans le navigateur et le SDK garde son chemin de transfert : c'est ce drapeau, et lui
 * seul, qui met le harnais du côté de la mémoire partagée. Faux par défaut, pour que la mesure de
 * référence ne change pas de chemin sans qu'on le demande.
 */
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};

/** Écoute sur `port`, sert `mounts`, dépose les captures dans `captures`. `isolation` pose COOP et
 *  COEP sur chaque réponse. */
export function startServer({ port, mounts, captures, isolation = false }) {
  const server = http.createServer((req, res) => {
    if (isolation)
      for (const [name, value] of Object.entries(ISOLATION)) res.setHeader(name, value);
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/capture')
      return takeCapture(req, url, captures, res);
    // Le navigateur réclame une icône d'onglet que ce harnais n'a pas : répondre plutôt que
    // laisser un 404 polluer les erreurs de page.
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
      return res.end('aucun point de montage');
    }
    serveFile(mount, url.pathname, res);
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

/** RGBA d'origine bas-gauche, comme `capture()` le rend, vers un PNG 8 bits sans perte. */
export function pngFromRgba(rgba, w, h) {
  const stride = w * 4,
    raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++)
    rgba.copy(raw, y * (stride + 1) + 1, (h - 1 - y) * stride, (h - y) * stride);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
