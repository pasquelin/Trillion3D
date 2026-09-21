import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeGarden } from './docs/garden-source.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { engineDiagnosticsCode, engineExampleCode } from '../docs/js/engine-scene/code.js';
import { SCENE_BACKGROUND } from '../docs/js/scenePalette.js';
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
  const { EngineExample } = await loadReactComponents('docs/react/engine-scene/index.tsx');
  const { EnginePreview } = await loadReactComponents('docs/react/engine-scene/EnginePreview.tsx');
  const preview = renderToStaticMarkup(createElement(EnginePreview, { locale: 'fr' }));
  const example = renderToStaticMarkup(createElement(EngineExample, { locale: 'fr' }));
  assert.match(preview, /data-engine-scene/);
  assert.match(preview, /data-scene-canvas/);
  assert.match(preview, /data-scene-loading/);
  assert.doesNotMatch(preview, /<img/);
  assert.match(preview, /Préparation de la scène/);
  assert.match(preview, /background-color:#0e1621/);
  assert.equal(SCENE_BACKGROUND.packed, 0x0e1621);
  assert.deepEqual(SCENE_BACKGROUND.gpu, { r: 14 / 255, g: 22 / 255, b: 33 / 255, a: 1 });
  for (const file of ['docs/js/engine-scene/lifecycle.js', 'docs/js/gallery/webgpuRenderer.js'])
    assert.match(await readFile(join(root, file), 'utf8'), /SCENE_BACKGROUND/);
  assert.match(example, /data-code-block/);
  assert.match(example, /scene-stats/);
  assert.match(example, /data-scene-guide/);
});

test('garden snippets execute the ID startup contract and invalidate diagnostic edits', async () => {
  for (const [code, diagnostic] of [
    [engineExampleCode, false],
    [engineDiagnosticsCode, true],
  ]) {
    let disposed = false,
      invalidated = false,
      listener;
    const explorer = {
      addLight(light) {
        assert.equal(light.id, 'scene-fill');
        assert.equal(light.castsShadow, false);
      },
      dispose() {
        disposed = true;
      },
      setDiagnostic(mode) {
        assert.equal(mode, 'clusters');
      },
      invalidate() {
        invalidated = true;
      },
    };
    const createExplorer = async (target, options) => {
      assert.equal(target, 'garden');
      assert.equal(options.interactive, true);
      assert.equal(options.scope, 'full');
      return explorer;
    };
    const body = code.replace(/^import[^\n]+\n/, '');
    await new (Object.getPrototypeOf(async function () {}).constructor)(
      'createExplorer',
      'window',
      body,
    )(createExplorer, {
      addEventListener(event, callback) {
        assert.equal(event, 'pagehide');
        listener = callback;
      },
    });
    assert.equal(invalidated, diagnostic);
    assert.equal(disposed, false);
    listener();
    assert.equal(disposed, true);
  }
});
