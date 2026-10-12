import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import * as common from '../../packages/sdk/index.ts'
import * as core from '../../packages/sdk-core/src/index.ts'
import * as browser from '../../packages/sdk/browser.ts'
import * as browserLegacy from '../../packages/sdk-browser/src/index.ts'
import { readJson } from '../../scripts/repository-files.ts'

test('the facade keeps canonical binding identity across environments', () => {
  assert.equal(common.LOD_QUALITY, core.LOD_QUALITY)
  assert.equal(browser.LOD_QUALITY, core.LOD_QUALITY)
  assert.equal(browser.createWorld, browserLegacy.createWorld)
})

test('importing each facade starts no browser resource or native process', () => {
  for (const entry of ['index.ts', 'browser.ts', 'node.mts']) {
    const url = new URL(`../../packages/sdk/${entry}`, import.meta.url).href
    const probe = `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const forbidden = (name) => () => { throw new Error('Import initialized ' + name); };
      for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
        childProcess[name] = forbidden(name);
      syncBuiltinESMExports();
      for (const name of ['Worker', 'SharedWorker', 'OffscreenCanvas', 'AudioContext'])
        globalThis[name] = function () { throw new Error('Import constructed ' + name); };
      globalThis.window = undefined;
      for (const name of ['document', 'navigator'])
        Object.defineProperty(globalThis, name, { configurable: true, get: forbidden(name) });
      globalThis.requestAnimationFrame = forbidden('requestAnimationFrame');
      globalThis.fetch = forbidden('fetch');
      await import(${JSON.stringify(url)});
    `
    execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', probe],
      {
        timeout: 30_000,
        stdio: 'pipe',
      },
    )
  }
})

interface InventoryEntry {
  name: string
  kind: string
  disposition?: string
  bindingIdentity: string
  currentEntryPoints: string[]
}
interface Inventory {
  exports: InventoryEntry[]
  collisions: unknown[]
  shadowed: { name: string }[]
}

test('generated inventory and explicit facade files are current', async () => {
  const inventory: Inventory = readJson(
    new URL('../../site/data/api-inventory.json', import.meta.url),
  )
  // 715 exports: the public API holds neither WGSL text (the shaders' maths library declares
  // it), a shadow atlas, a CPU transport, Hi-Z oracles, a CPU Hi-Z pyramid, a hierarchy batch, example-only helpers, the world
  // roots' object record no reader takes, nor the removed graphics path's renderer, CPU page
  // decoding and comparison layout; it holds the names the public signatures carry: EvictionOrder,
  // PageHome, PageHomes, QualityResolution, TextureLevelAddress, TextureLevelStore,
  // WorldQualityOptions and ModelScene; the sources a session draws and their association
  // (DrawSource, DrawRanks, DrawAssociations); and the page cache a streamer reads through,
  // `createPageCache` with its contract (PageCache, CacheSession, ReadRange, RangeAsk, ByteMeter);
  // it holds no CPU character capsule (Capsule, CapsuleContact, CapsulePush, TriangleTree,
  // CharacterCollision, TriangleCollision): Jolt is the one character body; and the frustum's
  // `FAR_PLANE_SLOT`, the slot a culling reader tests the far plane at.
  assert.equal(inventory.exports.length, 715)
  assert.deepEqual(inventory.collisions, [])
  // The page words of the world families shadow the engine contracts of the same name in the
  // browser condition; the inventory names every such pair (the lighting scene's `Scene` left with
  // the CPU transport experiment).
  assert.deepEqual(
    inventory.shadowed.map((entry) => entry.name),
    ['CameraPose', 'Material', 'Primitive', 'Side', 'Texture'],
  )
  assert.ok(inventory.exports.every((entry) => !entry.bindingIdentity.includes(process.cwd())))
  assert.ok(inventory.exports.every((entry) => !entry.bindingIdentity.includes('file://')))
  assert.ok(
    inventory.exports.some(
      (entry) => entry.name === 'sideOf' && entry.disposition === 'newly exposed',
    ),
  )
  for (const name of ['openMeasuredWorld', 'MeasuredWorld', 'MeasuredWorldOptions'])
    assert.ok(
      !inventory.exports.some((row) => row.name === name),
      `${name} belongs to the measurement entry, not the package`,
    )
  // The world's side of a joint, typed on its member: no page names it.
  assert.ok(!inventory.exports.some((row) => row.name === 'JointHost'), 'JointHost is internal')
  for (const [name, entryPoint] of [
    ['CameraPose', 'trillion3d (common)'],
    ['CameraPose', 'trillion3d (browser condition)'],
    ['JobSnapshot', 'trillion3d (common)'],
    ['World', 'trillion3d (browser condition)'],
    ['WorldOptions', 'trillion3d (browser condition)'],
    ['CompilationJob', 'trillion3d (node condition)'],
    ['CompilationResult', 'trillion3d (node condition)'],
    ['PrepareOptions', 'trillion3d (node condition)'],
  ]) {
    const entry = inventory.exports.find(
      (row) => row.name === name && row.currentEntryPoints.includes(entryPoint),
    )
    assert.ok(entry, `${name} is missing from the inventory`)
    assert.equal(entry.kind, 'type', `${name} must remain a named public type`)
    assert.ok(
      entry.currentEntryPoints.includes(entryPoint),
      `${name} must remain reachable from ${entryPoint}`,
    )
  }
})

