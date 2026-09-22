import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeGarden } from './docs/garden-source.ts';
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { engineDiagnosticsCode, engineExampleCode } from '../site/lessons/engine-scene/code.ts';
import { SCENE_BACKGROUND } from '../site/lessons/scenePalette.ts';
import { loadReactComponents } from './docs/render-react.ts';
const root = resolve(import.meta.dirname, '..');

interface GardenGltf {
  nodes: unknown[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { count: number }[];
}

interface CachePointer {
  url: string;
  formatVersion: string;
}

interface CacheManifest {
  sourceTriangles: number;
  formatVersion: string;
}

test('the published original garden matches its deterministic source generator', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'wg-garden-'));
  try {
    await writeGarden(temporary);
    for (const file of ['garden.gltf', 'garden.bin']) {
      assert.deepEqual(
        await readFile(join(temporary, file)),
        await readFile(join(root, 'site/assets/kinetic-garden/source', file)),
      );
    }
    const gltf = JSON.parse(await readFile(join(temporary, 'garden.gltf'), 'utf8')) as GardenGltf;
    const triangles = gltf.meshes.reduce(
      (total, mesh) => total + gltf.accessors[mesh.primitives[0].attributes.POSITION].count / 3,
      0,
    );
    assert.equal(triangles, 35840);
    assert.equal(gltf.nodes.length, 11);
    const base = join(root, 'site/assets/kinetic-garden/cache/native/full');
    const pointer = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8')) as CachePointer;
    const manifest = JSON.parse(await readFile(join(base, pointer.url), 'utf8')) as CacheManifest;
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
  const { EngineExample } = await loadReactComponents('site/app/engine-scene/index.tsx');
  const { EnginePreview } = await loadReactComponents('site/app/engine-scene/EnginePreview.tsx');
  const preview = renderToStaticMarkup(
    createElement(EnginePreview as ComponentType<{ locale: string }>, { locale: 'fr' }),
  );
  const example = renderToStaticMarkup(
    createElement(EngineExample as ComponentType<{ locale: string }>, { locale: 'fr' }),
  );
  assert.match(preview, /data-engine-scene/);
  assert.match(preview, /data-scene-canvas/);
  assert.match(preview, /data-scene-loading/);
  assert.doesNotMatch(preview, /<img/);
  assert.match(preview, /Préparation de la scène/);
  assert.match(preview, /background-color:#0e1621/);
  assert.equal(SCENE_BACKGROUND.packed, 0x0e1621);
  assert.deepEqual(SCENE_BACKGROUND.gpu, { r: 14 / 255, g: 22 / 255, b: 33 / 255, a: 1 });
  for (const file of ['site/lessons/engine-scene/lifecycle.ts', 'site/lessons/webgpuRenderer.ts'])
    assert.match(await readFile(join(root, file), 'utf8'), /SCENE_BACKGROUND/);
  assert.match(example, /data-code-block/);
  assert.match(example, /scene-stats/);
  assert.match(example, /data-scene-guide/);
});

interface MockLight {
  id: string;
  castsShadow: boolean;
}

interface MockExplorer {
  addLight(light: MockLight): void;
  dispose(): void;
  setDiagnostic(mode: string): void;
  invalidate(): void;
}

interface CreateExplorerOptions {
  interactive: boolean;
  scope: string;
}

type AsyncFunctionConstructor = new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

test('garden snippets execute the ID startup contract and invalidate diagnostic edits', async () => {
  const cases: [string, boolean][] = [
    [engineExampleCode, false],
    [engineDiagnosticsCode, true],
  ];
  for (const [code, diagnostic] of cases) {
    let disposed = false,
      invalidated = false,
      listener: (() => void) | undefined;
    const explorer: MockExplorer = {
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
    const openMeasuredWorld = async (target: string, options: CreateExplorerOptions) => {
      assert.equal(target, 'garden');
      assert.equal(options.interactive, true);
      assert.equal(options.scope, 'full');
      return explorer;
    };
    const body = code.replace(/^import[^\n]+\n/, '');
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as AsyncFunctionConstructor;
    const runSnippet = new AsyncFunction('openMeasuredWorld', 'window', body);
    await runSnippet(openMeasuredWorld, {
      addEventListener(event: string, callback: () => void) {
        assert.equal(event, 'pagehide');
        listener = callback;
      },
    });
    assert.equal(invalidated, diagnostic);
    assert.equal(disposed, false);
    assert(listener);
    listener();
    assert.equal(disposed, true);
  }
});
