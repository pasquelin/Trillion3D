// #1314 To-do 3, #1335: a root the impostor plan switches carries the card bit of its mark
// (`CARD_ROOT`), so every camera cut drops its clusters in the same breath as the card
// `planImpostors` yields for it, while its mark keeps no shadow bit: the object keeps its
// mesh's shadow. A root without the bit — any pre-impostor cache — is cut as before. Fails
// on develop: the card bit and its reading are new.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planImpostors, type ImpostorSection } from '../../../../sdk-core/src/index.ts'
import { collectClusterPages } from '../selection/selection.ts'
import { selectVisiblePages } from './cut.fixture.ts'
import { dagFixture, frontCamera } from '../selection/dag.fixture.ts'
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts'
import { focalPixels } from '../../../../math/src/projection/camera.ts'
import { CASTS_NO_SHADOW, markCard } from '../../visibility/shader/spriteWgsl.ts'
import { drawsCard } from './select.fixture.ts'

/** The engine camera of a host camera, as frame entry reads it (`readCameraWorld`). */
const engineOf = (cam: ReturnType<typeof frontCamera>) => readCameraWorld(createEngineCamera(), cam)

const VIEWPORT: [number, number] = [1280, 720]
const FOCAL = 1117
/** The compiled mesh number of the fixture's one root. Deliberately not 0: it differs from the
 *  root's rank, so a cut keying `switched` by mesh instead of rank would not suppress it. */
const MESH = 3
/** A baked atlas for the fixture's one mesh: at the engine's runtime focal its switch depth falls
 *  between the near (5 m) and far (200 m) cameras below. */
const section: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: FOCAL,
  textureLimit: 8192,
  baked: 1,
  refused: 0,
  meshes: [
    {
      mesh: MESH,
      sourceMesh: MESH,
      name: 'fixture',
      placements: 1,
      masked: false,
      rootTriangles: 100,
      radius: 1,
      status: 'baked',
      coverage: 0.5,
      hemi: false,
      frames: 12,
      frameSide: 64,
      atlasSide: 768,
      objectRadius: 1,
      switchDepth: { texel: 0, triangles: 0 },
      maps: {
        colourCoverage: { kind: 'coverage', levels: [] },
        normalDepth: { kind: 'data', levels: [] },
        orm: { kind: 'data', levels: [] },
      },
    },
  ],
}

/** The fixture's one root, keyed to the baked mesh; its world is the identity, so the camera's own
 *  distance sets the view depth the switch reads. */
function impostorRoots() {
  const fixture = dagFixture()
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  )
  for (const root of roots) root.mesh = MESH
  return { fixture, roots }
}

/** The focal length in pixels the engine's one `focalPixels` reads off the camera's projection. */
const focalOf = (cam: ReturnType<typeof frontCamera>) =>
  focalPixels(engineOf(cam).projection, VIEWPORT[0], VIEWPORT[1])

/** A plan as a backend builds it: the engine camera's world-to-view and the pixel focal. */
function planFor(
  cam: ReturnType<typeof frontCamera>,
  roots: ReturnType<typeof impostorRoots>['roots'],
) {
  return planImpostors(roots, section, engineOf(cam).view, focalOf(cam))
}

test('a switched root is left to its card by the camera cut, its shadow kept', () => {
  const { fixture, roots } = impostorRoots()
  const near = frontCamera(5),
    far = frontCamera(200, 5000)
  // The far camera switches the root; the near one draws it whole, so the switch is the view's.
  const plan = planFor(far, roots)
  assert.deepEqual([...plan.switched], [1], 'the far root switches')
  assert.equal(plan.cards.length, 1)
  assert.equal(plan.cards[0]?.mesh, MESH, 'the card reports the mesh, the mark sits on the root')
  assert.deepEqual([...planFor(near, roots).switched], [0], 'the near root does not')
  const options = { pixelError: 0, viewport: VIEWPORT }
  const whole = selectVisiblePages(roots, engineOf(far), options)
  assert.ok(whole.shown.length > 0, 'the root draws whole without its card bit')
  assert.equal(markCard(roots[0], true), true, 'the switch marks the root')
  const carded = selectVisiblePages(roots, engineOf(far), options)
  assert.deepEqual(carded.shown, [], 'the switched root shows no cluster')
  assert.deepEqual(carded.wanted, [], 'the switched root wants no cluster')
  // The card bit is no shadow bit: the object keeps its shadow.
  assert.equal(drawsCard(roots[0].mark), true)
  assert.equal((roots[0].mark ?? 0) & CASTS_NO_SHADOW, 0, 'the object keeps its shadow')
  assert.equal(markCard(roots[0], false), true)
  assert.equal(roots[0].mark, undefined, 'cleared, the mark is as before')
  assert.ok(selectVisiblePages(roots, engineOf(far), options).shown.length > 0)
  fixture.geometry.dispose()
})
