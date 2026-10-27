// The scene trace (`stTrace`, `sceneTraceWgsl.ts`) meets the triangles a brute force over the same
// triangles meets. A scene of a ground, turned, stretched and mirrored boxes and two-sided panels is
// compiled with its ray tracing file and opened on Dawn; once its view is held, the trace is built
// as the engine builds it — over the cut's tables and the roots in the cut's order — and 4096 rays
// are cast, one a thread: from a grid near the eye, over the view and over all directions. Each
// ray's nearest hit is compared with the oracle's (`sceneTraceOracle.ts`: every triangle of every
// placement, and, where the cut packs a world DAG, of every actor of the cells it draws, in doubles), then 4096 shadow rays from the ground toward the sun (the first hit, the
// front faces culled, the shadow rules) against the oracle's "is anything in the way".
//
// A second scene, the same one far from the eye and compiled with two HLOD levels, has HLOD actors, a directory of them and
// cells whose words say which the cut draws: 4096 rays aimed at the drawn actors' triangles are cast, and each hit's distance,
// triangle and object are compared with the oracle's, which takes the actors' triangles from their records one by one and the
// object from the roots the surface cache follows, never through the directory nor the cells' words the trace reads.
//
// A ray that passes within a hair of a triangle's edge is grazing — the oracle's answer then differs
// when the triangles are grown or shrunk by 1e-4 in barycentric coordinates — and is counted, not
// compared: at most 0.5 % of the rays. The rays and the kernel are in `sceneTraceRays.ts`, the
// comparisons in `sceneTraceCompare.ts` and the held view in `sceneTraceHeld.ts`; the card shadows'
// chain is the proof `card-shadow-chain.gpu.ts`.
//
//   node bench/dawn/proofs.ts tests/gpu/rays/scene-trace.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { runOnDawn } from '../../kit/device/onDawn.ts'
import { PLAIN_RULES, traceBruteForce } from './sceneTraceOracle.ts'
import {
  actorRays,
  Casts,
  GRAZING,
  RAYS,
  CULL_BACK,
  nearestRays,
  shadowRays,
  SKIP_NEAR,
  SKIP_TRANSLUCENT,
  surfaceRays,
} from './sceneTraceRays.ts'
import { compareNearest, compareShadow } from './sceneTraceCompare.ts'
import { type Held, measure } from './sceneTraceHeld.ts'

/** The batches of the plain scene: the view's rays, the shadow rays and the radiosity's rays against the oracle's. */
async function plainBatches({ cast, placed, eye, view, trace }: Held) {
  const nearest = new Casts()
  nearestRays(nearest)
  const shadows = new Casts()
  shadowRays(shadows, eye)
  const plain = compareNearest(placed, nearest, await cast(nearest), eye)
  const shadow = compareShadow(placed, shadows, await cast(shadows), eye)
  // The rays of the radiosity, from the surfaces the view's rays met: the back faces culled, or the near hits passed by,
  // the translucent primitives left out either way.
  const NEAR = { backFace: 4, twoSided: 3 }
  trace.writeParams({
    ...view,
    skipBackFaceDistance: NEAR.backFace,
    skipTwoSidedDistance: NEAR.twoSided,
  })
  const rules = { ...PLAIN_RULES, skipTranslucent: true }
  const culling = { ...rules, cullBack: true }
  const skipping = { ...rules, skipNear: NEAR }
  const culled = new Casts()
  surfaceRays(culled, nearest, placed, eye, CULL_BACK | SKIP_TRANSLUCENT)
  const skipped = new Casts()
  surfaceRays(skipped, nearest, placed, eye, SKIP_NEAR | SKIP_TRANSLUCENT)
  // How many rays the rules change: the oracle's hit with them against its hit without.
  const changed = (casts: Casts, ruled: typeof culling | typeof skipping) =>
    Array.from({ length: RAYS }, (_, i) => {
      const a = traceBruteForce(placed, casts.oracle(i, eye, rules))
      const b = traceBruteForce(placed, casts.oracle(i, eye, ruled))
      return a.hit !== b.hit || a.t !== b.t
    }).filter(Boolean).length
  return {
    nearest: plain,
    shadow,
    culled: {
      ...compareNearest(placed, culled, await cast(culled), eye, culling),
      changed: changed(culled, culling),
    },
    skipped: {
      ...compareNearest(placed, skipped, await cast(skipped), eye, skipping),
      changed: changed(skipped, skipping),
    },
  }
}

/** The batch of the HLOD scene: rays aimed at the drawn actors' triangles, each hit compared with the oracle's by distance,
 *  triangle and object. */
async function hlodBatches({ cast, placed, eye }: Held) {
  const aimed = new Casts()
  actorRays(aimed, placed, eye)
  return { actors: compareNearest(placed, aimed, await cast(aimed), eye) }
}

