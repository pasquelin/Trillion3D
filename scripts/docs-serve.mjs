/** Serve only the published docs tree, with production paths and no framework dependency. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDocs } from './docs/bundles.mjs';
const root = resolve(import.meta.dirname, '../docs');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
async function serve(request, response) {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(root, `.${name}`);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end('Not found');
  }
}

let built;
/** Builds the bundles once per process (none is committed), then listens on the loopback port. */
export async function startDocsServer(port = 0) {
  await (built ??= buildDocs(resolve(root, '..')));
  const server = createServer(serve);
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', ready);
  });
  return { server, port: server.address().port };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port } = await startDocsServer(Number(process.env.PORT ?? 4177));
  console.log(`Learning portal: http://127.0.0.1:${port}`);
}
