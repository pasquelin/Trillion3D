// Page of the eviction-rank proof: the engine's real GPU cut (`createGpuDagSelection`) on Dawn,
// every page resident and in the pool, cut frame after frame at generated poses and clocks — the
// stamps of what it draws and asks for, their raise up the groups and `dagListEvictions`, all on
// the GPU — beside the CPU oracle of the same rules (`evict.fixture.ts`) fed the same readbacks.
import { createGpuDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import {
  ageStep,
  listEvictions,
  pageKeys,
  raiseGroups,
} from '../../../packages/sdk-browser/src/gpu/dag/evict.fixture.ts'
import {
  EVICT_IN_USE,
  EVICT_LEVELS,
  KEY_PAGE_BITS,
} from '../../../packages/sdk-browser/src/gpu/dag/evict.ts'
import { EVICTION_BURST } from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'
import { pageResidency } from '../../../packages/sdk-browser/src/gpu/dag/readiness.fixture.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { evictionWorld } from './evictionWorld.ts'

/** One generated frame: the GPU's queue and old head, the oracle's, and what the cut read. */
type RankFrame = {
  frame: number
  gpu: number[]
  oracle: number[]
  gpuOld: number
  oracleOld: number
  /** Each GPU entry's rank by the oracle's rules, in the GPU's order. */
  ranks: number[]
  read: number
  truncated: boolean
}

export async function runEvictionRank(frames = 48, seed = 0x5eed) {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: 'no WebGPU adapter' }
  const world = evictionWorld(6)
  const { packed } = world
  const selection = await createGpuDagSelection(gpu.device, packed)
  if (!selection) return { error: 'GPU_SELECTION_UNAVAILABLE', errors: gpu.errors }
  selection.updateResidency(pageResidency(new Uint8Array(packed.pageCount).fill(1)))
  for (let page = 0; page < packed.pageCount; page++) selection.notePool(page, true)
  const keys = pageKeys(packed),
    lastUse = new Uint32Array(packed.groupCount),
    pool = Array.from({ length: packed.keyCount }, (_, key) => key)
  const keyOfPage = new Map(
    pool.map((key) => [keys.keyWords[key] & ((1 << KEY_PAGE_BITS) - 1), key]),
  )
  const rankOf = (page: number, now: number) => {
    const key = keyOfPage.get(page)!,
      age = now - lastUse[keys.groups.keyGroups[key]]
    return ageStep(age) * EVICT_LEVELS + (EVICT_LEVELS - 1 - (keys.keyWords[key] >>> KEY_PAGE_BITS))
  }
  const next = lcgRandom(seed),
    readings: RankFrame[] = []
  let frame = 10
  try {
    for (let i = 0; i < frames; i++) {
      // Clocks that jump by one to four frames, poses anywhere down the row.
      frame += 1 + Math.floor(next() * 4)
      const uniforms = world.view(next() * 5 * world.spacing, selection)
      selection.dispatch({ ...uniforms, frame })
      const result = await selection.flush()
      if (!result?.evictPageIds) throw new Error('GPU_SELECTION_FAILED')
      const read = [...result.pageIds, ...(result.drawablePageIds ?? [])]
      raiseGroups(lastUse, keys.groups, read.map(keys.groupOf), frame)
      const expected = listEvictions({
        pool,
        keyWords: keys.keyWords,
        useOf: (key) => lastUse[keys.groups.keyGroups[key]],
        now: frame,
        cap: EVICTION_BURST,
      })
      const queue = [...result.evictPageIds]
      readings.push({
        frame,
        gpu: queue,
        oracle: expected.queue,
        gpuOld: result.evictOld ?? 0,
        oracleOld: expected.old,
        ranks: queue.map((page) => rankOf(page, frame)),
        read: read.length,
        truncated: !!result.truncated,
      })
    }
  } catch (error) {
    return { error: String(error), frames: readings, errors: gpu.errors }
  } finally {
    selection.dispose()
  }
  const { court: adapter } = await gpu.fermer()
  return { adapter, frames: readings, inUse: EVICT_IN_USE, errors: gpu.errors }
}
