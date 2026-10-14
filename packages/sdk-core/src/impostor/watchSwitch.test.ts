// The switch a watch reads from nothing: the engine's one CPU oracle over the baked numbers and the
// view, so two meshes of different R and T flip at different distances, the placement's largest
// scale moves R and the switch with it, and an entry the switch cannot read keeps the root whole.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ImpostorRoot } from './switchTable.ts'
import { impostorBakedByMesh } from './baked.ts'
import { impostorSwitchDepth } from './switch.ts'
import { BUSH, TREE, bakedMesh } from './bakedMesh.fixture.ts'
import { readFromNothing } from './watch.fixture.ts'
import type { ImpostorMesh, ImpostorSection } from '../contracts/impostor.ts'

const FOCAL = 1117
const REFUSED: ImpostorMesh = {
  ...bakedMesh(9, 'rock', { objectRadius: 1, rootTriangles: 10, coverage: 0, frameSide: 16 }),
  status: 'refused',
  maps: undefined,
  coverage: undefined,
  reason: 'root-cheaper-than-impostor',
}
const section: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: FOCAL,
  textureLimit: 8192,
  baked: 2,
  refused: 1,
  meshes: [bakedMesh(1, 'tree', TREE), bakedMesh(2, 'bush', BUSH, true), REFUSED],
}

/** A column-major world: uniform scale `s`, translation `(x, y, z)`. */
const world = (x: number, y: number, z: number, s = 1): ImpostorRoot['world'] => ({
  elements: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1],
})
const IDENTITY_VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const watched = (roots: ImpostorRoot[], baked: ImpostorSection | undefined = section) =>
  readFromNothing(roots, baked, IDENTITY_VIEW, FOCAL)
const switched = (roots: ImpostorRoot[], baked?: ImpostorSection) => [
  ...watched(roots, baked).switched,
]

test('a far root switches, its radius the baked one; a near root and a refused one draw whole', () => {
  const roots: ImpostorRoot[] = [
    { mesh: 1, world: world(0, 0, -200) },
    { mesh: 2, world: world(3, 0, -10) },
    { mesh: 9, world: world(0, 0, -200) },
  ]
  const watch = watched(roots)
  assert.deepEqual([...watch.switched], [1, 0, 0], 'only the far tree switches')
  assert.equal(watch.radiusOf(0), TREE.objectRadius)
})

test('the switch is the CPU oracle over the baked numbers and the view', () => {
  for (const [mesh, input] of [
    [1, TREE],
    [2, BUSH],
  ] as const) {
    const depth = impostorSwitchDepth(input, FOCAL)
    const decide = (z: number) => switched([{ mesh, world: world(0, 0, -z) }])[0]
    assert.equal(decide(depth - 1), 0, `mesh ${mesh} whole before z_s`)
    assert.equal(decide(depth + 1), 1, `mesh ${mesh} card after z_s`)
    // The boundary is a property of the mesh: no constant is shared between the two.
    assert.notEqual(depth, impostorSwitchDepth(mesh === 1 ? BUSH : TREE, FOCAL))
  }
  const depths = [TREE, BUSH].map((input) => impostorSwitchDepth(input, FOCAL))
  assert.ok(depths[0] > depths[1], 'the tree switches beyond the bush')
})

test('the largest world scale of the placement moves R and the switch with it', () => {
  const [unity, scaled] = [1, 2].map((s) => watched([{ mesh: 1, world: world(0, 0, -300, s) }]))
  assert.equal(unity.radiusOf(0), TREE.objectRadius)
  assert.equal(scaled.radiusOf(0), 2 * TREE.objectRadius)
  // R doubled, the switch moves out: at one depth the scaled placement is still whole where the
  // unscaled one already switches.
  const at = (s: number) => switched([{ mesh: 1, world: world(0, 0, -150, s) }])[0]
  assert.deepEqual([at(1), at(2)], [1, 0])
})

