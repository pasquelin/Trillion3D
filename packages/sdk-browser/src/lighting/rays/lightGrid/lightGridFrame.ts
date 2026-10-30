import { viewKey } from '../../../frame/backend/state/viewKey.ts'
import type { LightGridSettings } from '../../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { keptOrMade } from '../../../gpu/core/keptOrMade.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { gpuAllocator } from '../../../gpu/core/resourceAllocator.ts'
import {
  LIGHT_GRID_HEADER as H,
  LIGHT_GRID_HEADER_WORDS,
  LIGHT_GRID_WIDTH,
  planLightGrid,
  type LightGridPlan,
} from './lightGridLayout.ts'
import {
  LIGHT_GRID_RECORD_WORDS,
  createLightGridLights,
  gatherLightGridLights,
  type LightGridTable,
} from './lightGridLights.ts'
import {
  LIGHT_GRID_BUILD_BINDINGS as B,
  LIGHT_GRID_ENTRY,
  LIGHT_GRID_GROUP,
  LIGHT_GRID_PARAM_WORDS,
  lightGridBuildProgram,
} from './lightGridWgsl.ts'

/** The usage of the grid's texture: written by the builder, read by the lookups, its header written by the host. */
const usage = () => GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST

/** The builder, once a device: its layout and its pipeline (compiled off the frame). */
const builderOf = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D light grid build',
    entries: [
      computeUniformEntry(B.params),
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeStorageTextureEntry(B.grid, 'r32uint', 'write-only'),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D light grid build',
    code: lightGridBuildProgram(),
  })
  const stages = startedComputeStages(
    device,
    'Trillion3D light grid build',
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module,
    [LIGHT_GRID_ENTRY],
  )
  return { layout, stages }
})

/** The texture a lookup reads where the grid is not kept: a header that says every light is looped over. */
const looseOf = oncePerDevice((device: GPUDevice) => {
  const texture = device.createTexture({
    label: 'Trillion3D light grid loose',
    size: [LIGHT_GRID_WIDTH, 1],
    format: 'r32uint',
    usage: usage(),
  })
  const header = new Uint32Array(LIGHT_GRID_HEADER_WORDS)
  header[H.all] = 1
  device.queue.writeTexture({ texture }, header, {}, [LIGHT_GRID_HEADER_WORDS, 1])
  return texture.createView()
})

/** The grid's texture: `rows` rows of the grid's width. */
interface GridTexture {
  readonly rows: number
  readonly texture: GPUTexture
  readonly view: GPUTextureView
  readonly bytes: number
  dispose(): void
}

function makeTexture(device: GPUDevice, rows: number): GridTexture {
  const a = gpuAllocator(device, 'Trillion3D light grid')
  const texture = a.image('grid', [LIGHT_GRID_WIDTH, rows], 'r32uint', { usage: usage() })
  return {
    rows,
    texture,
    view: texture.createView(),
    bytes: a.bytes(),
    dispose: () => retire(device, a),
  }
}

/** Whether the plans are the same grid. */
const samePlan = (a: LightGridPlan | undefined, b: LightGridPlan) =>
  !!a &&
  a.resolution === b.resolution &&
  a.maxCount === b.maxCount &&
  a.axis === b.axis &&
  a.bytes === b.bytes &&
  a.stride === b.stride &&
  a.suns === b.suns &&
  a.all === b.all

/**
 * THE LIGHT GRID OF A VIEW (`lightGridHolder`): the lights of the image as the grid reads them, the texture that holds the grid (header, suns, counts, lists; `lightGridLayout.ts`), the builder's inputs and what the last image
 * was built from. `prepare` gathers the lights and, when they or the settings changed since the grid was built, writes the header and asks the builder for a new grid; `encode` runs the builder in an open compute pass. Every hit lighting of the view calls `prepare` for the image (the work is done once an image: a later call of the same image answers the same texture) and `encode` before its hits are lit. The holder is the view's (`lightGridOf`), kept across resizes.
 * The grid stays as built while the lights stay as they are. Where it is not kept (a device limit, a budget or a builder still compiling refused it) the texture is a header that says every light is looped over.
 */