let measured: Promise<Awaited<ReturnType<typeof plainBatches>>> | undefined
let measuredHlod: Promise<Awaited<ReturnType<typeof hlodBatches>>> | undefined
const errors: string[] = []
const results = () => (measured ??= runOnDawn(() => measure('plain', plainBatches), null, errors))
const hlodResults = () =>
  (measuredHlod ??= runOnDawn(() => measure('hlod', hlodBatches), null, errors))

test('the scene trace meets the nearest triangle a brute force over the same triangles meets', async () => {
  const { nearest } = await results()
  console.log(JSON.stringify({ nearest }))
  assert.deepEqual(errors, [])
  const detail = nearest.problems.join(' | ')
  assert.ok(
    nearest.hits > RAYS / 4 && nearest.misses > 0,
    'the rays must hit the scene and leave it',
  )
  assert.ok(nearest.placementsMet >= 4, 'the rays must meet several placements')
  assert.equal(nearest.incomplete, 0, 'every trace is complete')
  assert.ok(
    nearest.grazing <= RAYS * GRAZING,
    `${nearest.grazing} grazing rays, past ${GRAZING * 100} %`,
  )
  assert.equal(nearest.wrongHit, 0, `hit and miss part: ${detail}`)
  assert.equal(
    nearest.wrongObject,
    0,
    `hits told by another object than their placement: ${detail}`,
  )
  assert.ok(nearest.worstGap <= 1, `a distance off by ${nearest.worstGap} tolerances: ${detail}`)
  assert.ok(
    nearest.wrongTriangle + nearest.wrongFace <= RAYS * GRAZING,
    `${nearest.wrongTriangle} hits on another triangle, ${nearest.wrongFace} on the other face: ${detail}`,
  )
})

test('a shadow ray is blocked exactly where a brute force finds a triangle in its way', async () => {
  const { shadow } = await results()
  console.log(JSON.stringify({ shadow }))
  assert.deepEqual(errors, [])
  assert.ok(
    shadow.blocked > 0 && shadow.open > 0,
    'the sun must be blocked from some ground and not from the rest',
  )
  assert.ok(
    shadow.grazing <= RAYS * GRAZING,
    `${shadow.grazing} grazing rays, past ${GRAZING * 100} %`,
  )
  assert.equal(shadow.wrong, 0, `shadow rays that disagree: ${shadow.problems.join(' | ')}`)
})

test('a ray of the radiosity culls the back faces, or passes the near hits, and leaves the translucent out, where a brute force does', async () => {
  const { culled, skipped } = await results()
  console.log(JSON.stringify({ culled, skipped }))
  assert.deepEqual(errors, [])
  for (const [name, batch] of [
    ['culled', culled],
    ['skipped', skipped],
  ] as const) {
    const detail = batch.problems.join(' | ')
    assert.ok(batch.changed > 0, `${name}: the rules must change some rays`)
    assert.equal(batch.incomplete, 0, `${name}: every trace is complete`)
    assert.ok(batch.grazing <= RAYS * GRAZING, `${name}: ${batch.grazing} grazing rays`)
    assert.equal(batch.wrongHit, 0, `${name}: hit and miss part: ${detail}`)
    assert.ok(
      batch.worstGap <= 1,
      `${name}: a distance off by ${batch.worstGap} tolerances: ${detail}`,
    )
    assert.ok(
      batch.wrongTriangle + batch.wrongFace <= RAYS * GRAZING,
      `${name}: ${batch.wrongTriangle} hits on another triangle, ${batch.wrongFace} on the other face: ${detail}`,
    )
  }
})

test('a ray aimed at an HLOD actor meets the triangle and the object a brute force over the actors’ records meets', async () => {
  // Every trace here is of rays that reach an actor (or something nearer in front of it), so a hit is the rule.
  const { actors } = await hlodResults()
  console.log(JSON.stringify({ actors }))
  assert.deepEqual(errors, [])
  const detail = actors.problems.join(' | ')
  assert.ok(actors.actorHits > RAYS / 4, `${actors.actorHits} rays met an HLOD actor`)
  assert.equal(actors.incomplete, 0, 'every trace is complete')
  assert.ok(actors.grazing <= RAYS * GRAZING, `${actors.grazing} grazing rays`)
  assert.equal(actors.wrongHit, 0, `hit and miss part: ${detail}`)
  assert.ok(actors.worstGap <= 1, `a distance off by ${actors.worstGap} tolerances: ${detail}`)
  assert.ok(
    actors.wrongTriangle + actors.wrongFace <= RAYS * GRAZING,
    `${actors.wrongTriangle} hits on another triangle, ${actors.wrongFace} on the other face: ${detail}`,
  )
  assert.equal(actors.wrongObject, 0, `hits told by another object: ${detail}`)
  assert.ok(
    actors.standInHits > 0,
    `${actors.standInHits} hits on an HLOD actor told by a stand-in: the proof never exercises the stand-in object`,
  )
})
