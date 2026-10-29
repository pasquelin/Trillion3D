/**
 * THE GPU SIDE OF THE LIGHT COMPLEXITY VIEW, run inside the sampling's own compute pass (`sampledLights.ts`) where the view asks: the replay of the weighing for the pixel under the cursor
 * (`replayWgsl.ts`, one group), and the cost of sampling every pixel (`costWgsl.ts`, a thread a pixel). Both are compiled when first asked, off the frame, and run when compiled.
 */
import { wgslModule } from '../../../../../../math/src/wgsl/assemble.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { askedComputeStage } from '../../../../gpu/core/computeStages.ts'
import { variantLabel, type ContractKey } from '../../../deferred/contractCuts.ts'
import { DEFERRED_BINDINGS } from '../../../deferred/bindings.ts'
import { createPassGroup } from '../../../deferred/passGroup.ts'
import { SAMPLED_BINDINGS } from '../../bindings.ts'
import { SAMPLED_GROUP } from '../../layout.ts'
import { COMPLEXITY_ENTRY_WORDS, COMPLEXITY_MAX_LIGHTS } from './entries.ts'
import { COST_ENTRY, costWgsl } from './costWgsl.ts'
import { REPLAY_ENTRY, replayWgsl } from './replayWgsl.ts'

const B = SAMPLED_BINDINGS
const D = DEFERRED_BINDINGS

/** The texture format the cost is written in. */
export const COMPLEXITY_COST_FORMAT: GPUTextureFormat = 'r32float'

/** What the replay and the cost read of the image the sampling lit. */
export interface ComplexityImage {
  readonly key: ContractKey
  /** Whether the image is the nearest translucent layer's, and whether the rectangle lights' pictures are read. */
  readonly front: boolean
  readonly textured: boolean
  /** The layout entries the sampling's kernels start with and end with (the pixel's layers, the lights, the light grid, the uniform; the guide, the noise, the vectors, the thin and lobe targets), with
   *  the resources they bind: the names that tell a group from another, and the entries made when one is to be made. */
  readonly layoutEntries: readonly GPUBindGroupLayoutEntry[]
  readonly groupKeys: readonly unknown[]
  readonly groupEntries: () => GPUBindGroupEntry[]
  /** What the cost reads: the words, the depth, the view, the lights, the light grid, the suns' ranks and the uniform. */
  readonly cost: {
    readonly words: GPUTextureView
    readonly depth: GPUTextureView
    readonly view: GPUBuffer
    readonly lights: GPUBuffer
    readonly tiles: GPUBuffer
    readonly sunRanks: GPUBuffer
    readonly params: GPUBuffer
    readonly size: readonly [number, number]
  }
}

/** What the view asks of an image: the pixel to replay and where the result goes, and where the cost goes. */
export interface ComplexityRequest {
  readonly cursor: readonly [number, number]
  readonly result?: GPUBuffer
  readonly cost?: GPUTextureView
  /** Told which part was encoded this image: the replay of the pixel, or the cost of every pixel. */
  readonly encoded: (part: 'replay' | 'cost') => void
}

const costLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(D.words, 'uint', '2d-array'),
  computeTextureEntry(D.depth, 'depth', '2d'),
  computeBufferEntry(D.view, 'uniform'),
  computeBufferEntry(D.lights, 'read-only-storage'),
  computeBufferEntry(D.tiles, 'read-only-storage'),
  computeBufferEntry(D.sunRanks, 'read-only-storage'),
  computeBufferEntry(B.params, 'uniform'),
  computeStorageTextureEntry(B.complexityCost, COMPLEXITY_COST_FORMAT, 'write-only'),
]

