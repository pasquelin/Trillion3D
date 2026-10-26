// The engine's real cut (`createDagResources`, `encodeDagKernels`) on the device the engine opens
// (`requestExplorerDevice`), once whole and once through that same device reporting a binding that
// holds the largest buffer the cut binds and no more (`cameraCutBuffers`): every table past the
// binding — the frame words, the clusters, the nodes, the cold words, the flags, the worlds, the
// tree — is a record table (`cutTables.ts`), bound once whatever the binding, the stage five
// storage buffers (the readout, `work`, the visible clusters, their records and edges). Only the
// capacity the cut reads changes; the device underneath is the same.
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts'
import { createDagResources } from '../../../packages/sdk-browser/src/geometry/dag/resources.ts'
import { encodeDagKernels } from '../../../packages/sdk-browser/src/geometry/dag/encode.ts'
import {
  writeDagUniforms,
  parseDagOutput,
} from '../../../packages/sdk-browser/src/geometry/dag/uniforms.ts'
import { cameraCutBuffers } from '../../../packages/sdk-browser/src/geometry/dag/bufferTable.ts'
import { dagDeviceRefusal } from '../../../packages/sdk-browser/src/geometry/dag/deviceRefusal.ts'
import { dagBindEntries } from '../../../packages/sdk-browser/src/geometry/dag/shader/bindings.ts'
import { selectionListCap } from '../../../packages/sdk-browser/src/geometry/dag/layout.ts'
import {
  countWord,
  priorityWord,
} from '../../../packages/sdk-browser/src/geometry/dag/readoutWords.ts'
import { DEFAULT_STREAMING_MIN_REQUESTS } from '../../../packages/sdk-core/src/contracts/streamingOptions.ts'
import { cutTablesAt } from '../../../packages/sdk-browser/src/geometry/dag/queueGrowth.ts'
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/geometry/dag/shader/viewsWgsl.ts'
import { residentAll } from '../../../packages/sdk-browser/src/geometry/dag/residentAll.fixture.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'
import { reporting } from '../../kit/device/reportingDevice.ts'
import { sceneView } from './cutScene.ts'
import { writeHostStretches } from '../../../packages/sdk-browser/src/geometry/dag/hostStretches.fixture.ts'

/** Placements of a small pyramid, ten abreast, row behind row: the first half behind the camera,
 *  the second before it, its outer columns past the frustum's sides. */
const PLACEMENTS = 600
const poses = Array.from({ length: PLACEMENTS }, (_, k) =>
  new Matrix4().makeTranslation(
    ((k % 10) - 4.5) * 4,
    0,
    k < PLACEMENTS / 2 ? 60 : -Math.floor((k - PLACEMENTS / 2) / 10) * 6,
  ),
)

/** The cut at each threshold of `pixelErrors`, whole and on the narrow device, what the engine's
 *  device check says of the narrow device, the storage buffers the cut's stage declares and the
 *  narrow device's limit on them. */
export async function cutWholeAndSplit(pixelErrors: number[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device, errors } = gpu
  const { packed, uniforms } = sceneView(2, 2, poses)
  const largest = Math.max(...Object.values(cameraCutBuffers(packed).rows).map((row) => row.size))
  const lying = reporting(device, largest)
  const refusal = dagDeviceRefusal(lying.limits, packed)
  const cut = async (target: GPUDevice) => {
    // The readout keeps the catalogue's cap on both devices: a list sized from the reported
    // binding would truncate the split cut alone (`listCap.ts`).
    const resources = await createDagResources(
      target,
      packed,
      null,
      selectionListCap(packed.pageCount, DEFAULT_STREAMING_MIN_REQUESTS),
    )
    if (!resources) return undefined
    // The stretches the session's root boxes pass writes, as no session runs here.
    writeHostStretches(resources.frames.rows, packed.worldSources)
    // Every page resident: the cut draws every page it wants.
    residentAll(resources)
    const cuts = []
    // The tables as the cut laid them on this device (`cutTablesAt`), as the engine writes them.
    const at = cutTablesAt(resources)
    for (const pixelError of pixelErrors) {
      const block = new Float32Array(DAG_UNIFORM_BYTES / 4)
      writeDagUniforms(block, packed, { ...uniforms, pixelError }, resources.listCap, at)
      device.queue.writeBuffer(resources.uniforms, 0, block)
      const encoder = device.createCommandEncoder()
      encodeDagKernels(encoder, resources)
      device.queue.submit([encoder.finish()])
      const result = parseDagOutput(
        (await readGpuBuffer(device, resources.output, resources.readbackBytes))!.buffer,
        0,
        resources.readbackBytes,
        {
          drawn: resources.outputBytes / 4,
          priorities: priorityWord(resources.listCap),
          counts: countWord(resources.listCap),
        },
      )
      if (!result) throw new Error('unreadable output')
      cuts.push({
        pixelError,
        pageIds: [...result.pageIds].sort((a, b) => a - b),
        frustumRejected: result.frustumRejected,
        selectedTriangles: result.selectedTriangles,
      })
    }
    for (const buffer of resources.buffers) buffer.destroy()
    for (const { texture } of resources.textures) texture.destroy()
    resources.occlusion.dispose()
    return cuts
  }
  const whole = await cut(device)
  const split = refusal ? undefined : await cut(lying)
  const storage = dagBindEntries().filter((entry) => entry.buffer?.type === 'storage').length
  const storageBindings = lying.limits.maxStorageBuffersPerShaderStage
  const info = await gpu.fermer()
  return {
    adapter: info.court,
    storage,
    storageBindings,
    refusal,
    errors,
    whole,
    split,
  }
}
