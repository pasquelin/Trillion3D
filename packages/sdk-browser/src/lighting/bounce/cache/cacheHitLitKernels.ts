import {
  heldMakerOf,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
} from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskedLayoutEntries } from '../../rays/sceneTrace/sceneMaskWgsl.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { litHostLayoutOf, litListKernels } from '../../reflections/hitLighting/kernels.ts'
import { CACHE_TRACED_SCENE, cacheTracedLayouts } from './cacheBindings.ts'
import {
  cacheLitCompactEntries,
  cacheLitCompactProgram,
  cacheLitDirectEntries,
  cacheLitDirectProgram,
  cacheLitFinishEntries,
  cacheLitFinishProgram,
} from './cacheHitLitWgsl.ts'
import { TRACE_ENTRY, startedTracedKernel } from './cacheKernels.ts'
import { cacheTracedProgramOf } from './cacheTraceWgsl.ts'

const layoutOf = (label: string, entries: () => GPUBindGroupLayoutEntry[]) =>
  litHostLayoutOf('radiance cache', label, entries)
/** The layouts of the passes' group 0, once a device (the second pass's once a device and a format of the cache's light). */
export const cacheLitCompactLayout = layoutOf('compaction', cacheLitCompactEntries)
export const cacheLitDirectLayout = layoutOf('direct', cacheLitDirectEntries)
export const cacheLitFinishLayout = oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) =>
  device.createBindGroupLayout({
    label: 'Trillion3D radiance cache hit lighting finish',
    entries: cacheLitFinishEntries(light),
  }),
)
/** The layout of the scene trace's group in the first pass. */
export const cacheLitSceneLayout = layoutOf('scene', () =>
  sceneMaskedLayoutEntries(CACHE_TRACED_SCENE.first),
)

/** The compaction's stages, compiled once a device: its text depends neither on the maps' light format nor on the graph masks. */
const compactStages = oncePerDevice((device: GPUDevice) =>
  startedComputeStages(
    device,
    'Trillion3D radiance cache hit lighting compaction',
    device.createPipelineLayout({ bindGroupLayouts: [cacheLitCompactLayout(device)] }),
    device.createShaderModule({
      label: 'Trillion3D radiance cache hit lighting compaction',
      code: cacheLitCompactProgram(),
    }),
    ['cacheLitCompact', 'cacheLitReset'],
    groupWidthConstants(groupWidth(device.limits)),
  ),
)

/** The first pass's stages, compiled once a device and a set of graph masks: its text does not depend on the maps' light format. */
const directStages = oncePerDeviceOverPrograms((device: GPUDevice, _: string, programs) =>
  startedComputeStages(
    device,
    `Trillion3D radiance cache hit lighting direct ${sceneMaskKey(programs)}`,
    device.createPipelineLayout({
      bindGroupLayouts: [cacheLitDirectLayout(device), cacheLitSceneLayout(device)],
    }),
    device.createShaderModule({
      label: `Trillion3D radiance cache hit lighting direct ${sceneMaskKey(programs)}`,
      code: cacheLitDirectProgram(programs),
    }),
    ['cacheLitDirect'],
  ),
)

/**
 * THE KERNELS OF THE RADIANCE CACHE'S HIT LIGHTING for the maps' light format `light` over a set of graph masks, compiled together off the frame (`ready`): the trace through the triangles that marks the hits to light, the compaction of the marks (and the emptying of
 * the list before each slice), the list's passes shared with the reflections (the arguments, the unsorted hand-over, the sort by material), the first pass and the second. One consumer of the mask hold, so that the trace that marks and the passes that light always run on the
 * same set of programs.
 */
const kernelsOver = oncePerDeviceOverPrograms(
  (device: GPUDevice, light: LightAtlasFormat, programs) => {
    const label = `Trillion3D radiance cache hit lighting ${light}|${sceneMaskKey(programs)}`
    const traced = startedTracedKernel(
      device,
      `${label} trace`,
      cacheTracedLayouts(light, true).map((entries, at) =>
        device.createBindGroupLayout({ label: `${label} trace group ${at}`, entries }),
      ),
      cacheTracedProgramOf(light, programs, true),
      TRACE_ENTRY,
      true,
    )
    const passes = litListKernels(device, label, {
      compact: compactStages(device),
      direct: directStages(device, 'direct', programs),
      finish: {
        name: 'finish',
        layouts: [cacheLitFinishLayout(device, light)],
        module: device.createShaderModule({
          label: `${label} finish`,
          code: cacheLitFinishProgram(light),
        }),
        entries: ['cacheLitFinish'],
      },
    })
    return {
      traced,
      get ready() {
        return traced.ready && passes.ready
      },
      get pending() {
        return traced.pending || passes.pending
      },
      // Read once `ready`.
      get reset() {
        return passes.compact.pipelineOf('cacheLitReset')
      },
      get compact() {
        return passes.compact.pipelineOf('cacheLitCompact')
      },
      list: passes.list,
      get direct() {
        return passes.direct.pipelineOf('cacheLitDirect')
      },
      get finish() {
        return passes.finish.pipelineOf('cacheLitFinish')
      },
    }
  },
)

/** The maker of those kernels, as the mask hold takes it (`maskHold.use`). */
export const cacheLitMaker = heldMakerOf(kernelsOver)

/** The kernels, made. */
export type CacheLitKernels = ReturnType<typeof kernelsOver>