/** The replay's and the cost's pipelines and resources of a device, made when the view first asks. */
export function createLightComplexity(device: GPUDevice, failed: (error: unknown) => void) {
  const requestBuffer = device.createBuffer({
    label: 'Trillion3D light complexity request',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const entries = device.createBuffer({
    label: 'Trillion3D light complexity entries',
    size: COMPLEXITY_MAX_LIGHTS * COMPLEXITY_ENTRY_WORDS * 4,
    usage: GPUBufferUsage.STORAGE,
  })
  const costLayout = device.createBindGroupLayout({ entries: costLayoutEntries() })
  const costStage = askedComputeStage(
    device,
    [costLayout],
    costWgsl(),
    COST_ENTRY,
    'Trillion3D light complexity cost',
    failed,
  )
  const costGroup = createPassGroup(device, costLayout)
  let replay:
    | {
        label: string
        layout: GPUBindGroupLayout
        stage: ReturnType<typeof askedComputeStage>
        group: ReturnType<typeof createPassGroup>
      }
    | undefined

  /** The replay's pipeline for the image, made again when the program it is cut for changes. */
  function replayFor(image: ComplexityImage) {
    const label = `${variantLabel(image.key)}${image.front ? '_FRONT' : ''}${image.textured ? '' : '_PLAIN'}`
    if (replay?.label === label) return replay
    replay?.group.release()
    const layout = device.createBindGroupLayout({
      entries: [
        ...image.layoutEntries,
        computeBufferEntry(B.complexityRequest, 'uniform'),
        computeBufferEntry(B.complexityEntries, 'storage'),
        computeBufferEntry(B.complexity, 'storage'),
      ],
    })
    return (replay = {
      label,
      layout,
      stage: askedComputeStage(
        device,
        [layout],
        wgslModule(replayWgsl(image.key, image.front, image.textured)),
        REPLAY_ENTRY,
        `Trillion3D light complexity replay ${label}`,
        failed,
      ),
      group: createPassGroup(device, layout),
    })
  }

  return {
    /** Encodes what `request` asks of `image` into the compute pass `pass`: nothing for a part whose pipeline compiles. */
    encode(pass: GPUComputePassEncoder, image: ComplexityImage, request: ComplexityRequest) {
      const { result, cost } = request
      if (result) {
        const made = replayFor(image)
        const stage = made.stage.get()
        if (stage) {
          device.queue.writeBuffer(requestBuffer, 0, new Uint32Array([...request.cursor, 0, 0]))
          const group = made.group.get([...image.groupKeys, requestBuffer, entries, result], () => [
            ...image.groupEntries(),
            { binding: B.complexityRequest, resource: { buffer: requestBuffer } },
            { binding: B.complexityEntries, resource: { buffer: entries } },
            { binding: B.complexity, resource: { buffer: result } },
          ])
          pass.setPipeline(stage)
          pass.setBindGroup(0, group)
          pass.dispatchWorkgroups(1)
          request.encoded('replay')
        }
      }
      const costPipeline = cost && costStage.get()
      if (cost && costPipeline) {
        const c = image.cost
        const group = costGroup.get(
          [c.words, c.depth, c.view, c.lights, c.tiles, c.sunRanks, c.params, cost],
          () => [
            { binding: D.words, resource: c.words },
            { binding: D.depth, resource: c.depth },
            { binding: D.view, resource: { buffer: c.view } },
            { binding: D.lights, resource: { buffer: c.lights } },
            { binding: D.tiles, resource: { buffer: c.tiles } },
            { binding: D.sunRanks, resource: { buffer: c.sunRanks } },
            { binding: B.params, resource: { buffer: c.params } },
            { binding: B.complexityCost, resource: cost },
          ],
        )
        pass.setPipeline(costPipeline)
        pass.setBindGroup(0, group)
        pass.dispatchWorkgroups(
          Math.ceil(c.size[0] / SAMPLED_GROUP),
          Math.ceil(c.size[1] / SAMPLED_GROUP),
        )
        request.encoded('cost')
      }
    },
    dispose() {
      requestBuffer.destroy()
      entries.destroy()
      replay?.group.release()
      costGroup.release()
    },
  }
}
