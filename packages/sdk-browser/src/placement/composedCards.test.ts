// A root a parent composes on the GPU keeps its impostor card, and the card follows the parent: it
// is written again, on the parent's move, from the world the root reads (`gpuCompose.ts`,
// `composedWorld`) — the parent's world times its local —, never from the one of its last full
// write.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../impostor/lent.fixture.ts'
import { createImpostorCards, impostorWorldsMoved, planImpostorCards } from '../impostor/cards.ts'
import { engineAt, impostorScene, impostorSection, VIEWPORT } from '../impostor/section.fixture.ts'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { composeRuntime } from './composeRuntime.fixture.ts'
import { createPlacementRows } from './rows.ts'

const GROUP = { atlas: 1 }
const translate = (x: number, y: number, z: number) => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
]

test('a composed root keeps its card, written again on its parent’s move from the world it reads', () => {
  const { fixture, roots } = impostorScene(),
    cards = createImpostorCards<typeof GROUP>(impostorSection, { atlasOf: () => GROUP })
  const rows = createPlacementRows(1)
  const root = roots[0] as unknown as { placement: unknown; world: { elements: Float64Array } }
  root.placement = { rows, index: 0 }
  const rt = composeRuntime(roots)
  Object.assign(rt.gpu, {
    impostors: Object.assign(cards, {
      worldsMoved: (ranks: ArrayLike<number>) => impostorWorldsMoved(cards, ranks),
    }),
  })
  planImpostorCards(cards, roots, engineAt(200), VIEWPORT)
  assert.equal(cards.count, 1, 'a card before the root is composed')
  const parent = {},
    local = translate(0, 0, 0)
  assert.ok(
    composeWebgpuPlacements(rt, parent, translate(0, 0, 0), [{ rows, index: 0, local }], true),
  )
  planImpostorCards(cards, roots, engineAt(200), VIEWPORT)
  assert.equal(cards.count, 1, 'composed, it keeps it')
  const translation = () =>
    [0, 1, 2].map((k) => cards.slots.records[12 + k] + cards.slots.records[16 + k])
  assert.deepEqual(translation(), [0, 0, 0])
  // The parent moves: no CPU world is written, the card is.
  composeWebgpuPlacements(rt, parent, translate(2.5, 0, 0), [], false)
  planImpostorCards(cards, roots, engineAt(200), VIEWPORT)
  assert.deepEqual(translation(), [2.5, 0, 0], 'the card stands where the GPU draws the root')
  assert.equal(cards.count, 1)
  fixture.geometry.dispose()
})
