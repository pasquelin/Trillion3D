// The impostor card's distance to the eye moved from `hypot3` to the engine's one length rule,
// `length3` (docs/MATHS.md "Lengths"; `cards.ts`). The distance only reaches the GPU as the card's
// mip level, `max(0, log2(distance / texel depth))`, in the float32 record: `planImpostorCards`
// runs on the baked fixture seen from swept eyes, and each card's level is the float32 of the old
// expression's.
import test from 'node:test'
import assert from 'node:assert/strict'
import './lent.fixture.ts'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import { focalPixels } from '../../../math/src/projection/camera.ts'
import {
  assertSameFloat32,
  HALTON_SWEEP,
  haltonSpan,
} from '../../../math/src/sequence/sweep.fixture.ts'
import { impostorTexelDepth } from '../../../sdk-core/src/index.ts'
import { createEngineCamera, readCameraWorld } from '../camera/world.ts'
import * as G from '../host/graph/graph.fixture.ts'
import { CARD_FLOATS, createImpostorCards, planImpostorCards } from './cards.ts'
import { impostorScene, impostorSection, VIEWPORT } from './section.fixture.ts'

/** The level's place in a card record: its shape's fourth word (`writeCard`). */
const LEVEL = 51

test('planImpostorCards writes the float32 mip level of the hypot3 distance', () => {
  const { roots } = impostorScene(),
    state = createImpostorCards<string>(impostorSection),
    eye = new Float64Array(3)
  let cards = 0,
    parted = 0
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    // An eye in any direction from the root, 2 to 2·10⁵ away, looking at it.
    const turn = haltonSpan(i, 2, 0, 2 * Math.PI),
      rise = haltonSpan(i, 3, -0.99, 0.99),
      away = 2 * 10 ** haltonSpan(i, 5, 0, 5),
      ring = Math.sqrt(1 - rise * rise)
    eye.set([away * ring * Math.cos(turn), away * rise, away * ring * Math.sin(turn)])
    const host = G.perspectiveCamera(55, 16 / 9, 0.1, 1e6)
    host.position.set(eye[0], eye[1], eye[2])
    host.lookAt(0, 0, 0)
    host.updateMatrixWorld()
    const cam = readCameraWorld(createEngineCamera(), host)
    planImpostorCards(state, roots, cam, VIEWPORT, () => 'atlas')
    const focal = focalPixels(cam.projection, VIEWPORT[0], VIEWPORT[1])
    // Every planned card is written, so record `c` is planned card `c`.
    assert.equal(state.count, state.plan!.cards.length, `eye ${i}`)
    for (let c = 0; c < state.count; c++) {
      const world = state.worlds[c],
        card = state.plan!.cards[c],
        R = card.radius,
        { frameSide } = state.baked.get(card.mesh)!
      const dx = world[12] - cam.eye[0],
        dy = world[13] - cam.eye[1],
        dz = world[14] - cam.eye[2]
      const old = hypot3(dx, dy, dz)
      if (old !== length3(dx, dy, dz)) parted++
      const depth = impostorTexelDepth(R, frameSide, focal)
      const level = state.records[c * CARD_FLOATS + LEVEL]
      assertSameFloat32(Math.max(0, Math.log2(old / depth)), level, `eye ${i} card ${c}`)
      cards++
    }
  }
  // The sweep writes cards, and meets distances where the two rules part.
  assert.ok(cards > 0, 'no card written')
  assert.ok(parted > 0, 'no distance parts')
})
