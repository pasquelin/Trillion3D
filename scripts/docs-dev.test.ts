import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { followSite, RELOAD_EVENTS, stepsReading } from './docs-dev.ts';
import { STYLE_SOURCES } from './docs/build-styles.ts';
import { copyStatics, SITE_STEPS, STATIC_ENTRIES } from './docs/site.ts';

const LOGS = resolve(import.meta.dirname, '../.worktrees/logs');
const named = (...paths: string[]) => stepsReading(paths).map(({ name }) => name);

/** The pages and scripts of the built tree `out` that name the reload stream: always none. */
const reloadIn = (out: string) =>
  readdirSync(out, { recursive: true })
    .map(String)
    .filter((file) => /\.(?:html|js)$/.test(file))
    .filter((file) => readFileSync(resolve(out, file), 'utf8').includes(RELOAD_EVENTS));

/** A folder of `.worktrees/logs/`, removed after the test. */
async function scratch(t: test.TestContext) {
  await mkdir(LOGS, { recursive: true });
  const root = await mkdtemp(resolve(LOGS, 'docs-dev-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('a change runs again the build steps that read it or what an earlier one wrote', () => {
  // An engine or portal module rewrites the API files, read by the styles, portal and statics.
  const everyReader = ['api', 'styles', 'runtime', 'statics'];
  assert.deepEqual(named('packages/sdk-browser/src/index.ts'), everyReader);
  assert.deepEqual(named('site/app/main.tsx'), everyReader);
  assert.deepEqual(named('site/styles/tailwind.css'), ['styles']);
  assert.deepEqual(named('site/assets/examples/hall/source/a.gltf'), ['caches', 'statics']);
  assert.deepEqual(named('site/data/x.json', 'site/index.html'), ['styles', 'statics']);
  // A folder is matched by its name, never by a prefix of it.
  assert.deepEqual(named('site/styles.css', 'packages.ts'), []);
});

// Bounded: a change the watcher never reports fails the test instead of holding the run.
test(
  'docs:dev serves a site change without a restart, the open page told to reload',
  { timeout: 30_000 },
  async (t) => {
    const root = await scratch(t);
    const site = resolve(root, 'site');
    const out = resolve(root, 'out');
    // Its own repository: the folder of logs it lies in is ignored by this one.
    execFileSync('git', ['init', '-q'], { cwd: root });
    // Only the edited note is a live source in this minimal repository; ignore late setup events.
    await writeFile(resolve(root, '.gitignore'), '*\n!site/\n!site/data/\n!site/data/note.json\n');
    for (const name of [
      'packages',
      'site/styles',
      ...STYLE_SOURCES.filter((name) => !name.endsWith('.html')),
      ...STATIC_ENTRIES.map((name) => `site/${name}`),
    ])
      if (name.endsWith('.ico')) await writeFile(resolve(root, name), '');
      else await mkdir(resolve(root, name), { recursive: true });
    await writeFile(resolve(site, 'styles/tailwind.css'), 'body { color: black; }');
    await writeFile(resolve(site, 'index.html'), '<!doctype html>\n<head>\n</head>\n');
    await writeFile(resolve(site, 'data/note.json'), '"before"');
    await copyStatics(site, out);
    const { port, close } = await followSite(root, out);
    const base = `http://127.0.0.1:${port}`;
    const served = async (path: string) => (await fetch(`${base}${path}`)).text();
    // Closed before its folder is removed, which the hooks of `t.after` would do first.
    let saving: ReturnType<typeof setInterval> | undefined;
    let cancelEvents = async () => {};
    try {
      assert.ok((await served('/')).includes(RELOAD_EVENTS), 'the served page listens');
      const events = (await fetch(`${base}${RELOAD_EVENTS}`)).body!.getReader();
      cancelEvents = () => events.cancel().catch(() => {});
      t.signal.addEventListener('abort', () => void cancelEvents(), { once: true });
      const decoder = new TextDecoder();
      // The stream's first comment: the server counts the page among the open ones.
      await events.read();
      // Recursive watchers may attach to fresh directories after the first save on macOS.
      const save = () => writeFile(resolve(site, 'data/note.json'), '"after"');
      saving = setInterval(() => void save(), 100);
      await save();
      // Each reload is a rebuild done; one of them serves the edit.
      do {
        let told = '';
        while (!told.includes('data: reload')) {
          const { value, done } = await events.read();
          assert.ok(!done, 'the stream stays open');
          told += decoder.decode(value);
        }
      } while ((await served('/data/note.json')) !== '"after"');
      assert.deepEqual(reloadIn(out), [], 'the built tree never names the reload stream');
    } finally {
      clearInterval(saving);
      await cancelEvents();
      await close();
    }
  },
);

test('a built page or script that names the reload stream is found', async (t) => {
  const out = await scratch(t);
  await writeFile(resolve(out, 'leaked.js'), `new EventSource('${RELOAD_EVENTS}')`);
  await writeFile(resolve(out, 'clean.html'), '<!doctype html>');
  assert.deepEqual(reloadIn(out), ['leaked.js']);
});

test('docs:dev reads recompiled caches in place and never falls back to a deleted stale copy', async (t) => {
  const root = await scratch(t);
  const cache = 'assets/examples/hall/cache/native/full';
  const source = resolve(root, 'site', cache);
  const out = resolve(root, 'out');
  execFileSync('git', ['init', '-q'], { cwd: root });
  await writeFile(resolve(root, '.gitignore'), '*\n');
  await mkdir(resolve(root, 'packages'));
  await mkdir(source, { recursive: true });
  await mkdir(resolve(out, cache), { recursive: true });
  await writeFile(resolve(out, cache, 'manifest.json'), 'stale copied manifest');
  await writeFile(resolve(source, 'manifest.json'), 'current manifest');
  const { port, close } = await followSite(root, out);
  try {
    const url = `http://127.0.0.1:${port}/${cache}/manifest.json`;
    assert.equal(await (await fetch(url)).text(), 'current manifest');
    await writeFile(resolve(source, 'manifest.json'), 'recompiled manifest');
    assert.equal(await (await fetch(url)).text(), 'recompiled manifest');
    const partial = await fetch(url, { headers: { Range: 'bytes=0-9' } });
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), 'recompiled');
    await rm(resolve(source, 'manifest.json'));
    assert.equal((await fetch(url)).status, 404);
  } finally {
    await close();
  }
});

test('a failed live cache rebuild names compile:caches', { timeout: 5000 }, async (t) => {
  const root = await scratch(t);
  const source = resolve(root, 'site/assets/examples/hall/source');
  execFileSync('git', ['init', '-q'], { cwd: root });
  await mkdir(resolve(root, 'packages'));
  await mkdir(source, { recursive: true });
  const failure = new Error('compiler refused source');
  t.mock.method(
    SITE_STEPS.find(({ name }) => name === 'caches')!,
    'run',
    async () => {
      throw failure;
    },
  );
  const reported = new Promise<void>((done) => {
    t.mock.method(console, 'error', (message: string, cause: unknown) => {
      assert.match(message, /pnpm compile:caches/);
      assert.equal(cause, failure);
      done();
    });
  });
  const { close } = await followSite(root, resolve(root, 'out'));
  const save = () => writeFile(resolve(source, 'geometry.gltf'), '{}');
  const saving = setInterval(() => void save(), 100);
  try {
    await save();
    await reported;
  } finally {
    clearInterval(saving);
    await close();
  }
});
