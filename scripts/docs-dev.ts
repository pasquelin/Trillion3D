/** The local site while its sources change (`pnpm docs:dev`): the server of `docs:serve`, the
 *  steps of `buildSite` a changed file is read by run again, then every open page reloads. */
import { readFileSync, watch } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDocsServer, DOCS_PORT } from './docs-serve.ts';
import { inHead } from './docs/measurement.ts';
import { buildSite, SITE_OUTPUT, stepsReading } from './docs/site.ts';
import { ignoredPaths } from './git-paths.ts';
import { contentType, listen } from './static-server.ts';

const ROOT = resolve(import.meta.dirname, '..');

/** The event stream an open page listens on. Only this server adds it, to the pages it serves:
 *  the built tree never holds it (checked by `docs-dev.test.ts`). */
export const RELOAD_EVENTS = '/__docs-dev/reload';
/** A framed example reloads with the page that frames it, never alone. */
const RELOAD_SCRIPT = `<script>if (self === top) new EventSource('${RELOAD_EVENTS}').onmessage = () => location.reload();</script>`;

/** The folders followed, under the root: the engine, the site and its examples. */
const FOLLOWED = ['packages', 'site'];

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
        ? { type: contentType('.html'), text: inHead(readFileSync(file, 'utf8'), RELOAD_SCRIPT) }
        : undefined,
  });

  let changed = new Set<string>();
  /** The paths of a failed rebuild: their steps run again with the next change. */
  let failed: string[] = [];
  let building: Promise<void> | undefined;
  /** Runs the steps the changed paths name until no change is left, then reloads the pages. */
  async function rebuild() {
    // A save is often several events: they are gathered before the first step runs.
    await new Promise((settle) => setTimeout(settle, 50));
    while (changed.size) {
      const fresh = [...changed];
      changed = new Set();
      // What git ignores is never read by the build or written by it: dependencies, products,
      // the API files and the scene caches, so a rebuild does not restart itself.
      const ignored = new Set(ignoredPaths(fresh, root));
      const paths = [...failed, ...fresh.filter((path) => !ignored.has(path))];
      const steps = stepsReading(paths);
      if (!steps.length) continue;
      try {
        await buildSite(root, out, false, steps);
      } catch (error) {
        // A step empties its folder first: the pages are not reloaded onto a half-built tree.
        failed = paths;
        console.error('docs:dev: the rebuild failed, it runs again with the next change:', error);
        continue;
      }
      failed = [];
      console.log(`docs:dev: rebuilt ${steps.map(({ name }) => name).join(', ')}`);
      for (const page of pages) page.write('data: reload\n\n');
    }
    building = undefined;
  }
  // Listening first: a port in use fails before any folder is followed.
  const listening = await listen(server, port);
  const watchers = FOLLOWED.map((folder) =>
    watch(resolve(root, folder), { recursive: true }, (_, name) => {
      if (!name) return;
      changed.add(`${folder}/${name.split(sep).join('/')}`);
      building ??= rebuild();
    }),
  );
  /** Stops following and closes the server, the open pages' streams with it. */
  const close = async () => {
    for (const watcher of watchers) watcher.close();
    // A rebuild under way ends first, so nothing is written into `out` once it is closed.
    await building;
    const closed = new Promise((done) => server.close(done));
    server.closeAllConnections();
    return closed;
  };
  return { port: listening, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildSite();
  const { port } = await followSite(ROOT, SITE_OUTPUT, DOCS_PORT);
  console.log(`Learning portal, following its sources: http://127.0.0.1:${port}`);
}
