// Coplanar surfaces on the WebGPU page raster, compiled by this checkout's native compiler from the
// coplanar goldens (`tests/fixtures/formats/coplanar/`, `facingWorld.ts`):
//
//  - `three-stack`: three opaque squares on one plane, 6, 4 and 2 units wide, the smallest on top
//    (`expected.json`: depth layers 0, 1, 2). Each one shows whole and alone where it is the top
//    layer — the light paint, the dark checker around it, the light concrete around both — and
//    no pixel of a lower layer fights through it.
//  - `blend-overlay`: a blended glass (`alphaMode` BLEND, a blue tint at 0.4) lying exactly on an
//    opaque grey square. The glass draws over its base everywhere — the grey turns blue — and the
//    same everywhere: no pixel of the base shows bare.
//
//   node bench/dawn/proofs.ts tests/gpu/blend/coplanar-layers.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { runOnDawn } from '../kit/onDawn.ts'
import { settle } from '../world/proofWorld.ts'
import { FACING, openFacingWorld, region } from '../frame/facingWorld.ts'

/** The settled image of the golden `name`, and whether it was held. */
async function settledImage(name: string) {
  const world = await openFacingWorld(name)
  try {
    const held = (await settle(world, FACING)) !== null
    return { held, image: new Uint8Array(await world.capture()) }
  } finally {
    world.dispose()
  }
}

/** Every region of both goldens, inset from each edge by a quarter unit. */
async function readings() {
  const stack = await settledImage('three-stack'),
    overlay = await settledImage('blend-overlay')
  return {
    held: [stack.held, overlay.held],
    paint: region(stack.image, [0.25, 1.75], [0.25, 1.75]),
    checker: [
      ...region(stack.image, [2.25, 3.75], [0.25, 3.75]),
      ...region(stack.image, [0.25, 1.75], [2.25, 3.75]),
    ],
    concrete: [
      ...region(stack.image, [4.25, 5.75], [0.25, 5.75]),
      ...region(stack.image, [0.25, 3.75], [4.25, 5.75]),
    ],
    glass: region(overlay.image, [0.25, 3.75], [0.25, 3.75]),
  }
}

const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** The widest gap of one channel between two pixels of a region. A flat square drawn alone stays
 *  within a few levels — what light the view direction changes across it —; a pixel of another
 *  layer jumps by the gap between the two colours, tens of levels. */
const spread = (pixels: number[][]) =>
  Math.max(
    ...[0, 1, 2].map(
      (c) => Math.max(...pixels.map((p) => p[c])) - Math.min(...pixels.map((p) => p[c])),
    ),
  )

test('coplanar layers draw the top one alone, and a blended glass over its base', async () => {
  const errors: string[] = []
  const read = await runOnDawn(readings, null, errors)
  const darkest = (pixels: number[][]) => Math.min(...pixels.map(luminance))
  const lightest = (pixels: number[][]) => Math.max(...pixels.map(luminance))
  console.log(
    JSON.stringify({
      held: read.held,
      paint: [darkest(read.paint), spread(read.paint)],
      checker: [lightest(read.checker), spread(read.checker)],
      concrete: [darkest(read.concrete), spread(read.concrete)],
      glass: [read.glass[0], spread(read.glass)],
    }),
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(read.held, [true, true], 'both images are held')
  // Three layers, each its own colour all over: a pixel of a lower layer would break the spread.
  const SMOOTH = 12
  for (const [name, pixels] of Object.entries({
    paint: read.paint,
    checker: read.checker,
    concrete: read.concrete,
  }))
    assert.ok(spread(pixels) <= SMOOTH, `${name}: a lower layer fights through (${spread(pixels)})`)
  // The dark checker between two light layers: neither light one shows through it, nor it through
  // the paint on top of it.
  assert.ok(
    lightest(read.checker) + 40 < darkest(read.paint),
    'the paint is drawn over the checker',
  )
  assert.ok(lightest(read.checker) + 40 < darkest(read.concrete), 'the checker covers the concrete')
  // The glass tints its grey base blue, the same at every point of it.
  for (const [r, , b] of read.glass) assert.ok(b > r + 6, `the glass is not drawn over its base`)
  assert.ok(spread(read.glass) <= SMOOTH, 'the base shows bare at a point of the glass')
})
