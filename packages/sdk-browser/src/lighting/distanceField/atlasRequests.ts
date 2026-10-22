import { DISTANCE_FIELD_MIPS } from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import {
  brickBytes,
  mipOf,
  type AssetMip,
  type AtlasBudget,
  type AtlasState,
  type ReadRequest,
} from './atlasState.ts'

/**
 * ONE FRAME OF THE ATLAS'S STREAMING: the meshes no placement uses freed, the GPU's answer read —
 * the mips each mesh wants —, the mips that fit asked for, the ones asked for a frame ago loaded,
 * and the room of every mip added taken.
 */

/** The requests the GPU's answer holds at most. */
export const MAX_STREAMING_REQUESTS = 4095

/** What a step decided. */
export interface AtlasStep {
  /** The asset records to write again (their asset, the reversed mip), each once. */
  readonly records: AssetMip[]
  /** The mips added this frame, in the order they took room: their tables and bricks go up. */
  readonly added: AssetMip[]
}

/** Frees the assets no placement uses, clearing their records. */
function processRemoves(state: AtlasState, records: AssetMip[]) {
  for (const id of state.removed) {
    const asset = state.assets[id]
    if (!asset || asset.refCount > 0) continue
    state.drop(id)
    state.added.delete(id)
    records.push({ asset: id, reversed: 0 })
  }
  state.removed.clear()
}

/** Whether a read of `asset` is in flight. */
const outstanding = (state: AtlasState, asset: number) =>
  state.requests.some((request) => request.asset === asset)

/**
 * The GPU's answer — the count, then an asset and the mips it wants for each — read: a mesh that
 * wants fewer mips drops its finest, one that wants more asks for the next, while the atlas holds
 * fewer bricks than its depth allows. In two passes: the second mip of every mesh is asked for
 * before any third.
 */
function processAnswer(
  state: AtlasState,
  budget: AtlasBudget,
  answer: Uint32Array,
  records: AssetMip[],
  fresh: ReadRequest[],
) {
  const room = Math.max((budget.maxDepth - 1) * budget.sizeXY * budget.sizeXY, 0)
  let bricks =
    state.blocks.used * budget.blockBricks +
    state.requests.reduce((sum, r) => sum + mipOf(r.field, r.reversed).brickCount, 0)
  const count = Math.min(answer[0], MAX_STREAMING_REQUESTS)
  for (const first of [true, false]) {
    for (let k = 0; k < count; k++) {
      const id = answer[1 + 2 * k]
      const asset = state.assets[id]
      if (!asset) continue
      const wanted = answer[2 + 2 * k]
      asset.wanted = wanted
      if (wanted < asset.mips.length && first) {
        state.freeMip(asset.mips.pop()!)
        records.push({ asset: id, reversed: 0 })
      } else if (wanted > asset.mips.length) {
        const reversed = asset.mips.length
        const pass =
          (first && reversed < DISTANCE_FIELD_MIPS - 1) ||
          (!first && reversed === DISTANCE_FIELD_MIPS - 1)
        if (bricks <= room && pass && !outstanding(state, id)) {
          fresh.push({ asset: id, reversed, field: asset.field })
          bricks += mipOf(asset.field, reversed).brickCount
        }
      }
    }
  }
}

/**
 * The mips to add this frame: the coarsest mip of each mesh made, and the requests of the frame
 * before, until the frame's bytes are spent (a mip that starts below the limit is whole).
 */
function processReady(state: AtlasState, budget: AtlasBudget, records: AssetMip[]) {
  const adds: AssetMip[] = []
  let bytes = 0
  for (const id of state.added) {
    adds.push({ asset: id, reversed: 0 })
    bytes += brickBytes(mipOf(state.assets[id]!.field, 0))
  }
  state.added.clear()
  const { requests } = state
  for (let k = 0; k < requests.length; k++) {
    const request = requests[k]
    requests[k] = requests[requests.length - 1]
    requests.pop()
    k--
    const asset = state.assets[request.asset]
    if (asset && asset.field === request.field && request.reversed === asset.mips.length) {
      bytes += brickBytes(mipOf(asset.field, request.reversed))
      adds.push({ asset: request.asset, reversed: request.reversed })
      records.push({ asset: request.asset, reversed: 0 })
    }
    if (bytes >= budget.uploadBytes) break
  }
  records.push(...adds)
  return adds
}

/** The records of an asset's mips written once each. */
function once(records: readonly AssetMip[]) {
  const seen = new Set<number>()
  return records.filter(({ asset, reversed }) => {
    const key = asset * DISTANCE_FIELD_MIPS + reversed
    return !seen.has(key) && seen.add(key)
  })
}

/**
 * One frame: frees, reads the GPU's `answer` of the frame before (none: nothing asked), loads the
 * mips ready, allocates what they take. The caller writes the records and uploads the mips added.
 */
export function stepAtlas(
  state: AtlasState,
  budget: AtlasBudget,
  answer: Uint32Array | undefined,
): AtlasStep {
  const records: AssetMip[] = []
  processRemoves(state, records)
  const fresh: ReadRequest[] = []
  if (answer) processAnswer(state, budget, answer, records, fresh)
  const adds = processReady(state, budget, records)
  const order = budget.reverseOrder ? adds.slice().reverse() : adds
  for (const add of order) state.allocate(add, budget.blockBricks)
  state.requests.push(...fresh)
  return { records: once(records), added: order }
}
