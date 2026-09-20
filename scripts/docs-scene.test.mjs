import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeGarden } from './docs/garden-source.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { engineDiagnosticsCode, engineExampleCode } from '../docs/js/engine-scene/code.js';
import { loadReactComponents } from './docs/render-react.mjs';
const root = resolve(import.meta.dirname, '..');

test('the published original garden matches its deterministic source generator', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'wg-garden-'));
  try {
    await writeGarden(temporary);
    for (const file of ['garden.gltf', 'garden.bin']) {
      assert.deepEqual(
        await readFile(join(temporary, file)),
        await readFile(join(root, 'docs/assets/kinetic-garden/source', file)),
      );
    }
    const gltf = JSON.parse(await readFile(join(temporary, 'garden.gltf'), 'utf8'));
    const triangles = gltf.meshes.reduce(
      (total, mesh) => total + gltf.accessors[mesh.primitives[0].attributes.POSITION].count / 3,
      0,
    );
    assert.equal(triangles, 35840);
    assert.equal(gltf.nodes.length, 11);
    const base = join(root, 'docs/assets/kinetic-garden/cache/native/full');
    const pointer = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(base, pointer.url), 'utf8'));
    assert.equal(manifest.sourceTriangles, triangles);
    assert.equal(manifest.formatVersion, pointer.formatVersion);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('the embedded preview and its code share the published scene contract', async () => {
  assert.match(engineExampleCode, /kinetic-garden\/cache\/native\/full\/manifest\.json/);
  assert.match(engineExampleCode, /geometryPoolBytes: 16 \* 1024 \* 1024/);
  assert.match(engineExampleCode, /texturePoolBytes: 128 \* 1024 \* 1024/);
  assert.match(engineDiagnosticsCode, /setDiagnostic\('clusters'\)/);
  const { EngineExample } = await loadReactComponents('docs/react/engine-scene/index.jsx');
  const { EnginePreview } = await loadReactComponents('docs/react/engine-scene/EnginePreview.jsx');
  const preview = renderToStaticMarkup(createElement(EnginePreview, { locale: 'fr' }));
  const example = renderToStaticMarkup(createElement(EngineExample, { locale: 'fr' }));
  assert.match(preview, /data-engine-scene/);
  assert.match(preview, /data-scene-canvas/);
  assert.match(preview, /Préparation de la scène/);
  assert.match(example, /data-code-block/);
  assert.match(example, /scene-stats/);
  assert.match(example, /data-scene-guide/);
});