test('a refused entry, an unknown mesh and an absent section switch nothing', () => {
  const far = world(0, 0, -500)
  const roots = [{ mesh: 9, world: far }, { mesh: 77, world: far }, { world: far }]
  assert.deepEqual(switched(roots), [0, 0, 0])
  assert.equal(impostorBakedByMesh(section).size, 2, 'refused entries stay out of the lookup')
  assert.equal(impostorBakedByMesh(undefined).size, 0)
  const tree = [{ mesh: 1, world: far }]
  assert.deepEqual(switched(tree), [1])
  // The far tree that switches above draws whole once its section is absent or empty.
  for (const absent of [undefined, { ...section, meshes: [] }])
    assert.deepEqual(switched([...tree, ...tree, ...tree], absent), [0, 0, 0])
})

test('a far hemi root switches, and incomplete switch data stays in geometry', () => {
  const roots = [{ mesh: 2, world: world(0, 0, -1000) }]
  assert.deepEqual(switched(roots), [1])
  const incomplete = { ...section, meshes: [{ ...section.meshes[1], coverage: 0 }] }
  assert.deepEqual(switched(roots, incomplete), [0])
})

test('the baked lookup reads a section once and reuses it for every watch', () => {
  let reads = 0
  const cached = {
    ...section,
    get meshes() {
      reads++
      return section.meshes
    },
  }
  const roots = [{ mesh: 1, world: world(0, 0, -1000) }]
  assert.deepEqual(switched(roots, cached), switched(roots, cached))
  assert.equal(reads, 1)
})

test('off the view axis a root switches only where one atlas texel stays within a pixel', () => {
  // At view depth z and distance d the projection stretches a displacement at the pivot by at most
  // f·d/z² (its Jacobian's largest singular value), so the texel of 2R/r_f metres covers
  // (2R/r_f)·f·d/z² pixels, and an area grows by f²·d/z³: the pixels the root covers.
  const rock = { objectRadius: 2, rootTriangles: 50000, coverage: 0.8, frameSide: 64 }
  const sharp = { ...section, meshes: [bakedMesh(3, 'rock', rock)] }
  const decide = (x: number, z: number) => switched([{ mesh: 3, world: world(x, 0, -z) }], sharp)[0]
  const depth = impostorSwitchDepth(rock, FOCAL)
  assert.deepEqual([decide(0, depth), decide(0, depth * (1 - 1e-12))], [1, 0], 'on the axis, z_s')
  for (const q of [0.25, 0.6, 1.03, 1.18]) {
    // At d = z_s a texel spans 1+q² pixels; the switch waits for z = √(1+q²)·z_s, d = (1+q²)·z_s.
    const z = depth * Math.sqrt(1 + q * q) * (1 + 1e-9)
    const onAxis = (depth / Math.sqrt(1 + q * q)) * (1 + 1e-9) // d just past z_s
    assert.equal(decide(q * onAxis, onAxis), 0, `q ${q}: the distance alone no longer switches`)
    assert.equal(decide(q * z, z), 1, `q ${q}: switched once (2R/r_f)·f·d/z² ≤ 1`)
    assert.equal(decide(q * z * (1 - 1e-6), z * (1 - 1e-6)), 0, `q ${q}: whole just nearer`)
    const pixels = ((2 * rock.objectRadius) / rock.frameSide) * FOCAL * Math.hypot(q * z, z)
    assert.ok(pixels / (z * z) <= 1, `q ${q}: at most one pixel per texel`)
  }
  // A triangle-bound tree covers c·π·R²·f²·d/z³ pixels: T reaches them at z·√(z/d) = z_tri.
  const tree = impostorSwitchDepth(TREE, FOCAL),
    q = 1,
    z = tree * Math.sqrt(Math.SQRT2) * (1 + 1e-9)
  const at = (x: number, depthAt: number) =>
    switched([{ mesh: 1, world: world(x, 0, -depthAt) }])[0]
  assert.deepEqual([at(q * z, z), at(q * z * (1 - 1e-6), z * (1 - 1e-6))], [1, 0])
  // Behind the eye, its mirror in front.
  assert.equal(at(q * z, -z), 1)
  assert.equal(at(q * z * (1 - 1e-6), -z * (1 - 1e-6)), 0)
})
