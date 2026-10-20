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
  // The minified bytes of a bundle of `multiplyMatrix4` alone, through each entry: the engine
  // core, its node writes noted in their journal and its stage labels, the screen reflections and
  // the image effects among them; the package, with
  // the machine-independent quaternion normalisation and arc trigonometry; its browser condition.
  // The aim's scratch buffers are marked pure, so a bundle that never aims a node drops them; the
  // length rule's range (hypot outside the normal band) is kept. The browser entry's camera
  // projections read `length2` from the vector module, whose lazy init it starts; its transform tree
  // grows by the one growth rule (`resized`), keeps a second list of the children whose world
  // something else composes (`firstLazy`, `lastLazy`); the cache format's constants the compiler writes are
  // printed into one module (`contracts/writtenFormats.ts`), which the entry's chain now includes;
  // the render-origin module imports the matrix inverse and the culling batch the empty-bounds test,
  // two more module init calls in the chain (7 bytes, no function kept); the merged duplicate removals
  // (runtime, language, code) move it by two bytes more; the compute-path governor gone, its
  // contract's module leaves the browser chain; the light settings' tap count, gone with the
  // filtered shadow read, takes eleven off; the run-time proxy's contract, posed for deformed
  // placements, moves the core by sixty bytes off, the package and its browser condition by
  // fourteen and eighteen on. The batch twins gone, the bundle is of the single product
  // `multiplyMatrix4`, the kernels' bits. The light settings' samples a pixel, gone with the sampled
  // resolve, and the proxy's one ray budget of two milliseconds take nineteen off the core. The
  // batch union of moved boxes gone to the WebAssembly lot, its module scratch box with it, takes
  // thirty-five more off each of the three. Every module importing the maths from its own file,
  // not through the core's barrel, takes six off the core and 143 off the browser condition. The
  // node setters the package exports being the counted ones, noted in the write journal, put the
  // journal's counters in the package's chain: 32 bytes on, 42 on its browser condition. The core's
  // module values that read another module's settings — the explorer schema, the system prompt, the
  // stage labels' freeze — are built by calls marked pure, and the detail presets and the shadow
  // page read plain numbers instead of being read: the core drops all of them, down to 1 735. The
  // public maths' divisor floor, the aim's frame across and the tree's one growth rule add their
  // modules' init calls to the browser condition's chain: 90 bytes on. The box module's equality
  // gone with its last reader, it no longer imports the matrix elements: four off the browser one.
  // The float module's three private double word views become the one `bits.ts` view: six off
  // the core and the package; the browser condition, which reaches `bits.ts` for its double words,
  // now runs that module's float32 view too: 28 bytes on.
  assert.equal(baseline.outputFiles[0].contents.length, 1_729)
  assert.equal(proposed.outputFiles[0].contents.length, 1_397)
  assert.equal(browserProposed.outputFiles[0].contents.length, 3_102)
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
