import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { clipmapExtent } from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { MAX_STREAMING_REQUESTS } from './atlasRequests.ts'
import { STREAM_BLOCK, STREAM_ENTRIES, STREAMING_SHADER } from './streamingWgsl.ts'
import { splitPosition } from './clipmapUniforms.ts'

/**
 * THE GPU'S ASKS OF THE ATLAS, and their return: each frame, when no answer is waiting for more
 * than the ring holds, the passes of `streamingWgsl.ts` run over the placements and the meshes,
 * the request list is copied to a staging buffer of a ring of four, and read when it maps, a few
 * frames later; the host takes the latest answer once (`takeAnswer`) and the older ones are left
 * unread. Nothing waits for it.
 */

/** The bytes of the request list: its count, then two words a request. */
const REQUEST_BYTES = (MAX_STREAMING_REQUESTS * 2 + 1) * 4

/** What a frame's streaming passes read of the view and the settings. */
export interface StreamingInputs {
  /** The camera, centimetres. */
  readonly origin: readonly [number, number, number]
  readonly settings: GlobalDistanceFieldSettings
  readonly assets: number
  readonly objects: number
}

/** The streaming passes' pipelines, buffers and ring. */
export function createStreaming(device: GPUDevice, sceneLayout: GPUBindGroupLayout) {
  const layouts = [
    sceneLayout,
    device.createBindGroupLayout({
      entries: [
        computeUniformEntry(0),
        computeBufferEntry(1, 'storage'),
        computeBufferEntry(2, 'storage'),
      ],
    }),
  ]
  const stages = startedComputeStages(
    device,
    'Trillion3D mesh distance field streaming',
    device.createPipelineLayout({ bindGroupLayouts: layouts }),
    device.createShaderModule({
      label: 'Trillion3D mesh distance field streaming',
      code: STREAMING_SHADER,
    }),
    Object.values(STREAM_ENTRIES),
  )
  const params = device.createBuffer({
    label: 'Trillion3D mesh distance field streaming block',
    size: STREAM_BLOCK.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const requests = device.createBuffer({
    label: 'Trillion3D mesh distance field requests',
    size: REQUEST_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  let wanted: GPUBuffer | undefined
  let group: GPUBindGroup | undefined
  let answer: Uint32Array | undefined
  const ring = createReadbackRing(
    device,
    { label: 'Trillion3D mesh distance field answers', bytes: REQUEST_BYTES, count: 4 },
    (mapped) => {
      answer = new Uint32Array(mapped.slice(0, REQUEST_BYTES))
    },
  )
  const words = new Float32Array(STREAM_BLOCK.words)
  const ints = new Uint32Array(words.buffer)

  /** The block written for a frame: the view and the boxes that decide a mesh's mips. */
  function writeBlock({ origin, settings, assets }: StreamingInputs, capacity: number) {
    const at = STREAM_BLOCK.at
    const clipmaps = settings.globalDistanceFieldClipmaps
    ints[at.forceMips] = settings.meshDistanceFieldForceMips
    ints[at.maxRequests] = MAX_STREAMING_REQUESTS
    ints[at.assets] = assets
    ints[at.capacity] = capacity
    const outer = clipmapExtent(settings, clipmaps - 1)
    const inner = clipmapExtent(settings, Math.max(Math.floor(clipmaps / 2) - 1, 0))
    for (let k = 0; k < 3; k++) {
      const [high, low] = splitPosition(-origin[k])
      words[at.mip1Extent + k] = outer
      words[at.mip2Extent + k] = inner
      words[at.translationHigh + k] = high
      words[at.translationLow + k] = low
    }
    device.queue.writeBuffer(params, 0, words)
  }

  return {
    get ready() {
      return stages.ready
    },
    /** Encodes the passes and the copy of the answer, on `encoder`, over the scene group. */
    encode(encoder: GPUCommandEncoder, scene: GPUBindGroup, inputs: StreamingInputs) {
      if (!stages.ready || inputs.objects === 0 || !ring.available()) return
      const capacity = nextPow2(Math.max(1, inputs.assets))
      if (!wanted || wanted.size < capacity * 4) {
        wanted?.destroy()
        wanted = device.createBuffer({
          label: 'Trillion3D mesh distance field wanted mips',
          size: capacity * 4,
          usage: GPUBufferUsage.STORAGE,
        })
        group = device.createBindGroup({
          layout: layouts[1],
          entries: [params, wanted, requests].map((buffer, binding) => ({
            binding,
            resource: { buffer },
          })),
        })
      }
      writeBlock(inputs, capacity)
      const staging = ring.take()
      if (!staging) return
      const pass = encoder.beginComputePass({ label: 'Trillion3D mesh distance field streaming' })
      pass.setBindGroup(0, scene)
      pass.setBindGroup(1, group)
      const run = (
        entry: (typeof STREAM_ENTRIES)[keyof typeof STREAM_ENTRIES],
        threads: number,
      ) => {
        pass.setPipeline(stages.pipelineOf(entry))
        dispatchRows(pass, ceilDiv(threads, WORKGROUP_THREADS))
      }
      run(STREAM_ENTRIES.clear, capacity)
      run(STREAM_ENTRIES.wanted, inputs.objects)
      run(STREAM_ENTRIES.requests, inputs.assets)
      pass.end()
      encoder.copyBufferToBuffer(requests, 0, staging, 0, REQUEST_BYTES)
    },
    /** After `queue.submit` of the frame's encoder: the copy maps. */
    submitted: () => ring.submitted(),
    /** The latest answer that came back, once. */
    takeAnswer() {
      const taken = answer
      answer = undefined
      return taken
    },
    dispose() {
      ring.destroy()
      wanted?.destroy()
      params.destroy()
      requests.destroy()
    },
  }
}

export type Streaming = ReturnType<typeof createStreaming>
