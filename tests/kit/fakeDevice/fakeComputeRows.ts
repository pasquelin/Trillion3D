// The rows pass, the compose worlds pass, the root boxes pass and the entries pass a fake device
// runs: the shipped WGSL itself, run in JavaScript (`shaderRun`), over the buffers the dispatch
// binds — every word a row's world decides is then the GPU's, as a session on a device writes it.
// Each run names its entry function alone: `shaderRun` reaches every function it calls, so a
// helper the engine renames or drops is never named here.
import { shaderRun } from '../../../packages/sdk-browser/src/materials/texture/shaderRun.fixture.ts'
import {
  DERIVE_ROWS_ENTRY,
  DERIVE_ROWS_WGSL,
  ROW_NAMED,
  ROW_STALES,
} from '../../../packages/sdk-browser/src/placement/rows/rowWordsWgsl.ts'
import {
  COMPOSE_WORLDS_ENTRY,
  COMPOSE_WORLDS_WGSL,
} from '../../../packages/sdk-browser/src/placement/compose/gpuComposeWgsl.ts'
import { NO_INDEX } from '../../../packages/math/src/constants.ts'
import {
  ROOT_BOXES_ENTRY,
  ROOT_BOXES_FRAMES_BINDING,
  ROOT_BOXES_WGSL,
} from '../../../packages/sdk-browser/src/placement/roots/rootBoxesWgsl.ts'
import { viewTexels } from './fakeWorldPose.ts'
import {
  ENTRY_CORNERS_ENTRY,
  ENTRY_CORNERS_WGSL,
} from '../../../packages/sdk-browser/src/blend/transparent/entryCornersWgsl.ts'
import type { ComputeBind } from './fakeCompute.ts'
import { boundFloats, boundResource, boundWords, vectors } from './fakeBuffers.ts'

const arrayLength = (ref: { get(): { length: number } }) => ref.get().length

/** Replays a dispatch of the rows pass (`DERIVE_ROWS_WGSL`): every row its list names, or every
 *  row of the table, each appending its shadow change, a listed row marked staled appending the box
 *  of the sphere it holds first. */
function simulateDeriveRows(bind: ComputeBind) {
  const [rootCount, parts, listed, all] = boundWords(bind.entries, 0)
  const run = shaderRun<{ deriveRow(row: number, stale: boolean): void }>(
    DERIVE_ROWS_WGSL,
    ['deriveRow'],
    {
      arrayLength,
      params: { rootCount, parts, listed, all },
      rootWorlds: vectors(2, boundWords(bind.entries, 1)),
      table: boundWords(bind.entries, 2),
      spheres: boundFloats(bind.entries, 3),
      inputs: vectors(2, boundWords(bind.entries, 4)),
      rootBoxes: vectors(2, boundWords(bind.entries, 5)),
      corners: boundWords(bind.entries, 6),
      lods: boundWords(bind.entries, 7),
      mobility: boundWords(bind.entries, 9),
      castChanges: boundWords(bind.entries, 10),
    },
  )
  const list = boundWords(bind.entries, 8)
  for (let j = 0; j < listed; j++) {
    const named = all ? j : list[j]
    const stale = !all && (named & ROW_STALES) !== 0
    run.deriveRow(named & ROW_NAMED, stale)
  }
}

/** Replays a dispatch of the compose worlds pass (`COMPOSE_WORLDS_WGSL`): each listed root a parent
 *  composes, its world. */
function simulateComposeWorlds(bind: ComputeBind) {
  const [rootCount, listed] = boundWords(bind.entries, 0)
  const rootWorlds = vectors(2, boundWords(bind.entries, 4))
  const run = shaderRun<{ composed(parentAt: number, localAt: number, k: number): number[] }>(
    COMPOSE_WORLDS_WGSL,
    ['composed'],
    {
      locals: vectors(2, boundWords(bind.entries, 1)),
      parents: vectors(2, boundWords(bind.entries, 3)),
    },
  )
  const parentOf = boundWords(bind.entries, 2),
    ranks = boundWords(bind.entries, 5)
  for (let j = 0; j < listed; j++) {
    const rank = ranks[j],
      p = rank < rootCount ? parentOf[rank] : NO_INDEX
    if (p === NO_INDEX) continue
    for (let k = 0; k < 16; k++) rootWorlds[rank * 16 + k] = run.composed(p * 16, rank * 16, k)
  }
}

/** Replays a dispatch of the root boxes pass (`ROOT_BOXES_WGSL`): each listed root, or every one,
 *  its world box and its stretch. */
function simulateRootBoxes(bind: ComputeBind) {
  const [rootCount, listed, whole] = boundWords(bind.entries, 0)
  const run = shaderRun<{ deriveRoot(rank: number): void }>(ROOT_BOXES_WGSL, ['deriveRoot'], {
    rootWorlds: vectors(2, boundWords(bind.entries, 1)),
    rootInputs: vectors(2, boundWords(bind.entries, 2)),
    rootBoxes: vectors(2, boundWords(bind.entries, 3)),
    frames: viewTexels(boundResource(bind.entries, ROOT_BOXES_FRAMES_BINDING)),
  })
  const ranks = boundWords(bind.entries, 4)
  for (let j = 0; j < listed; j++) {
    const rank = whole ? j : ranks[j]
    if (rank < rootCount) run.deriveRoot(rank)
  }
}

/** Replays a dispatch of the entries pass (`ENTRY_CORNERS_WGSL`): every entry its list names, or
 *  every entry of the table. */
function simulateEntryCorners(bind: ComputeBind) {
  const [rootCount, listed, all] = boundWords(bind.entries, 0)
  const run = shaderRun<{ deriveEntry(entry: number): void }>(ENTRY_CORNERS_WGSL, ['deriveEntry'], {
    arrayLength,
    params: { rootCount, listed, all },
    rootWorlds: vectors(2, boundWords(bind.entries, 1)),
    entryInputs: vectors(2, boundWords(bind.entries, 2)),
    corners: boundWords(bind.entries, 3),
  })
  const list = boundWords(bind.entries, 4)
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