test('a maths-only bundle keeps baseline bytes and excludes platform modules', async () => {
  const bundle = (entry: string) =>
    build({
      stdin: {
        contents: `import { multiplyMatrix4Batch } from '${entry}'; console.log(multiplyMatrix4Batch);`,
        resolveDir: new URL('../..', import.meta.url).pathname,
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      metafile: true,
      treeShaking: true,
      minify: true,
    })
  const baseline = await bundle('./packages/sdk-core/src/index.ts')
  const proposed = await bundle('./packages/sdk/index.ts')
  const browserProposed = await bundle('./packages/sdk/browser.ts')
  const inputs = Object.keys(proposed.metafile.inputs)
  assert.ok(inputs.some((path) => path.endsWith('/math/src/batch/batch.ts')))
  assert.ok(!inputs.some((path) => path.includes('/sdk-browser/') || path.includes('/sdk-node/')))
  // The minified bytes of a bundle of `multiplyMatrix4Batch` alone, through each entry: the engine
  // core, its node writes noted in their journal and its stage labels, the screen reflections and
  // the image effects among them; the package, with
  // the machine-independent quaternion normalisation and arc trigonometry; its browser condition.
  // The aim's scratch buffers are marked pure, so a bundle that never aims a node drops them; the
  // length rule's range (hypot outside the normal band) is kept. The browser entry's camera
  // projections read `length2` from the vector module, whose lazy init it starts; its transform tree
  // grows by the one growth rule (`resized`) and keeps a second list of the children whose world
  // something else composes (`firstLazy`, `lastLazy`).
  assert.equal(baseline.outputFiles[0].contents.length, 3_195)
  assert.equal(proposed.outputFiles[0].contents.length, 1_450)
  assert.equal(browserProposed.outputFiles[0].contents.length, 3_234)
  assert.ok(
    !Object.keys(browserProposed.metafile.inputs).some((path) => path.includes('/sdk-node/')),
  )
  const browserOutput = Object.values(browserProposed.metafile.outputs)[0]
  assert.ok(
    !Object.entries(browserOutput.inputs).some(
      ([path, contribution]) => path.includes('/sdk-browser/') && contribution.bytesInOutput > 0,
    ),
  )
})

test('one dot product is public, on three components: no N-dimensional one beside it', () => {
  for (const entry of [common, core, browser] as Record<string, unknown>[])
    assert.equal(entry.dot, undefined)
})
