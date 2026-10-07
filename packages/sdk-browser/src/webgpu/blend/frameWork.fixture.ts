// What the frame-work tests share: paged items counting their matrix reads, and the expansion's
// kernels made on a fake device over the plan of a blend scene.
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { createBlendExpand } from './expand.ts'
import { planWords, scratchWords } from './planLayout.ts'
import type { BlendGpuItem, createWebgpuBlendState } from './state.ts'

const ITEMS = 2000

/** Paged single-sided items of one blend mode, each counting the reads of its world matrix: the
 *  key of an item reads it, the frustum verdict does not. */
export function counted() {
  const reads = { matrix: 0 }
  const items = Array.from({ length: ITEMS }, (_, i) => {
    const matrix = new G.Matrix4().makeTranslation(i % 50, 0, Math.floor(i / 50))
    const item = {
      surface: surfaceOf(G.basicSurface({ transparent: true })),
      count: 0,
      paged: true,
      bounds: new Float64Array([i % 50, 0, i / 50, (i % 50) + 1, 1, i / 50 + 1]),
    } as unknown as BlendGpuItem
    Object.defineProperty(item, 'matrix', {
      get: () => (reads.matrix++, matrix),
    })
    return item
  })
  return { items, reads }
}

/** The expansion of `blendState` made on `device`, its outputs stood in by small buffers; the
 *  plan's entry count. */
export async function expandable(
  device: GPUDevice,
  blendState: ReturnType<typeof createWebgpuBlendState>,
) {
  const entries = blendState.maxPlanEntries
  const output = (label: string) =>
    device.createBuffer({ label, size: 16, usage: GPUBufferUsage.STORAGE })
  blendState.expandedBuffer = output('expanded')
  blendState.argsBuffer = output('args')
  blendState.expand = await createBlendExpand(
    device,
    {
      items: ITEMS,
      entries,
      planWords: planWords(entries),
      scratchWords: scratchWords(entries),
    },
    { counts: undefined, clusters: undefined },
    { expanded: blendState.expandedBuffer, args: blendState.argsBuffer },
  )
  return entries
}
