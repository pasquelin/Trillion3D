/** Serve one built site tree with production paths and no framework dependency. */
import { pathToFileURL } from 'node:url';
import { buildSite, SITE_OUTPUT } from './docs/site.ts';
import { listen, staticServer } from './static-server.ts';

/** A static server over `root`: the built site by default, any site-shaped tree otherwise. */
export function createDocsServer(root = SITE_OUTPUT) {
  return staticServer({
    mounts: [{ prefix: '/', dir: root }],
    headers: {
      'Cache-Control': 'no-store',
      // Cross-origin isolation, as the published site answers (checked by the deploy, pages.yml):
      // `SharedArrayBuffer` for the physics. `credentialless` still lets the consent panel and its
      // analytics load (#381).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  });
}

let built: Promise<void> | undefined;
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
