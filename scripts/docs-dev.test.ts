import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { followSite, RELOAD_EVENTS, reloadIn } from './docs-dev.ts';
import { copyStatics, stepsReading } from './docs/site.ts';

const LOGS = resolve(import.meta.dirname, '../.worktrees/logs');
const named = (...paths: string[]) => stepsReading(paths).map(({ name }) => name);

test('a change runs again only the build steps that read it, in the order of the build', () => {
  assert.deepEqual(named('packages/sdk-browser/src/index.ts'), ['api', 'runtime']);
  assert.deepEqual(named('site/app/main.tsx'), ['api', 'styles', 'runtime']);
  assert.deepEqual(named('site/styles/tailwind.css'), ['api', 'styles']);
  assert.deepEqual(named('site/assets/examples/hall/source/a.gltf'), ['api', 'caches', 'statics']);
  assert.deepEqual(named('site/data/x.json', 'site/index.html'), ['api', 'styles', 'statics']);
  // A folder is matched by its name, never by a prefix of it.
  assert.deepEqual(named('site/applied.txt', 'packages.json'), ['api']);
});

test(
  'docs:dev serves a site change without a restart, the open page told to reload',
  {
    timeout: 60_000,
  },
  async () => {
    await mkdir(LOGS, { recursive: true });
    const root = await mkdtemp(resolve(LOGS, 'docs-dev-'));
    const site = resolve(root, 'site');
    const out = resolve(root, 'out');
    try {
      for (const folder of [
        'packages',
        'site/examples',
        'site/assets',
        'site/data',
        'site/reports',
      ])
        await mkdir(resolve(root, folder), { recursive: true });
      await writeFile(resolve(site, 'index.html'), '<!doctype html>\n<head>\n</head>\n');
      await writeFile(resolve(site, 'data/note.json'), '"before"');
      await copyStatics(site, out);
      const { port, close } = await followSite(root, out);
      const base = `http://127.0.0.1:${port}`;
      const served = async (path: string) => (await fetch(`${base}${path}`)).text();
      try {
        assert.ok((await served('/')).includes(RELOAD_EVENTS), 'the served page listens');
        const events = (await fetch(`${base}${RELOAD_EVENTS}`)).body!.getReader();
        const decoder = new TextDecoder();
        // The stream's first comment: the server counts the page among the open ones.
        await events.read();
        await writeFile(resolve(site, 'data/note.json'), '"after"');
        // Each reload is a rebuild done; one of them serves the edit.
        do {
          let told = '';
          while (!told.includes('data: reload'))
            told += decoder.decode((await events.read()).value);
        } while ((await served('/data/note.json')) !== '"after"');
        assert.deepEqual(reloadIn(out), [], 'the built tree never names the reload stream');
        await writeFile(resolve(out, 'data/leaked.js'), `new EventSource('${RELOAD_EVENTS}')`);
        assert.deepEqual(reloadIn(out), ['data/leaked.js'], 'a leak is named');
      } finally {
        await close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
