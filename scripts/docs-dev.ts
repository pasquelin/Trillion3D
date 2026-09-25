/** The local site while its sources change (`pnpm docs:dev`): the server of `docs:serve`, the
 *  steps of `buildSite` a changed file is read by run again, then every open page reloads. */
import { readdirSync, readFileSync, watch } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDocsServer } from './docs-serve.ts';
import { buildSite, SITE_OUTPUT, stepsReading, underOrAt } from './docs/site.ts';
import { API_FILES } from './generate-api-reference.ts';
import { COOKED_SCENES } from './site-caches.ts';
import { listen } from './static-server.ts';

const ROOT = resolve(import.meta.dirname, '..');

/** The event stream an open page listens on. Only this server adds it, to the pages it serves:
 *  the built tree never holds it (checked by `docs-build.ts`). */
export const RELOAD_EVENTS = '/__docs-dev/reload';
/** A framed example reloads with the page that frames it, never alone. */
const RELOAD_SCRIPT = `<script>if (self === top) new EventSource('${RELOAD_EVENTS}').onmessage = () => location.reload();</script>`;

/** The folders followed, under the root: the engine, the site and its examples. */
const FOLLOWED = ['packages', 'site'];
/** What the build never reads: dependencies, compiler targets, products, hidden files. */
const UNREAD = /(?:^|\/)(?:node_modules|target|dist|\.[^/]*)(?:\/|$)/;
/** What the build writes under `site/`, the API files and the scene caches: its change is the
 *  build's own, not a source's. */
const WRITTEN = [
  ...Object.values(API_FILES),
  ...Object.values(COOKED_SCENES).map(({ directory }) => `${directory}/cache`),
];

/** The pages and scripts of the built tree `out` that name the reload stream: always none. */
export const reloadIn = (out: string) =>
  readdirSync(out, { recursive: true })
    .map(String)
    .filter((file) => /\.(?:html|js)$/.test(file))
    .filter((file) => readFileSync(resolve(out, file), 'utf8').includes(RELOAD_EVENTS));

/** Serves `out` as `docs:serve` does, its pages with the reload script, and rebuilds it from
 *  `root` after each change of a followed folder. `out` is built already. */
export async function followSite(root: string, out: string, port = 0) {
  const pages = new Set<ServerResponse>();
  const server = createDocsServer(out, {
    answer: (request, response, url) => {
      if (url.pathname !== RELOAD_EVENTS) return false;
      response.writeHead(200, { 'content-type': 'text/event-stream' }).write(': open\n\n');
      pages.add(response);
      request.once('close', () => pages.delete(response));
      return true;
    },
    transform: (file) =>
      file.endsWith('.html')
        ? readFileSync(file, 'utf8').replace('</head>', `${RELOAD_SCRIPT}\n</head>`)
        : undefined,
  });

  let changed = new Set<string>();
  let building: Promise<void> | undefined;
  /** Runs the steps the changed paths name until no change is left, then reloads the pages. */
  async function rebuild() {
    // A save is often several events: they are gathered before the first step runs.
    await new Promise((settle) => setTimeout(settle, 50));
    while (changed.size) {
      const steps = stepsReading(changed);
      changed = new Set();
      try {
        await buildSite(root, out, false, steps);
      } catch (error) {
        console.error('docs:dev: the rebuild failed, the pages keep the last build:', error);
        continue;
      }
      console.log(`docs:dev: rebuilt ${steps.map(({ name }) => name).join(', ')}`);
      for (const page of pages) page.write('data: reload\n\n');
    }
    building = undefined;
  }
  const watchers = FOLLOWED.map((folder) =>
    watch(resolve(root, folder), { recursive: true }, (_, name) => {
      const path = name && `${folder}/${name.split(sep).join('/')}`;
      if (!path || UNREAD.test(path) || WRITTEN.some((file) => underOrAt(path, file))) return;
      changed.add(path);
      building ??= rebuild();
    }),
  );
  /** Stops following and closes the server, the open pages' streams with it. */
  const close = () => {
    for (const watcher of watchers) watcher.close();
    const closed = new Promise((done) => server.close(done));
    server.closeAllConnections();
    return closed;
  };
  return { port: await listen(server, port), close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildSite();
  const { port } = await followSite(ROOT, SITE_OUTPUT, Number(process.env.PORT ?? 4177));
  console.log(`Learning portal, following its sources: http://127.0.0.1:${port}`);
}
