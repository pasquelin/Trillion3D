import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { ENGINE_FAILURE, leastDrawn, SPARSE } from './docs/examples/capture.ts';
import { readyEntries as ready } from '../site/app/examples/list.ts';

// #527: what left an example blank or stopped in the examples proof, read from the files.
const examples = new URL('../site/examples/', import.meta.url);
const pages = await Promise.all(
  (await readdir(examples))
    .filter((file) => file.endsWith('.html'))
    .map(async (file) => [file, await readFile(new URL(file, examples), 'utf8')] as const),
);

test('a readout is declared after the controls panel it joins', () => {
  for (const [file, html] of pages) {
    const readout = html.search(/\breadout\(/);
    if (readout < 0) continue;
    const panel = html.search(/\bcontrols\(/);
    assert.ok(panel >= 0 && panel < readout, `${file}: readout before controls`);
  }
});

test("the proof hears the engine's own failures on the console", async () => {
  const engine = new URL('../packages/sdk-browser/src/', import.meta.url);
  for (const source of ['world/session/interactive.ts', 'world/core/worldHandles.ts']) {
    const code = await readFile(new URL(source, engine), 'utf8');
    const said = [...code.matchAll(/console\.error\('([^']+)'/g)].map(([, line]) => line);
    assert.ok(said.length > 0, source);
    for (const line of said) assert.match(`${line} Error: refused`, ENGINE_FAILURE, source);
  }
  const lost = await readFile(new URL('webgpu/pages/io/lost.ts', engine), 'utf8');
  assert.ok(lost.includes('console.error(`[trillion3d] WebGPU device lost ('));
  assert.match('[trillion3d] WebGPU device lost (destroyed): gone', ENGINE_FAILURE);
  assert.doesNotMatch('THREE.WebGLRenderer: context lost', ENGINE_FAILURE);
});

test('a sparse example is declared by name and backend under the tenth; every other keeps the tenth', () => {
  const ids = new Set(ready.map(({ id }) => id));
  for (const [id, { share }] of Object.entries(SPARSE)) {
    assert.ok(ids.has(id), id);
    assert.ok(share > 0 && share < 0.1, id);
  }
  // The shares declared under those measured on 2026-09-24, and the three examples a refused
  // WebGL2 session left blank, which are never declared: they keep the tenth on both backends.
  const named = [
    'a-staircase-from-one-step',
    'a-cloud-of-points',
    'save-the-scene',
    'shapes-on-a-turntable',
    'fly-over-a-model-town',
    'from-a-grain-to-a-planet',
    'snow-of-sprites',
  ];
  for (const id of named) assert.ok(ids.has(id), id);
  // A new declaration is asserted here too, with its literal share.
  for (const id of Object.keys(SPARSE)) assert.ok(named.includes(id), id);
  const least = (gpu: boolean) => named.map((id) => leastDrawn(id, gpu));
  assert.deepEqual(least(false), [0.04, 0.04, 0.06, 0.1, 0.1, 0.1, 0.1]);
  assert.deepEqual(least(true), [0.04, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
});
