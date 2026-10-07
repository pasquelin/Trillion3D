// The CPU's share of the impostor cards follows the switches, not the cards: on generated fields of
// 10³ to 10⁵ far objects at one density, the first image writes each card once; a still view then
// reads no root and writes no record; a swaying or turning one reads and writes about what
// switched — as much at 10⁵ objects as at 10³.
import test from 'node:test'
import assert from 'node:assert/strict'
import './lent.fixture.ts'
import { createImpostorCards, planImpostorCards } from './cards.ts'
import { impostorSection, MESH } from './section.fixture.ts'
import { engineCamera } from '../camera/camera.fixture.ts'
import { fieldCamera } from '../gpu/dag/placementTree.fixture.ts'
import { CARD_ROOT } from '../visibility/shader/spriteWgsl.ts'
import type { ClusterRoot } from '../page/selection/types.ts'

const VIEWPORT = [1280, 720]
const GROUP = { atlas: MESH }

/** `count` objects at one per 400 m² on a disk about the origin: the near ones whole, most far. */
function field(count: number) {
  const radius = Math.sqrt((count * 400) / Math.PI)
  let seed = 11
  const next = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  return Array.from({ length: count }, () => {
    const r = radius * Math.sqrt(next()),
      a = 2 * Math.PI * next()
    const elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r * Math.cos(a), 0, r * Math.sin(a), 1]
    return { mesh: MESH, world: { elements } } as unknown as ClusterRoot<unknown>
  })
}

/** Image `k` of a camera swaying a metre about the origin, `turn` sweeping its view. */
const swayAt = (k: number, turn = 0) => {
  const eye = [Math.sin(k * 0.21), 1.7, 0.6 * Math.cos(k * 0.13)],
    a = 0.02 * Math.sin(k * 0.17) + turn * k
  return engineCamera(fieldCamera(eye, [eye[0] + Math.sin(a), 1.7, eye[2] - Math.cos(a)], 1e5))
}

/** Per image of a field of `count`: roots read, records written and card bits moved. */
function lawOf(count: number) {
  const roots = field(count),
    state = createImpostorCards<typeof GROUP>(impostorSection)
  let moved = 0
  const image = (k: number, turn = 0) => {
    const writes = state.slots.writes
    moved = 0
    planImpostorCards(
      state,
      roots,
      swayAt(k, turn),
      VIEWPORT,
      () => GROUP,
      () => moved++,
    )
    return { reads: state.watch.reads, writes: state.slots.writes - writes, moved }
  }
  // The atlas is resident from the first image: every far object takes its card at once.
  const first = image(0)
  const carded = roots.filter((root) => (root.mark ?? 0) & CARD_ROOT).length
  const still = [1, 2, 3, 4, 5].map(() => image(0))
  let reads = 0,
    writes = 0,
    switched = 0
  for (let k = 1; k <= 120; k++) {
    const one = image(k, k > 60 ? 0.004 : 0)
    reads += one.reads
    writes += one.writes
    switched += one.moved
  }
  return {
    first,
    carded,
    still,
    reads: reads / 120,
    writes: writes / 120,
    switched: switched / 120,
  }
}

test('records follow the switches: none for a still view, as many at 10⁵ objects as at 10³', () => {
  const laws = [1e3, 1e4, 1e5].map(lawOf)
  for (const { first, carded, still } of laws) {
    assert.ok(carded > 0.9 * first.reads * 0.5, `${carded} cards of ${first.reads}`)
    assert.equal(first.writes, carded, 'each card written once')
    for (const image of still) assert.deepEqual(image, { reads: 0, writes: 0, moved: 0 })
  }
  const [small, , large] = laws
  console.log(
    laws
      .map(
        ({ reads, writes, switched }) =>
          `${reads.toFixed(1)} read, ${writes.toFixed(1)} written, ${switched.toFixed(1)} switched`,
      )
      .join(' · '),
  )
  assert.ok(large.reads <= 1.5 * small.reads + 20, `${large.reads} reads against ${small.reads}`)
  assert.ok(
    large.writes <= 1.5 * small.writes + 4,
    `${large.writes} writes against ${small.writes}`,
  )
  assert.ok(large.writes <= 2 * large.switched + 1, 'a record per card that switched')
})
