import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { FAMILY_MODULES } from './bundle-fold.ts';
import { ciNode, coreFiles, coreSize } from './check-bundle-size.ts';
import { BUNDLE_SOURCES } from './core-sources.ts';

function bundle(files: Record<string, string>) {
  const dist = mkdtempSync(join(tmpdir(), 'trillion3d-core-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dist, name), text);
  return dist;
}

/** Each family module's chunk, as esbuild names it: `trillion3d-<module>-<hash>.js`. */
const familyChunks = Object.values(FAMILY_MODULES).map(
  ([path], at) => `trillion3d-${basename(path, '.js')}-F${at}.js`,
);
const files = {
  'trillion3d.module.js':
    'import{a as b}from"./trillion3d-chunk-A.js";import"./side.js";' +
    'new URL("./physicsWorker.js",import.meta.url);' +
    familyChunks.map((chunk) => `()=>import("./${chunk}");`).join(''),
  'trillion3d-chunk-A.js': 'export{c as a}from"./deep.js";',
  'deep.js': 'export const c=1;',
  'side.js': '',
  ...Object.fromEntries(familyChunks.map((chunk) => [chunk, 'import"./trillion3d-chunk-A.js";'])),
};

test('the core is the entry and its static imports, never a chunk loaded on first use', () => {
  const dist = bundle(files);
  try {
    assert.deepEqual(coreFiles(dist), [
      'trillion3d.module.js',
      'trillion3d-chunk-A.js',
      'side.js',
      'deep.js',
    ]);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('a core over its gzip budget fails the gate and says by how much it weighs', () => {
  const dist = bundle(files);
  try {
    const { bytes, fits, line } = coreSize(dist);
    assert.ok(fits);
    assert.match(
      line,
      /; webgpu, webgl2, physics, particles, transmission, deformation, effects, /,
    );
    const over = coreSize(dist, bytes - 1);
    assert.equal(over.fits, false);
    assert.match(over.line, new RegExp(`${bytes} bytes gzip in 4 files, OVER its budget`));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('each family module is a chunk of its own: one the core holds fails the gate by name', () => {
  // WebGL2 imported statically, and WebGPU folded in: no chunk of its own.
  const [webgpu, webgl2] = familyChunks;
  const rest = Object.entries(files).filter(([name]) => name !== webgpu);
  const entry = `import"./${webgl2}";${files['trillion3d.module.js']}`;
  const dist = bundle({ ...Object.fromEntries(rest), 'trillion3d.module.js': entry });
  try {
    const { fits, line } = coreSize(dist);
    assert.equal(fits, false);
    assert.match(line, /holds webgpu \(webgpuCode\), webgl2 \(webglCode\), to be loaded/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('the gate lists the core by source folder, and fails on measurement, diagnostics, a renderer or its shadow passes', () => {
  const held = (sources: Record<string, number>) =>
    bundle({
      ...files,
      [BUNDLE_SOURCES]: JSON.stringify({
        'trillion3d.module.js': {
          'sdk-browser/src/world/core/world.js': 900,
          'sdk-browser/src/gpu/timing/queries.js': 200,
          'sdk-browser/src/vsm/layout.js': 100,
          ...sources,
        },
        'trillion3d-chunk-A.js': { 'sdk-core/src/math/vec.js': 400 },
        [familyChunks[0]]: { 'sdk-browser/src/measurement/comparison.js': 700 },
      }),
    });
  const clean = held({});
  try {
    const { fits, folders, forbidden } = coreSize(clean);
    assert.ok(fits, 'a family chunk is not the core: its sources are not listed');
    assert.deepEqual(folders.slice(1), [
      '      0.9 kB  sdk-browser/src/world',
      '      0.4 kB  sdk-core/src/math',
      '      0.2 kB  sdk-browser/src/gpu',
      '      0.1 kB  sdk-browser/src/vsm',
    ]);
    assert.deepEqual(forbidden, [], "the shadows' size modules are the core's");
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
  for (const source of [
    'sdk-browser/src/measurement/comparison.js',
    'sdk-browser/src/host/scene/graphDiagnostic.js',
    'sdk-browser/src/webgpu/pages/pages.js',
    'sdk-browser/src/backend/autonomous/pages.js',
    'sdk-browser/src/gpu/shadow/atlas.js',
    'sdk-browser/src/webgpu/shadow/pageRequests.js',
    'sdk-browser/src/webgpu/shadow/allocWgsl.js',
    'sdk-browser/src/vsm/renderPass.js',
  ]) {
    const dist = held({ [source]: 10 });
    try {
      const { fits, forbidden } = coreSize(dist);
      assert.equal(fits, false, source);
      assert.match(forbidden[0], new RegExp(`holds .*\\(${source}\\), which it must never hold`));
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  }
});

test("the gate reads CI's Node from the one action that installs it", () => {
  assert.match(ciNode() ?? '', /^22\.\d+\.\d+$/);
});
