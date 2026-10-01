import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { inlineModules } from './docs/inline-modules.ts';

// Exercise the real plugin twice in one process, as docs:dev does for the waiting banner.
test('inline rebuilds read changed transitive JSON and module imports', async (t) => {
  const logs = resolve(import.meta.dirname, '../.worktrees/logs');
  await mkdir(logs, { recursive: true });
  const root = await mkdtemp(resolve(logs, 'inline-modules-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(resolve(root, 'roadmap.json'), '{"issue":356}');
  await writeFile(
    resolve(root, 'list.ts'),
    `import data from './roadmap.json' with { type: 'json' }; export const issue = data.issue;`,
  );
  await writeFile(resolve(root, 'waiting.inline.ts'), `export { issue } from './list.ts';`);
  const read = async () => {
    const result = await build({
      entryPoints: [resolve(root, 'waiting.inline.ts')],
      write: false,
      bundle: true,
      format: 'esm',
      plugins: [inlineModules],
      logLevel: 'silent',
    });
    return (await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`))
      .issue;
  };
  assert.equal(await read(), 356);
  await writeFile(resolve(root, 'roadmap.json'), '{"issue":1100}');
  assert.equal(await read(), 1100);
  await writeFile(
    resolve(root, 'list.ts'),
    `import data from './roadmap.json' with { type: 'json' }; export const issue = data.issue + 1;`,
  );
  assert.equal(await read(), 1101);
  await writeFile(resolve(root, 'roadmap.json'), 'invalid JSON');
  await assert.rejects(read(), /JSON/);
});
