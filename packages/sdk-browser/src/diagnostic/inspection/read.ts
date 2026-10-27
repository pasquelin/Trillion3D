import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { captureRead } from '../../gpu/core/heldReadback.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { inspectedCamera, type InspectedView } from './camera.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { inspectedClusters, snapshotClusters } from './clusters.ts'
import { inspectedLights } from './lights.ts'
import { vsmMapSettings } from '../../lighting/shadows/vsm/frame/vsmFarShadow.ts'
import {
  type Block,
  decodeReflections,
  encodeReflectionSamples,
  sampleBytes,
  sampleGrid,
} from './reflections.ts'
import { decodeShadowMap, shadowTableRows, snapshotShadowMaps } from './shadows.ts'
import type { FrameInspection } from './types.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'

/** The inspection each runtime awaits, until its image is read. */
const asked = new WeakMap<WebgpuPagesRuntime, Promise<FrameInspection | null>>()

/**
 * What the main view's next image computes, and where (`FrameInspection`): asked here, read right
 * after that image is submitted (`../../frame/render/encoder.ts`, `run.inspect`) and before any view
 * aside overwrites what the views share — the page table. One request
 * serves every caller until it is read; the image is drawn even where the view would have held.
 * `null` for a session lost or closed before it.
 *
 * Cost: none until asked — the frame tests one absent callback. Asked, the CPU copies the cut's
 * lists and places its boxes, and the device copies the page table's rows the
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
const viewOf = (
  cam: InspectedView & { projection: Float64Array } & Pick<EngineCamera, 'fov' | 'aspect'>,
) => ({
  view: cam.view.slice(),
  viewProjection: cam.viewProjection.slice(),
  projection: cam.projection.slice(),
  eye: cam.eye.slice(),
  near: cam.near,
  far: cam.far,
  perspective: cam.perspective,
  fov: cam.fov,
  aspect: cam.aspect,
})

/** The device words of an inspection, copied behind the image at once: the page table's rows,
 *  the reflection samples, in that order. */
type DeviceWords = {
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
  block: Block,
  signal: AbortSignal,
) {
  const { tableBytes } = words,
    total = tableBytes + (grid ? sampleBytes(grid) : 0)
  if (total === 0) return new ArrayBuffer(0)
  let made: ReturnType<typeof encodeReflectionSamples> | undefined
  try {
    return await captureRead(
      device,
      total,
      'Trillion3D frame inspection',
      (encoder, staging) => {
        if (words.table) encoder.copyBufferToBuffer(words.table, 0, staging, 0, tableBytes)
        if (!reflection || !grid) return
        const { grids, trace } = reflection
        made = encodeReflectionSamples(device, encoder, grids, trace.parity, grid, block)
        encoder.copyBufferToBuffer(made.samples, 0, staging, tableBytes, total - tableBytes)
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
  const { run, gpu, lights } = rt,
    device = gpu.device
  if (!device) return null
  const cam = viewOf(run.gate.cam),
    size = [...gpu.targetSize],
    frame = run.frame,
    camera = inspectedCamera(cam),
    cutCamera = run.cullView ? inspectedCamera(run.cullView.camera) : camera
  const clusters = snapshotClusters(rt)
  // A set whose last frame planned no map (`stats.maps`) holds none to show, as no set does.
  const vsm = lights.vsm?.stats.maps ? lights.vsm : undefined,
    maps = vsm
      ? snapshotShadowMaps(vsm.state.cache.entries.values(), (id) => lights.store.light(id)?.kind)
      : []
  const [tableWidth, tableHeight] = vsm?.res.layout.pageTableSize ?? [0, 0]
  // The reflections of a perspective view of the lit image alone: an orthographic one has no eye
  // ray to place them on, and a view of no lit image traces none (`stageReflections`).
  const reflection = cam.perspective === 1 && drawsLit(run.diagnostic) ? gpu.reflection : undefined
  const settings = reflection?.frame.settings
  const block: Block = [settings?.block ?? 1, settings?.blockY ?? 1]
  const grid = reflection && sampleGrid(ceilDiv(size[0], block[0]), ceilDiv(size[1], block[1]))
  const tableBytes = Math.min(shadowTableRows(maps), tableHeight) * tableWidth * 4
  const table = vsm?.res.current.pageTable
  const words = await readWords(device, { table, tableBytes }, reflection, grid, block, rt.signal)
  return {
    frame,
    camera,
    cutCamera,
    frozen: cutCamera !== camera,
    clusters: inspectedClusters(clusters),
    shadows: maps.map((map) =>
      decodeShadowMap(map, new Uint32Array(words, 0, tableBytes / 4), tableWidth),
    ),
    reflections: grid
      ? decodeReflections(
          new Float32Array(words, tableBytes, (words.byteLength - tableBytes) / 4),
          grid.count,
          grid.stride,
          cam,
          size,
          block,
        )
      : null,
    lights: inspectedLights(lights.store, cam, size, vsmMapSettings(rt).shadows),
  }
}
