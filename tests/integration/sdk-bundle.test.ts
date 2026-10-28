// A maths-only bundle through each entry: its minified bytes, and no platform module in it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('a maths-only bundle keeps baseline bytes and excludes platform modules', async () => {
  const bundle = (entry: string) =>
    build({
      stdin: {
        contents: `import { multiplyMatrix4 } from '${entry}'; console.log(multiplyMatrix4);`,
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
  assert.ok(inputs.some((path) => path.endsWith('/math/src/matrix/matrix4.ts')))
  assert.ok(!inputs.some((path) => path.includes('/sdk-browser/') || path.includes('/sdk-node/')))
  // The minified bytes of a bundle of `multiplyMatrix4` alone, through each entry: the engine core,
  // the package, and its browser condition. A module whose top-level values are built by calls not
  // marked pure, or whose imports run code, shows here as bytes: a bundle that never reads a table
  // must drop it. The core's 1_547 fell to 1_371 once `ANY_NUMBER` (a `Number.MAX_VALUE` read) and
  // `PREVIEW_STORED_LAYOUTS` (a spread) became literals: neither is kept alive any more. It reads
  // 1_372 since the surface cache's rules are built as sub-tables, each in a call marked pure: the
  // same code, one minified name a letter longer. The core's 1_373 and the browser's 3_025 since the
  // lighting's new top-level symbols, all dropped from these bundles, push one more name past a letter:
  // every kept module unchanged. The package's 1_362 since one more name past a letter, the same
  // way: the core's bundle of the same modules keeps its 1_373.
  assert.equal(baseline.outputFiles[0].contents.length, 1_373)
  assert.equal(proposed.outputFiles[0].contents.length, 1_362)
  assert.equal(browserProposed.outputFiles[0].contents.length, 3_025)
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
