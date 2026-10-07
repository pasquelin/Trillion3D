// The length rule in the impostor switch (docs/MATHS.md "Lengths"): the pivot's distance to the
// eye, swept over Halton forests and views against its former expression — `hypot3` —, every
// root's verdict the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planImpostors, type ImpostorRoot } from './plan.ts'
import { bakedMesh } from './bakedMesh.fixture.ts'
import { impostorRadius, impostorTexelDepth, impostorTriangleDepth } from './switch.ts'
import type { ImpostorSection } from '../contracts/impostor.ts'
import { halton } from '../../../math/src/sequence/halton.ts'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { maxStretch } from '../../../math/src/projection/projectionOracles.ts'
import { transformAffinePoint } from '../../../math/src/vector/vector.ts'
import { TAU } from '../../../math/src/constants.ts'

const TREE = { objectRadius: 4.2, rootTriangles: 2100, coverage: 0.43, frameSide: 128 }
const BUSH = { objectRadius: 0.6, rootTriangles: 460, coverage: 0.66, frameSide: 64 }
const INPUTS = { 1: TREE, 2: BUSH } as const
const section: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: 1117,
  textureLimit: 8192,
  baked: 2,
  refused: 0,
  meshes: [bakedMesh(1, 'tree', TREE), bakedMesh(2, 'bush', BUSH, true)],
}

/** A world turned by `angle` about y, scaled by `s`, at `(x, y, z)`, column-major. */
const placed = (x: number, y: number, z: number, angle: number, s: number) => {
  const c = Math.cos(angle) * s,
    n = Math.sin(angle) * s
  return [c, 0, -n, 0, 0, s, 0, 0, n, 0, c, 0, x, y, z, 1]
}

/** The view of an eye at `eye` turned by `yaw` about y then `pitch` about x: `R·(p − eye)`. */
function viewOf(eye: number[], yaw: number, pitch: number) {
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)]
  const rows = [
    [cy, 0, -sy],
    [sp * sy, cp, sp * cy],
    [cp * sy, -sp, cp * cy],
  ]
  const view = new Array<number>(16).fill(0)
  rows.forEach((row, r) => {
    row.forEach((value, c) => (view[c * 4 + r] = value))
    view[12 + r] = -(row[0] * eye[0] + row[1] * eye[1] + row[2] * eye[2])
  })
  view[15] = 1
  return view
}

/** The former verdict of `switchesAt`, word for word, on the root's own switch numbers. */
function oldSwitched(root: ImpostorRoot, view: number[], focal: number) {
  const input = INPUTS[root.mesh as 1 | 2],
    world = root.world.elements
  const radius = impostorRadius(input.objectRadius, maxStretch(world))
  const texelDepth = impostorTexelDepth(radius, input.frameSide, focal),
    triangleDepth = impostorTriangleDepth(radius, input.rootTriangles, input.coverage, focal)
  const v = transformAffinePoint(new Float64Array(3), view, world[12], world[13], world[14])
  const depth = Math.abs(v[2]),
    cosine = depth / hypot3(v[0], v[1], v[2])
  return depth * cosine >= texelDepth && depth * Math.sqrt(cosine) >= triangleDepth ? 1 : 0
}

test('every root switches as the former distance decided, over a forest and its views', () => {
  // 512 roots over 3 km, turned and scaled, under 8 views: 4096 verdicts, and the edges of a pivot
  // on the eye, straight ahead and straight aside.
  const roots: ImpostorRoot[] = Array.from({ length: 512 }, (_, r) => ({
    mesh: r % 3 === 0 ? 2 : 1,
    world: {
      elements: placed(
        3000 * halton(r + 1, 2) - 1500,
        40 * halton(r + 1, 3) - 20,
        3000 * halton(r + 1, 5) - 1500,
        TAU * halton(r + 1, 7),
        0.5 + 2 * halton(r + 1, 11),
      ),
    },
  }))
  roots.push(
    { mesh: 1, world: { elements: placed(0, 0, 0, 0, 1) } },
    { mesh: 1, world: { elements: placed(0, 0, -300, 0, 1) } },
    { mesh: 2, world: { elements: placed(300, 0, 0, 0, 1) } },
  )
  let switched = 0,
    verdicts = 0
  for (let v = 1; v <= 8; v++) {
    const eye = [400 * halton(v, 13) - 200, 30 * halton(v, 17), 400 * halton(v, 19) - 200]
    const view =
      v === 8 ? viewOf([0, 0, 0], 0, 0) : viewOf(eye, TAU * halton(v, 2), halton(v, 3) - 0.5)
    const focal = v % 2 ? 1117 : 700
    const plan = planImpostors(roots, section, view, focal)
    roots.forEach((root, r) => {
      assert.equal(plan.switched[r], oldSwitched(root, view, focal), `view ${v} root ${r}`)
      switched += plan.switched[r]
      verdicts++
    })
  }
  assert.ok(
    switched > verdicts / 8 && switched < (verdicts * 7) / 8,
    'views switch some, keep others',
  )
})
