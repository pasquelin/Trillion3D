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
/** The bundles are not committed on develop: every server builds them from the sources first. */
export async function createDocsServer() {
  await buildDocs(resolve(root, '..'));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  (await createDocsServer()).listen(Number(process.env.PORT ?? 4177), '127.0.0.1', () =>
    console.log(`Learning portal: http://127.0.0.1:${process.env.PORT ?? 4177}`),
  );