function createLightGridHolder(device: GPUDevice) {
  const lights = createLightGridLights()
  // What the grid was built from: the lights' records and the suns' ranks, copied.
  let keptRecords = new Float32Array(LIGHT_GRID_RECORD_WORDS)
  let keptSuns = new Uint32Array(1)
  let keptFinite = -1
  let keptLights = -1
  let keptSunCount = -1
  let plan: LightGridPlan | undefined
  let grid: GridTexture | undefined
  let small = 0
  let header = new Uint32Array(LIGHT_GRID_HEADER_WORDS + 16)
  let headerFloats = new Float32Array(header.buffer)
  // The image the last `prepare` was for, and the texture it answered with.
  let preparedImage = -1
  let prepared: GPUTextureView | undefined
  let recordsBuffer: GPUBuffer | undefined
  const params = device.createBuffer({
    label: 'Trillion3D light grid parameters',
    size: LIGHT_GRID_PARAM_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const paramWords = new Uint32Array(LIGHT_GRID_PARAM_WORDS)
  const paramFloats = new Float32Array(paramWords.buffer)
  let group: GPUBindGroup | undefined
  let groupOver: { texture?: GPUTexture; records?: GPUBuffer } = {}
  let pending = false

  /** Whether the gathered lights are those the grid was built from; keeps them if not. */
  function unchanged() {
    const n = lights.finite * LIGHT_GRID_RECORD_WORDS
    let same =
      keptFinite === lights.finite &&
      keptLights === lights.lights &&
      keptSuns.length > lights.suns - 1 &&
      keptRecords.length >= n
    for (let i = 0; same && i < n; i++) same = keptRecords[i] === lights.records[i]
    for (let i = 0; same && i < lights.suns; i++) same = keptSuns[i] === lights.sunRanks[i]
    if (same && keptSunCount === lights.suns) return true
    if (keptRecords.length < n) keptRecords = new Float32Array(Math.max(n, keptRecords.length * 2))
    if (keptSuns.length < lights.suns)
      keptSuns = new Uint32Array(Math.max(lights.suns, keptSuns.length * 2))
    keptRecords.set(lights.records.subarray(0, n))
    keptSuns.set(lights.sunRanks.subarray(0, lights.suns))
    keptFinite = lights.finite
    keptLights = lights.lights
    keptSunCount = lights.suns
    return false
  }

  function writeHeader(p: LightGridPlan) {
    const words = LIGHT_GRID_HEADER_WORDS + p.suns
    if (header.length < words) {
      header = new Uint32Array(words * 2)
      headerFloats = new Float32Array(header.buffer)
    }
    header.fill(0, 0, LIGHT_GRID_HEADER_WORDS)
    // No local light: bounds that contain no point, so that the lookup finds the suns alone.
    for (let a = 0; a < 3; a++) {
      headerFloats[H.boundMin + a] = p.resolution > 0 ? lights.boundMin[a]! : Infinity
      headerFloats[H.boundMax + a] = p.resolution > 0 ? lights.boundMax[a]! : -Infinity
    }
    header[H.resolution] = p.resolution
    header[H.axis] = p.axis
    header[H.suns] = p.suns
    header[H.countsAt] = p.countsAt
    header[H.dataAt] = p.dataAt
    header[H.bytes] = p.bytes
    header[H.stride] = p.stride
    for (let i = 0; i < p.suns; i++) header[LIGHT_GRID_HEADER_WORDS + i] = lights.sunRanks[i]!
    device.queue.writeTexture({ texture: grid!.texture }, header, {}, [words, 1])
  }

  function writeBuild(p: LightGridPlan) {
    const need = Math.max(lights.finite, 1) * LIGHT_GRID_RECORD_WORDS * 4
    if (!recordsBuffer || recordsBuffer.size < need) {
      if (recordsBuffer) retire(device, recordsBuffer)
      recordsBuffer = device.createBuffer({
        label: 'Trillion3D light grid lights',
        size: need * 2,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
    }
    device.queue.writeBuffer(
      recordsBuffer,
      0,
      lights.records,
      0,
      lights.finite * LIGHT_GRID_RECORD_WORDS,
    )
    paramFloats.set(lights.boundMin, 0)
    paramFloats.set(lights.boundMax, 4)
    paramWords[8] = p.resolution
    paramWords[9] = p.maxCount
    paramWords[10] = p.axis
    paramWords[11] = lights.finite
    paramWords[12] = p.countsAt
    paramWords[13] = p.dataAt
    paramWords[14] = p.bytes
    paramWords[15] = p.stride
    device.queue.writeBuffer(params, 0, paramWords)
    if (groupOver.texture !== grid!.texture || groupOver.records !== recordsBuffer) {
      group = device.createBindGroup({
        layout: builderOf(device).layout,
        entries: [
          { binding: B.params, resource: { buffer: params } },
          { binding: B.lights, resource: { buffer: recordsBuffer } },
          { binding: B.grid, resource: grid!.view },
        ],
      })
      groupOver = { texture: grid!.texture, records: recordsBuffer }
    }
  }

  /** The grid for the lights of `table` under `settings` (`prepare`, for one image). */
  function prepareImage(table: LightGridTable, settings: LightGridSettings): GPUTextureView {
    gatherLightGridLights(table, lights)
    const wanted = planLightGrid(
      lights.finite,
      lights.suns,
      lights.lights,
      settings,
      device.limits.maxTextureDimension2D,
    )
    const { stages } = builderOf(device)
    // A grid whose builder is still compiling is not built yet: every light is looped over meanwhile.
    if (wanted.all || (wanted.resolution > 0 && !stages.ready)) {
      plan = undefined
      keptFinite = -1
      pending = false
      return looseOf(device)
    }
    const made = keptOrMade(
      device,
      grid,
      {
        holds: !!grid && grid.rows >= wanted.rows,
        small,
        asked: wanted.rows * LIGHT_GRID_WIDTH,
        texels: (grid?.rows ?? 0) * LIGHT_GRID_WIDTH,
        keepOnRefusal: !!grid && grid.rows >= wanted.rows,
      },
      {
        asked: wanted.rows * LIGHT_GRID_WIDTH * 4,
        what: 'the light grid',
        make: () => makeTexture(device, wanted.rows),
      },
    )
    small = made.small
    const remade = made.held !== grid
    grid = made.held
    if (!made.atlas) {
      plan = undefined
      keptFinite = -1
      pending = false
      return looseOf(device)
    }
    const lightsSame = unchanged()
    if (remade || !lightsSame || !samePlan(plan, wanted)) {
      plan = wanted
      writeHeader(wanted)
      if (wanted.resolution > 0) {
        writeBuild(wanted)
        pending = true
      }
    }
    return made.atlas.view
  }

  return {
    /**
     * The grid for the lights of `table` under `settings`, as a texture view for the lookups: gathered, and built (by `encode`) where the lights or the settings are not those of the last build. Every host of the view calls it for the image `image`; the first call does the work, a later one of the same image returns the same texture.
     */
    prepare(table: LightGridTable, settings: LightGridSettings, image: number): GPUTextureView {
      if (image !== preparedImage || !prepared) {
        prepared = prepareImage(table, settings)
        preparedImage = image
      }
      return prepared
    },
    /** The grid's build, in the open compute pass `pass`, where `prepare` asked for one: once an image. */
    encode(pass: GPUComputePassEncoder) {
      if (!pending || !plan || !group) return
      pending = false
      pass.setPipeline(builderOf(device).stages.pipelineOf(LIGHT_GRID_ENTRY))
      pass.setBindGroup(0, group)
      const side = ceilDiv(plan.resolution, LIGHT_GRID_GROUP)
      pass.dispatchWorkgroups(side, side, 3)
    },
    dispose() {
      grid?.dispose()
      grid = undefined
      prepared = undefined
      preparedImage = -1
      if (recordsBuffer) retire(device, recordsBuffer)
      recordsBuffer = undefined
      retire(device, params)
    },
  }
}
export type LightGridHolder = ReturnType<typeof createLightGridHolder>

/** The light grid each view keeps (found by the view's key), so that it outlives the view's resizes. */
const holders = new WeakMap<object, LightGridHolder>()

/** The view's light grid, made at the first ask; every hit lighting of the view (the reflections', the screen probes', the radiance cache's) reads this one. */
export function lightGridOf(gpu: { viewKey?: object }, device: GPUDevice): LightGridHolder {
  const key = viewKey(gpu)
  let holder = holders.get(key)
  if (!holder) holders.set(key, (holder = createLightGridHolder(device)))
  return holder
}

/** Gives the view's light grid back (retired: this image's commands may still name it). */
export function releaseLightGrid(gpu: { viewKey?: object }) {
  const key = viewKey(gpu)
  holders.get(key)?.dispose()
  holders.delete(key)
}
