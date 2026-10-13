// The rows pass, the compose worlds pass and the root boxes pass a fake device replays: the shipped WGSL itself, run in
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
import {
  ROOT_BOXES_ENTRY,
  ROOT_BOXES_WGSL,
} from '../../../packages/sdk-browser/src/placement/rootBoxesWgsl.ts'
import {
  ENTRY_CORNERS_ENTRY,
  ENTRY_CORNERS_WGSL,
} from '../../../packages/sdk-browser/src/webgpu/transparent/entryCornersWgsl.ts'
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

/** The double functions of a program that subtracts none: its text holds no `dSub`. */
const WORLD_HELPERS = DOUBLE_HELPERS.filter((name) => name !== 'dSub')

/** The functions of the rows pass a run names: its own and the library's it reaches. */
const ROW_FUNCTIONS = [
  ...DOUBLE_HELPERS,
  ...['toF32', 'fromF32', 'splitDouble', 'affineAxis', 'dDiv', 'dLess', 'dRsqrt', 'dSqrt'],
  ...[
    'chebyshevRoot',
    'maxStretchOf',
    'composeSphere',
    'clearRow',
    'writeCorners',
    'composeCorners',
  ],
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
 *  composes, its world. */
function simulateComposeWorlds(bind: ComputeBind) {
  const [rootCount, listed] = boundWords(bind, 0)
  const rootWorlds = pairs(boundWords(bind, 4))
  const run = shaderRun<{ composed(parentAt: number, localAt: number, k: number): number[] }>(
    COMPOSE_WORLDS_WGSL,
    [...WORLD_HELPERS, 'composed'],
    {
      countLeadingZeros,
      locals: pairs(boundWords(bind, 1)),
      parents: pairs(boundWords(bind, 3)),
    },
  )
  const parentOf = boundWords(bind, 2),
    ranks = boundWords(bind, 5)
  for (let j = 0; j < listed; j++) {
    const rank = ranks[j],
      p = rank < rootCount ? parentOf[rank] : NONE
    if (p === NONE) continue
    for (let k = 0; k < 16; k++) rootWorlds[rank * 16 + k] = run.composed(p * 16, rank * 16, k)
  }
}

/** Replays a dispatch of the root boxes pass (`ROOT_BOXES_WGSL`) over its range: each listed root,
 *  or every one, its world box and its stretch. */
function simulateRootBoxes(bind: ComputeBind) {
  const entry = bind.entries.find(({ binding }) => binding === 0)!,
    at = ((entry.resource as { offset?: number }).offset ?? 0) / 4
  const [rootCount, first, count, listed, whole] = words(entry.resource.buffer.data).slice(
    at,
    at + 5,
  )
  const run = shaderRun<{ deriveRoot(rank: number, i: number): void }>(
    ROOT_BOXES_WGSL,
    [
      ...DOUBLE_HELPERS,
      ...['affineAxis', 'dLess', 'dMin', 'dMax', 'carriedBox', 'composeBox', 'toF32', 'fromF32'],
      ...['dDiv', 'dRsqrt', 'dSqrt', 'chebyshevRoot', 'maxStretchOf', 'maxStretchBits'],
      'deriveRoot',
    ],
    {
      countLeadingZeros,
      rootWorlds: pairs(boundWords(bind, 1)),
      rootInputs: pairs(boundWords(bind, 2)),
      rootBoxes: pairs(boundWords(bind, 3)),
      frames: boundWords(bind, 4),
    },
  )
  const ranks = boundWords(bind, 5)
  for (let j = 0; j < listed; j++) {
    const rank = whole ? j : ranks[j]
    if (rank >= first && rank < first + count && rank < rootCount)
      run.deriveRoot(rank, rank - first)
  }
}

/** Replays a dispatch of the entries pass (`ENTRY_CORNERS_WGSL`): every entry its list names, or
 *  every entry of the table. */
function simulateEntryCorners(bind: ComputeBind) {
  const [rootCount, listed, all] = boundWords(bind, 0)
  const run = shaderRun<{ deriveEntry(entry: number): void }>(
    ENTRY_CORNERS_WGSL,
    [...WORLD_HELPERS, 'splitDouble', 'affineAxis', 'writeCorners', 'deriveEntry'],
    {
      countLeadingZeros,
      arrayLength,
      params: { rootCount, listed, all },
      rootWorlds: pairs(boundWords(bind, 1)),
      entryInputs: pairs(boundWords(bind, 2)),
      corners: boundWords(bind, 3),
    },
  )
  const list = boundWords(bind, 4)
  for (let j = 0; j < listed; j++) run.deriveEntry(all ? j : list[j])
}

/** The replay of the kernel `entryPoint` names: the rows pass, the worlds pass, the root boxes pass
 *  or the entries'. */
export const ROW_STAGES: Record<string, (bind: ComputeBind) => void> = {
  [DERIVE_ROWS_ENTRY]: simulateDeriveRows,
  [COMPOSE_WORLDS_ENTRY]: simulateComposeWorlds,
  [ROOT_BOXES_ENTRY]: simulateRootBoxes,
  [ENTRY_CORNERS_ENTRY]: simulateEntryCorners,
}
