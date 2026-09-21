/** Serve one built site tree with production paths and no framework dependency. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSite, SITE_OUTPUT } from './docs/site.mjs';

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

/** A static server over `root`: the built site by default, any site-shaped tree otherwise. */
export function createDocsServer(root = SITE_OUTPUT) {
  return createServer(async (request, response) => {
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
  });
}

/** Listens on the loopback interface (`port` 0 picks a free one) and resolves with the port. */
export function listen(server, port = 0) {
  return new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => ready(server.address().port));
  });
}

let built;
/** Builds the site once per process (nothing is committed), then listens on the loopback port. */
export async function startDocsServer(port = 0) {
  await (built ??= buildSite());
  const server = createDocsServer();
  return { server, port: await listen(server, port) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port } = await startDocsServer(Number(process.env.PORT ?? 4177));
  console.log(`Learning portal: http://127.0.0.1:${port}`);
}
