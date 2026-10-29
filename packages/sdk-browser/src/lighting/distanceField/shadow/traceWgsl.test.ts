// The suns' mesh lists: a ray through a mesh's field, run on the shipped text with a sphere for
// the field, and the mesh's box seen from the light, the tiles it reaches.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { builtins } from '../../../materials/texture/shaderRunBuiltins.fixture.ts'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { DFSH_SCATTER_WGSL } from './scatterWgsl.ts'
import { dfshTraceObjectWgsl } from './traceObjectWgsl.ts'

/** The cone of the least radius, 0.4 centimetres, the surface not expanded. */
const MIN_CONE_RADIUS = 0.4

const len = (v: number[]) => Math.hypot(...v)

/** A mesh whose volume is the cube of half-size 1, a centimetre in the world each hundredth (the box
 *  is 200 centimetres wide), holding a sphere of radius 0.5 volume units (50 centimetres) at its
 *  centre: the field read at a position is its distance to the sphere. */
function traced(steps: number, two = false, bias = 0) {
  const object = {
    extent: [1, 1, 1],
    toWorldScale: [100, 100, 100],
    selfShadowBias: 0,
    surfaceBias: bias,
    mostlyTwoSided: two,
    asset: 0,
    volumeScale: 100,
  }
  const { dfshTraceCone } = shaderRun<{
    dfshTraceCone: (
      o: number,
      start: number[],
      end: number[],
      tan: number,
      minRadius: number,
      expandSurface: boolean,
      visibility: number,
    ) => number
  }>(wgslModule(dfshTraceObjectWgsl()), ['dfshTraceCone'], {
    dfsh: { trace: [0, 0, steps, 0], range: [0, 0, 1, 0] },
    loadDfObjectData: () => object,
    dfshWorld: (p: number[]) => p,
    dfWorldToVolume: (_: unknown, world: number[]) => world.map((x) => x / 100),
    dfAssetMip: () => ({ numMips: 1, scaleBias: [1, 0] }),
    sampleSparseMeshSdf: (p: number[]) => len(p) - 0.5,
  })
  return (x: number, tan: number) =>
    dfshTraceCone(0, [x, 0, -300], [x, 0, 9700], tan, MIN_CONE_RADIUS, false, 1) as number
}

test('a ray through the sphere is shadowed, one beside the box is lit, one grazing it is in the penumbra of its cone', () => {
  const ray = traced(64)
  assert.equal(ray(0, 0.0047), 0, 'through its centre')
  assert.equal(ray(400, 0.0047), 1, 'far off the box: the box is not met, nothing is traced')
  const cone = 0.1
  const edge = [60, 70, 80].map((x) => ray(x, cone))
  assert.ok(
    edge[0] < edge[1] && edge[1] < edge[2],
    `the penumbra widens with the distance: ${edge}`,
  )
  assert.ok(edge[0] > 0 && edge[2] < 1, `it is between: ${edge}`)
  // Inside the box, beside the sphere: the field's distance over the cone's radius there. The cone
  // radius is the tangent times the distance along the ray, at least 0.4 centimetres; the nearest
  // approach to the sphere's surface is 20 centimetres, at 300 centimetres from the ray's start.
  assert.ok(Math.abs(ray(70, cone) - 20 / (cone * 300)) < 0.05, `${ray(70, cone)}`)
})

test('a ray that has not left the box when its steps run out is shadowed, one that crosses it keeps the share of its steps left', () => {
  // 0.4 volume units from the sphere's surface at the nearest: each step is that long at least, the
  // box is two wide, and the third step has not crossed it.
  assert.equal(traced(3)(90, 0), 0, 'three steps run out inside the box')
  // Leaving it at step 3 of 64, it is forced toward shadow by the steps it used: 1 - 3 / 64.
  assert.ok(Math.abs(traced(64)(90, 0) - (1 - 3 / 64)) < 1e-6, `${traced(64)(90, 0)}`)
})

test('a two-sided mesh’s surface is expanded along the ray, by its bias over twice that bias', () => {
  const one = traced(64, false, 0.2)(60, 0)
  const two = traced(64, true, 0.2)(60, 0)
  assert.ok(one > 0.5, `a one-sided mesh’s field is as it is: ${one}`)
  assert.equal(two, 0, 'a two-sided one’s surface comes out to meet the ray')
})

/** The tiles of a grid of side `side` a mesh with the box of half-size `half` centimetres at `at`
 *  reaches, in the shadow space of a sphere of radius 500 centimetres at the origin whose z grows toward
 *  the light (0 at the sphere's far side). */
function reached(at: number[], half: number, side = 8) {
  const radius = 500
  const toShadow = builtins.mat4x4f(
    ...[1 / radius, 0, 0, 0, 0, 1 / radius, 0, 0, 0, 0, 1 / radius, 0, 0, 0, 1, 1],
  )
  const { dfshTileHit } = shaderRun<{ dfshTileHit: (tile: number[], object: number) => boolean }>(
    DFSH_SCATTER_WGSL,
    ['dfshTileHit'],
    {
      dfsh: { tiles: [side, 0, 0, 0], expand: [0, 0, 0, 0], toShadow },
      loadDfObjectData: () => ({ extent: [1, 1, 1] }),
      dfshObjectPoint: (_: number, local: number[]) => local.map((x, k) => at[k] + x * half),
    },
  )
  const hits: number[][] = []
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) if (dfshTileHit([x, y], 0)) hits.push([x, y])
  return hits
}

test('a mesh is listed in the tiles its box covers across the light, and in none beside it', () => {
  // A box of 100 centimetres at the sphere's centre: shadow x and y within 0.2, four tiles of eight
  // (each a quarter wide) in the middle... the box covers the two middle tiles of each axis.
  const hits = reached([0, 0, 0], 100)
  assert.deepEqual(hits, [
    [3, 3],
    [4, 3],
    [3, 4],
    [4, 4],
  ])
  // Moved 250 centimetres to the right, it covers the tiles further right only.
  const shifted = reached([250, 0, 0], 100)
  assert.ok(
    shifted.every(([x]) => x >= 4),
    `${shifted}`,
  )
  assert.ok(shifted.length > 0)
})

test('a mesh between the light and the cascade casts onto it, one behind it does not', () => {
  // The sphere's far side is z 0, its near side 2: a box at 900 centimetres toward the light is in
  // the tile's column (extruded to 1000), one 900 centimetres behind lies under z 0.
  assert.equal(reached([0, 0, 900], 100).length, 4, 'toward the light')
  assert.equal(reached([0, 0, -900], 100).length, 0, 'behind the cascade')
})
