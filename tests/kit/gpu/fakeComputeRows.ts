// The rows pass and the compose worlds pass a fake device replays: the shipped WGSL itself, run in
// JavaScript (`shaderRun`), over the buffers the dispatch binds — every word a row's world decides
// is then the GPU's, as a session on a device writes it.
import { shaderRun } from '../../../packages/sdk-browser/src/texture/shaderRun.fixture.ts'
import {
  DERIVE_ROWS_ENTRY,
  DERIVE_ROWS_WGSL,
} from '../../../packages/sdk-browser/src/placement/rowWordsWgsl.ts'
import {
  COMPOSE_WORLDS_ENTRY,
  COMPOSE_WORLDS_WGSL,
  NONE,
} from '../../../packages/sdk-browser/src/placement/gpuComposeWgsl.ts'
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
} from '../../../packages/sdk-browser/src/placement/composeDoubles.fixture.ts'
import type { ComputeBind } from './fakeCompute.ts'
import { floats, words } from './fakeBuffers.ts'

/** A buffer's words as the doubles the shader reads, each a pair of words: reads and writes go to
 *  the words where they sit. */
const pairs = (held: Uint32Array) =>
  new Proxy([] as number[][], {
    get(_, key) {
      if (key === 'length') return held.length >> 1
      const at = typeof key === 'string' ? Number(key) : NaN
      return Number.isInteger(at) ? [held[at * 2], held[at * 2 + 1]] : undefined
    },
    set(_, key, value: number[]) {
      const at = Number(key)
      held[at * 2] = value[0]
      held[at * 2 + 1] = value[1]
      return true
    },
  })

/** The bound buffer of `binding`, as words. */
const boundWords = (bind: ComputeBind, binding: number) =>
  words(bind.entries.find((entry) => entry.binding === binding)!.resource.buffer.data)

const arrayLength = (ref: { get(): { length: number } }) => ref.get().length

/** The functions of the rows pass a run names: its own and the library's it reaches. */
const ROW_FUNCTIONS = [
  ...DOUBLE_HELPERS,
  ...['toF32', 'fromF32', 'splitDouble', 'affineAxis', 'dDiv', 'dLess', 'dRsqrt', 'dSqrt'],
  ...['chebyshevRoot', 'maxStretchOf', 'composeSphere', 'clearRow', 'composeCorners'],
  ...['lodCentre', 'composeLod', 'deriveRow'],
]

/** Replays a dispatch of the rows pass (`DERIVE_ROWS_WGSL`): every row its list names, or every
 *  row of the table. */
function simulateDeriveRows(bind: ComputeBind) {
  const [rootCount, parts, listed, all] = boundWords(bind, 0)
  const run = shaderRun<{ deriveRow(row: number): void }>(DERIVE_ROWS_WGSL, ROW_FUNCTIONS, {
    countLeadingZeros,
    arrayLength,
    params: { rootCount, parts, listed, all },
    rootWorlds: pairs(boundWords(bind, 1)),
    table: boundWords(bind, 2),
    spheres: floats(bind.entries.find((entry) => entry.binding === 3)!.resource.buffer.data),
    inputs: pairs(boundWords(bind, 4)),
    rootBoxes: pairs(boundWords(bind, 5)),
    corners: boundWords(bind, 6),
    lods: boundWords(bind, 7),
  })
  const list = boundWords(bind, 8)
  for (let j = 0; j < listed; j++) run.deriveRow(all ? j : list[j])
}

/** Replays a dispatch of the compose worlds pass (`COMPOSE_WORLDS_WGSL`): each listed root a parent
 *  composes, its world and its world box. */
function simulateComposeWorlds(bind: ComputeBind) {
  const [rootCount, listed] = boundWords(bind, 0)
  const rootWorlds = pairs(boundWords(bind, 4))
  const run = shaderRun<{
    composed(parentAt: number, localAt: number, k: number): number[]
    composeBox(rank: number, at: number, world: number[][]): void
  }>(
    COMPOSE_WORLDS_WGSL,
    [
      ...DOUBLE_HELPERS.filter((name) => name !== 'dSub'),
      ...['composed', 'affineAxis', 'dLess', 'dIsZero', 'dMin', 'dMax', 'carriedBox'],
      'composeBox',
    ],
    {
      countLeadingZeros,
      locals: pairs(boundWords(bind, 1)),
      parents: pairs(boundWords(bind, 3)),
      rootInputs: pairs(boundWords(bind, 5)),
      rootBoxes: pairs(boundWords(bind, 6)),
    },
  )
  const parentOf = boundWords(bind, 2),
    ranks = boundWords(bind, 7),
    inputs = pairs(boundWords(bind, 5))
  for (let j = 0; j < listed; j++) {
    const rank = ranks[j],
      p = rank < rootCount ? parentOf[rank] : NONE
    if (p === NONE) continue
    const world = Array.from({ length: 16 }, (_, k) => run.composed(p * 16, rank * 16, k))
    world.forEach((value, k) => (rootWorlds[rank * 16 + k] = value))
    if (inputs[rank * 7 + 6][0] !== 0) run.composeBox(rank, rank * 7, world)
  }
}

/** The replay of the kernel `entryPoint` names, when it is the rows pass or the worlds pass. */
export const ROW_STAGES: Record<string, (bind: ComputeBind) => void> = {
  [DERIVE_ROWS_ENTRY]: simulateDeriveRows,
  [COMPOSE_WORLDS_ENTRY]: simulateComposeWorlds,
}
