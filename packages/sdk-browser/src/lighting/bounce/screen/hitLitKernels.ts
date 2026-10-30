import {
  heldMakerOf,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
} from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { litHostLayoutOf, litListKernels } from '../../reflections/hitLighting/kernels.ts'
import { reflectionSceneLayout } from '../../reflections/reflectionPipelines.ts'
import {
  probeLitCompactEntries,
  probeLitCompactProgram,
  probeLitDirectEntries,
  probeLitDirectProgram,
  probeLitFinishEntries,
  probeLitFinishProgram,
} from './hitLitWgsl.ts'
import { tracedSceneKernel, type KernelShape } from './kernels.ts'
import { traceTracedSceneEntries } from './traceTracedWgsl.ts'

/** What the programs of the hit lighting of the screen probes depend on: the rays a side of a probe, the samples of a tile, the fog laid over the rays and the format of the cache's light. */
export type ProbeLitShape = Pick<KernelShape, 'side' | 'samples' | 'heightFog' | 'light'>

/** The key of a shape, and the shape of a key (`oncePerDeviceOverPrograms` keys by a string). */
export const probeLitKey = (s: ProbeLitShape) =>
  `${s.side}|${s.samples.join('x')}|${s.heightFog}|${s.light}`
const shapeOfKey = (key: string): ProbeLitShape => {
  const [side, samples, fog, light] = key.split('|') as [string, string, string, LightAtlasFormat]
  const [x, y] = samples.split('x').map(Number) as [number, number]
  return { side: Number(side), samples: [x, y], heightFog: fog === 'true', light }
}

const layoutOf = (label: string, entries: () => GPUBindGroupLayoutEntry[]) =>
  litHostLayoutOf('screen probe', label, entries)
/** The layouts of the passes' group 0, once a device. */
export const probeLitCompactLayout = layoutOf('compaction', probeLitCompactEntries)
export const probeLitDirectLayout = layoutOf('direct', probeLitDirectEntries)
/** The second pass's, once a device for the fog and the format of the cache's light. */
export const probeLitFinishLayout = oncePerDeviceKey((device: GPUDevice, key: string) => {
  const [fog, light] = key.split('|') as [string, LightAtlasFormat]
  return device.createBindGroupLayout({
    label: 'Trillion3D screen probe hit lighting finish',
    entries: probeLitFinishEntries(fog === 'true', light),
  })
})
export const probeLitFinishKey = (s: Pick<ProbeLitShape, 'heightFog' | 'light'>) =>
  `${s.heightFog}|${s.light}`
/** The layout of the scene trace's group in the first pass. */
export const probeLitSceneLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D screen probe hit lighting scene',
    entries: traceTracedSceneEntries(),
  }),
)

/**
 * THE KERNELS OF THE SCREEN PROBES' HIT LIGHTING for one shape over a set of graph masks, compiled together off the frame (`ready`): the stage that casts the rays through the triangles and marks the hits to light
 * (`tracedSceneKernel`'s `hitLit`), the compaction of the marks, the list's passes shared with the reflections (the arguments, the unsorted hand-over, the sort by material), the first pass and the second.
 * One consumer of the mask hold, so that the stage that marks and the passes that light always run on the same set of programs.
 */
const kernelsOver = oncePerDeviceOverPrograms((device: GPUDevice, key: string, programs) => {
  const shape = shapeOfKey(key)
  const label = `Trillion3D screen probe hit lighting ${key}|${sceneMaskKey(programs)}`
  const traced = tracedSceneKernel(device, shape, programs, true)
  const passes = litListKernels(device, label, {
    compact: {
      name: 'compaction',
      layouts: [probeLitCompactLayout(device)],
      module: device.createShaderModule({
        label: `${label} compaction`,
        code: probeLitCompactProgram(shape.side, shape.samples),
      }),
      entries: ['spLitCompact'],
      constants: groupWidthConstants(groupWidth(device.limits)),
    },
    direct: {
      name: 'direct',
      layouts: [
        probeLitDirectLayout(device),
        reflectionSceneLayout(device),
        probeLitSceneLayout(device),
      ],
      module: device.createShaderModule({
        label: `${label} direct`,
        code: probeLitDirectProgram(shape.side, shape.samples, programs),
      }),
      entries: ['spLitDirect'],
    },
    finish: {
      name: 'finish',
      layouts: [
        probeLitFinishLayout(device, probeLitFinishKey(shape)),
        reflectionSceneLayout(device),
      ],
      module: device.createShaderModule({
        label: `${label} finish`,
        code: probeLitFinishProgram(shape.side, shape.samples, shape.heightFog, shape.light),
      }),
      entries: ['spLitFinish'],
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
    get compact() {
      return passes.compact.pipelineOf('spLitCompact')
    },
    list: passes.list,
    get direct() {
      return passes.direct.pipelineOf('spLitDirect')
    },
    get finish() {
      return passes.finish.pipelineOf('spLitFinish')
    },
  }
})

/** The maker of those kernels, as the mask hold takes it (`maskHold.use`). */
export const probeLitMaker = heldMakerOf(kernelsOver)

/** The kernels, made. */
export type ProbeLitKernels = ReturnType<typeof kernelsOver>
