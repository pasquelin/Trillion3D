import { captureRead } from '../../gpu/core/heldReadback.ts'
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts'
import { inspectedCamera, type InspectedView } from './camera.ts'
import { inspectedClusters, slotsRead, snapshotClusters } from './clusters.ts'
import { inspectedLights } from './lights.ts'
import {
  decodeReflections,
  encodeReflectionSamples,
  sampleBytes,
  sampleGrid,
} from './reflections.ts'
import { decodeShadowMap, shadowTableRows, snapshotShadowMaps } from './shadows.ts'
import type { FrameInspection } from './types.ts'

/** The inspection each runtime awaits, until its image is read. */
const asked = new WeakMap<WebgpuPagesRuntime, Promise<FrameInspection | null>>()

/**
 * What the main view's next image computes, and where (`FrameInspection`): asked here, read right
 * after that image is submitted (`../../webgpu/pages/render/encoder.ts`, `run.inspect`) and before any view
 * aside overwrites what the views share — the occlusion verdicts, the page table. One request
 * serves every caller until it is read; the image is drawn even where the view would have held.
 * `null` for a session lost or closed before it.
 *
 * Cost: none until asked — the frame tests one absent callback. Asked, the CPU copies the cut's
 * lists and places its boxes, and the device copies the verdict words, the page table's rows the
 * maps hold and one reflection texel in `stride`², all at once through the capture ring
 * (`captureRead`), mapped a frame or so later; the frame never waits for it.
 */
export function inspectFrame(rt: WebgpuPagesRuntime): Promise<FrameInspection | null> {
  if (rt.run.lost || !rt.gpu.device || rt.signal.aborted) return Promise.resolve(null)
  let promise = asked.get(rt)
  if (promise) return promise
  promise = new Promise((resolve, reject) => {
    const closed = () => resolve(null)
    rt.signal.addEventListener('abort', closed, { once: true })
    rt.run.inspect = () => {
      rt.run.inspect = undefined
      asked.delete(rt)
      rt.signal.removeEventListener('abort', closed)
      readInspection(rt).then(resolve, reject)
    }
  })
  asked.set(rt, promise)
  // Origin of the resource change: an image is owed to the inspection, held view or not.
  rt.run.gate.resourcesChanged()
  return promise
}

/** `cam`'s numbers, copied: the next image rewrites the engine camera in place. */
const viewOf = (cam: InspectedView & { projection: Float64Array }) => ({
  view: cam.view.slice(),
  viewProjection: cam.viewProjection.slice(),
  projection: cam.projection.slice(),
  eye: cam.eye.slice(),
  near: cam.near,
  far: cam.far,
  perspective: cam.perspective,
})

/** The device words of an inspection, copied behind the image at once: the verdicts, the page
 *  table's rows, the reflection samples, in that order. */
type DeviceWords = {
  flags?: GPUBuffer
  verdictBytes: number
  table?: GPUBuffer
  tableBytes: number
}

/** Copies `words` and, given `grid`, the samples of `reflection` behind them; resolves with
 *  them. */
async function readWords(
  device: GPUDevice,
  words: DeviceWords,
  reflection: NonNullable<WebgpuPagesRuntime['gpu']['reflection']> | undefined,
  grid: ReturnType<typeof sampleGrid> | undefined,
  signal: AbortSignal,
) {
  const { verdictBytes, tableBytes } = words,
    samplesAt = verdictBytes + tableBytes,
    total = samplesAt + (grid ? sampleBytes(grid) : 0)
  if (total === 0) return new ArrayBuffer(0)
  let made: ReturnType<typeof encodeReflectionSamples> | undefined
  try {
    return await captureRead(
      device,
      total,
      'Trillion3D frame inspection',
      (encoder, staging) => {
        if (words.flags) encoder.copyBufferToBuffer(words.flags, 0, staging, 0, verdictBytes)
        if (words.table)
          encoder.copyBufferToBuffer(words.table, 0, staging, verdictBytes, tableBytes)
        if (!reflection || !grid) return
        const { grids, trace } = reflection
        made = encodeReflectionSamples(device, encoder, grids, trace.parity, grid)
        encoder.copyBufferToBuffer(made.samples, 0, staging, samplesAt, total - samplesAt)
      },
      (mapped) => mapped.slice(0, total),
      signal,
    )
  } finally {
    made?.destroy()
  }
}

/** The main view's image just submitted, read: its CPU state taken now, its device words copied
 *  behind it. */
async function readInspection(rt: WebgpuPagesRuntime): Promise<FrameInspection | null> {
  const { run, gpu, lights, vis } = rt,
    device = gpu.device
  if (!device) return null
  const cam = viewOf(run.gate.cam),
    size = [...gpu.targetSize],
    frame = run.frame,
    camera = inspectedCamera(cam),
    cutCamera = run.cullView ? inspectedCamera(run.cullView.camera) : camera
  const clusters = snapshotClusters(rt),
    flags = vis.gpuHiz?.flags
  const vsm = lights.vsm,
    maps = vsm
      ? snapshotShadowMaps(vsm.state.cache.entries.values(), (id) => lights.store.light(id)?.kind)
      : []
  const [tableWidth, tableHeight] = vsm?.res.layout.pageTableSize ?? [0, 0]
  // The reflections of a perspective view alone: an orthographic one has no eye ray to place them
  // on.
  const reflection = cam.perspective === 1 ? gpu.reflection : undefined
  const rays = reflection?.grids.textures.at(-1)
  const grid = rays && sampleGrid(rays.width, rays.height)
  const verdictBytes = flags ? Math.min(slotsRead(clusters) * 4, flags.size) : 0,
    tableBytes = Math.min(shadowTableRows(maps), tableHeight) * tableWidth * 4
  const table = vsm?.res.current.pageTable
  const words = await readWords(
    device,
    { flags, verdictBytes, table, tableBytes },
    reflection,
    grid,
    rt.signal,
  )
  const samplesAt = verdictBytes + tableBytes
  return {
    frame,
    camera,
    cutCamera,
    frozen: cutCamera !== camera,
    clusters: inspectedClusters(clusters, new Uint32Array(words, 0, verdictBytes / 4)),
    shadows: maps.map((map) =>
      decodeShadowMap(map, new Uint32Array(words, verdictBytes, tableBytes / 4), tableWidth),
    ),
    reflections: grid
      ? decodeReflections(
          new Float32Array(words, samplesAt, (words.byteLength - samplesAt) / 4),
          grid.count,
          grid.stride,
          cam,
          size,
        )
      : null,
    lights: inspectedLights(lights.store, cam, size),
  }
}
