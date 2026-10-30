/**
 * Host side of the shadow mask denoise (`denoiseWgsl.ts`, `shadowDenoise`): which passes it runs
 * (`denoisePasses`), the bindings and pipelines of its kernels, the uniform ring its passes read at a dynamic
 * offset each (a frame's passes are all encoded before the queue runs them, so each has a slot of its own),
 * the tile list buffers and the scratch textures it alternates with the masks. A tile pass (`denoiseTilesWgsl.ts`)
 * lists the 8 x 8 tiles with a penumbra within the reach of the filter, and the filter passes dispatch
 * indirectly over those alone: mask → scratch A → scratch B → ..., then a last pass copies the listed tiles back
 * into the mask. Every other pixel is never written, so it stays the mask the projection wrote, and a filter
 * pass reads such a neighbour from the mask itself (`dnOrig`).
 * The suns' and the local lights' masks are filtered once the projection and the shadows laid into them are
 * written (`denoiseProjected`); each per-light layer, once its light's projection and the shadows added to it are
 * (`denoiseLayer`).
 */
import {
  computeStorageEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import type { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { arrayView } from '../../../../gpu/core/textureViews.ts'
import {
  VSM_DENOISE_PASS,
  VSM_DENOISE_TILES_PASS,
} from '../../../../diagnostic/stage/passLabels.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { chainReady, preparedComputePipeline } from '../../../deferred/fullscreen.ts'
import type { PreparedPipeline } from '../../../deferred/fullscreen.ts'
import {
  DENOISE_BINDING,
  DENOISE_FORMAT,
  DENOISE_GROUP,
  DENOISE_PARAM_WORDS,
  TILE_BINDING,
  vsmDenoiseWgsl,
  type DenoiseKind,
} from './denoiseWgsl.ts'
import {
  denoiseTileReach,
  TILE_STAT_WORDS,
  vsmDenoiseMarkWgsl,
  vsmDenoiseTilesWgsl,
} from './denoiseTilesWgsl.ts'

const STEP: GPUComputePassDescriptor = { label: VSM_DENOISE_PASS }
const TILES_STEP: GPUComputePassDescriptor = { label: VSM_DENOISE_TILES_PASS }
/** The passes a frame may encode: a slot of the uniform ring each; past them a mask is left as it is. */
const RING_SLOTS = 1024

/** The camera and the target the geometry weights reconstruct pixels with. */
export interface DenoiseView {
  /** World → view, column-major (−Z forward). */
  view: ArrayLike<number>
  /** View → clip, column-major, reverse-Z. */
  projection: ArrayLike<number>
  /** The size the view is drawn at. */
  width: number
  height: number
  /** The image's depth (depth32float) and normals (xyz = world normal). */
  depth: GPUTextureView
  normals: GPUTextureView
}

/** The filter dispatches a frame's denoise runs for `iterations` filter passes: those, and the last copy of the listed tiles into the mask (0 for 0). */
export const denoisePasses = (iterations: number) => (iterations <= 0 ? 0 : iterations + 1)

/** The words of one slot of the uniform: `DenoiseParams` (`denoiseWgsl.ts`), for the pass `pass` of `iterations` over `rect` (the pass `iterations` is the last copy), `layers` the layers of a suns' array. */
export function writeDenoiseParams(
  into: Float32Array,
  view: DenoiseView,
  rect: readonly [number, number, number, number],
  iterations: number,
  pass: number,
  layers = 1,
) {
  const { projection: P, view: V } = view
  const ints = new Int32Array(into.buffer, into.byteOffset, 4)
  ints.set(rect)
  into[4] = P[10]
  into[5] = P[14]
  into[6] = P[11]
  into[7] = P[15]
  into[8] = P[0]
  into[9] = P[5]
  into[10] = 2 / view.width
  into[11] = 2 / view.height
  // The rotation's rows: world → view is the upper 3x3 of the column-major view matrix.
  for (let r = 0; r < 3; r++) {
    into[12 + 4 * r] = V[r]
    into[13 + 4 * r] = V[4 + r]
    into[14 + 4 * r] = V[8 + r]
    into[15 + 4 * r] = 0
  }
  const copy = pass === iterations
  into[24] = copy ? 0 : 2 ** pass
  into[25] = copy ? 1 : 0
  // Past the first pass the source is a scratch, which holds the listed tiles alone.
  into[26] = pass > 0 && !copy ? 1 : 0
  into[27] = denoiseTileReach(iterations)
  new Int32Array(into.buffer, into.byteOffset + 112, 4).set([layers, 0, 0, 0])
}

interface Pipes {
  layout: GPUBindGroupLayout
  pipeline: PreparedPipeline<GPUComputePipeline>
  /** The tile pass's reduction of this kind's mask to the stats of its tiles. */
  statsLayout: GPUBindGroupLayout
  stats: PreparedPipeline<GPUComputePipeline>
}

/** What the kinds share of the tile pass: the marking and the arguments. */
interface MarkPipes {
  layout: GPUBindGroupLayout
  mark: PreparedPipeline<GPUComputePipeline>
  args: PreparedPipeline<GPUComputePipeline>
}

const pipelines = oncePerDevice(() => new Map<DenoiseKind, Pipes>())
const markPipelines = oncePerDevice(() => ({}) as { made?: MarkPipes })

const sourceEntry = (binding: number, kind: DenoiseKind) =>
  computeTextureEntry(
    binding,
    kind.endsWith('uint') ? 'uint' : 'unfilterable-float',
    kind === 'sun' ? '2d-array' : '2d',
  )

function markPipesOf(device: GPUDevice): MarkPipes {
  const held = markPipelines(device)
  if (held.made) return held.made
  const layout = device.createBindGroupLayout({
    label: `${VSM_DENOISE_TILES_PASS}.mark`,
    entries: [
      computeUniformEntry(TILE_BINDING.params, { hasDynamicOffset: true }),
      computeStorageEntry(TILE_BINDING.stats, false),
      computeStorageEntry(TILE_BINDING.flags, true),
      computeStorageEntry(TILE_BINDING.list, true),
      computeStorageEntry(TILE_BINDING.args, true),
      computeStorageEntry(TILE_BINDING.counter, true),
    ],
  })
  const module = device.createShaderModule({
    label: `${VSM_DENOISE_TILES_PASS}.mark`,
    code: vsmDenoiseMarkWgsl(),
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const make = (entryPoint: string) =>
    preparedComputePipeline(device, {
      label: `${VSM_DENOISE_TILES_PASS}.${entryPoint}`,
      layout: pipelineLayout,
      compute: { module, entryPoint },
    })
  held.made = { layout, mark: make('vsmDenoiseMark'), args: make('vsmDenoiseArgs') }
  return held.made
}

function pipesOf(device: GPUDevice, kind: DenoiseKind): Pipes {
  const byKind = pipelines(device)
  let made = byKind.get(kind)
  if (made) return made
  const dimension = kind === 'sun' ? '2d-array' : '2d'
  const layout = device.createBindGroupLayout({
    label: `${VSM_DENOISE_PASS}.${kind}`,
    entries: [
      computeUniformEntry(DENOISE_BINDING.params, { hasDynamicOffset: true }),
      computeTextureEntry(DENOISE_BINDING.depth, 'depth'),
      computeTextureEntry(DENOISE_BINDING.normals, 'unfilterable-float'),
      sourceEntry(DENOISE_BINDING.source, kind),
      sourceEntry(DENOISE_BINDING.orig, kind),
      computeStorageTextureEntry(
        DENOISE_BINDING.result,
        DENOISE_FORMAT[kind],
        'write-only',
        dimension,
      ),
      computeStorageEntry(DENOISE_BINDING.flags, false),
      computeStorageEntry(DENOISE_BINDING.list, false),
    ],
  })
  const statsLayout = device.createBindGroupLayout({
    label: `${VSM_DENOISE_TILES_PASS}.${kind}`,
    entries: [
      computeUniformEntry(TILE_BINDING.params, { hasDynamicOffset: true }),
      sourceEntry(TILE_BINDING.source, kind),
      computeStorageEntry(TILE_BINDING.stats, true),
    ],
  })
  made = {
    layout,
    statsLayout,
    pipeline: preparedComputePipeline(device, {
      label: `${VSM_DENOISE_PASS}.${kind}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: {
        module: device.createShaderModule({
          label: `${VSM_DENOISE_PASS}.${kind}`,
          code: vsmDenoiseWgsl(kind),
        }),
        entryPoint: 'vsmDenoise',
      },
    }),
    stats: preparedComputePipeline(device, {
      label: `${VSM_DENOISE_TILES_PASS}.${kind}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [statsLayout] }),
      compute: {
        module: device.createShaderModule({
          label: `${VSM_DENOISE_TILES_PASS}.${kind}`,
          code: vsmDenoiseTilesWgsl(kind),
        }),
        entryPoint: 'vsmDenoiseTiles',
      },
    }),
  }
  byKind.set(kind, made)
  return made
}

/** The two textures a kind's passes alternate between, with the mask. */
interface Scratch {
  textures: [GPUTexture, GPUTexture]
  views: [GPUTextureView, GPUTextureView]
  width: number
  height: number
  layers: number
}

/** The tile list's buffers, for `capacity` tiles: the stats (two words a tile), the flags, the list (its count, then the tiles), the indirect arguments and the counter (always 0 between uses). */
interface TileBuffers {
  capacity: number
  stats: GPUBuffer
  flags: GPUBuffer
  list: GPUBuffer
  args: GPUBuffer
  counter: GPUBuffer
}

/** What a device keeps: the uniform ring and the next slot, the scratch of each kind, the tile buffers. */
interface DenoiseState {
  ring: GPUBuffer
  stride: number
  slot: number
  scratch: Map<DenoiseKind, Scratch>
  tiles?: TileBuffers
}

const states = new WeakMap<GPUDevice, DenoiseState>()
const words = new Float32Array(DENOISE_PARAM_WORDS)

function stateOf(device: GPUDevice) {
  let state = states.get(device)
  if (!state) {
    const align = device.limits.minUniformBufferOffsetAlignment
    const stride = Math.ceil((DENOISE_PARAM_WORDS * 4) / align) * align
    state = {
      ring: device.createBuffer({
        label: `${VSM_DENOISE_PASS}.params`,
        size: stride * RING_SLOTS,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      stride,
      slot: 0,
      scratch: new Map(),
    }
    states.set(device, state)
  }
  return state
}

/** A new frame: the ring's slots are free again. */
export function beginDenoiseFrame(device: GPUDevice) {
  const state = states.get(device)
  if (state) state.slot = 0
}

const retireTiles = (device: GPUDevice, held: TileBuffers) => {
  // The arguments and the counter are kept: the counter is 0 between uses.
  for (const buffer of [held.stats, held.flags, held.list]) retire(device, buffer)
}

/** Lets the scratch textures and the tile buffers go, where the denoise is off: it holds nothing then. */
export function releaseDenoise(device: GPUDevice) {
  const state = states.get(device)
  if (!state) return
  if (state.tiles) {
    retireTiles(device, state.tiles)
    // The counter is 0 and stays: a new set of buffers keeps it.
    state.tiles = { ...state.tiles, capacity: 0 }
  }
  if (!state.scratch.size) return
  for (const held of state.scratch.values())
    for (const texture of held.textures) retire(device, texture)
  state.scratch.clear()
}

/** The tile buffers for at least `tiles` tiles. One set serves every filter of a frame: their dispatches run in order, each list used before the next is written. */
function tilesOf(device: GPUDevice, state: DenoiseState, tiles: number) {
  const held = state.tiles
  if (held && held.capacity >= tiles) return held
  if (held?.capacity) retireTiles(device, held)
  const make = (label: string, size: number, usage: number) =>
    device.createBuffer({ label: `${VSM_DENOISE_TILES_PASS}.${label}`, size, usage })
  const storage = GPUBufferUsage.STORAGE
  const capacity = Math.max(tiles, held?.capacity ?? 0, 1024)
  const made: TileBuffers = {
    capacity,
    stats: make('stats', capacity * TILE_STAT_WORDS * 4, storage),
    flags: make('flags', capacity * 4, storage),
    list: make('list', (capacity + 1) * 4, storage),
    args: held?.args ?? make('args', 16, storage | GPUBufferUsage.INDIRECT),
    counter: held?.counter ?? make('counter', 4, storage),
  }
  state.tiles = made
  return made
}

function scratchOf(
  device: GPUDevice,
  state: DenoiseState,
  kind: DenoiseKind,
  width: number,
  height: number,
  layers: number,
) {
  const held = state.scratch.get(kind)
  if (held && held.width === width && held.height === height && held.layers === layers) return held
  if (held) for (const texture of held.textures) retire(device, texture)
  const one = (name: string) =>
    device.createTexture({
      label: `${VSM_DENOISE_PASS}.scratch.${kind}.${name}`,
      size: [width, height, kind === 'sun' ? layers : 1],
      format: DENOISE_FORMAT[kind],
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  const textures: [GPUTexture, GPUTexture] = [one('a'), one('b')]
  const view = (texture: GPUTexture) => (kind === 'sun' ? arrayView(texture) : texture.createView())
  const made: Scratch = {
    textures,
    views: [view(textures[0]), view(textures[1])],
    width,
    height,
    layers,
  }
  state.scratch.set(kind, made)
  return made
}

/** The mask a filter runs on: its view, the size of its texture, the layers of a suns' array. */
export interface DenoiseTarget {
  kind: DenoiseKind
  view: GPUTextureView
  width: number
  height: number
  layers: number
}

/** The compiles of the kernels of `kinds`, started ahead of the frames that run them (`prepare`). */
export const prepareDenoise = (device: GPUDevice, kinds: readonly DenoiseKind[]) => {
  const { mark, args } = markPipesOf(device)
  return [
    mark.prepare().then(() => undefined),
    args.prepare().then(() => undefined),
    ...kinds.flatMap((kind) => {
      const { pipeline, stats } = pipesOf(device, kind)
      return [pipeline.prepare().then(() => undefined), stats.prepare().then(() => undefined)]
    }),
  ]
}

/** Whether the kernels of `kind` (the filter and the tile pass) are compiled (the denoise waits for them; the masks stay as written meanwhile). */
export const denoiseReady = (device: GPUDevice, kind: DenoiseKind) => {
  const { pipeline, stats } = pipesOf(device, kind)
  const { mark, args } = markPipesOf(device)
  return chainReady(pipeline, stats, mark, args)
}

/** Opens the compute pass a part of the denoise is encoded in (the part's descriptor), and ends it if the opener ends them. */
type OpenPass = (descriptor: GPUComputePassDescriptor) => GPUComputePassEncoder

/**
 * Encodes the denoise of `iterations` passes over `rect` of `target`, reading `view`'s depth and normals: the tile
 * pass (the tiles with a penumbra within the filter's reach, listed) in a pass of its own, then the filter passes,
 * dispatched indirectly over the listed tiles, and the copy of those tiles into the mask. Nothing is encoded where the ring
 * holds too few slots or the kernels are compiling; whether it was.
 */
function dispatchPasses(
  device: GPUDevice,
  open: OpenPass,
  target: DenoiseTarget,
  view: DenoiseView,
  rect: readonly [number, number, number, number],
  iterations: number,
) {
  const count = denoisePasses(iterations)
  const state = stateOf(device)
  if (!count || state.slot + count > RING_SLOTS) return false
  if (!denoiseReady(device, target.kind)) return false
  const { layout, pipeline, statsLayout, stats } = pipesOf(device, target.kind)
  const marks = markPipesOf(device)
  const tilesX = ceilDiv(rect[2] - rect[0], DENOISE_GROUP),
    tilesY = ceilDiv(rect[3] - rect[1], DENOISE_GROUP)
  const tiles = tilesOf(device, state, tilesX * tilesY)
  const scratch = scratchOf(device, state, target.kind, target.width, target.height, target.layers)
  const layers = target.kind === 'sun' ? target.layers : 1
  const label = `${VSM_DENOISE_PASS}.${target.kind}`
  const params = { binding: 0, resource: { buffer: state.ring, size: DENOISE_PARAM_WORDS * 4 } }
  const bufferOf = (binding: number, buffer: GPUBuffer) => ({ binding, resource: { buffer } })
  const group = (from: GPUTextureView, orig: GPUTextureView, into: GPUTextureView) =>
    device.createBindGroup({
      label,
      layout,
      entries: [
        params,
        { binding: DENOISE_BINDING.depth, resource: view.depth },
        { binding: DENOISE_BINDING.normals, resource: view.normals },
        { binding: DENOISE_BINDING.source, resource: from },
        { binding: DENOISE_BINDING.orig, resource: orig },
        { binding: DENOISE_BINDING.result, resource: into },
        bufferOf(DENOISE_BINDING.flags, tiles.flags),
        bufferOf(DENOISE_BINDING.list, tiles.list),
      ],
    })
  // The slots: pass k of the filter reads its own, the tile pass the first one's (it reads the rect, the layers and the reach).
  const first = state.slot
  const offset = (k: number) => (first + k) * state.stride
  for (let k = 0; k < count; k++) {
    writeDenoiseParams(words, view, rect, iterations, k, layers)
    device.queue.writeBuffer(state.ring, offset(k), words)
  }
  state.slot += count

  const tilePass = open(TILES_STEP)
  tilePass.setPipeline(stats.get()!)
  tilePass.setBindGroup(
    0,
    device.createBindGroup({
      label: `${VSM_DENOISE_TILES_PASS}.${target.kind}`,
      layout: statsLayout,
      entries: [
        params,
        { binding: TILE_BINDING.source, resource: target.view },
        bufferOf(TILE_BINDING.stats, tiles.stats),
      ],
    }),
    [offset(0)],
  )
  tilePass.dispatchWorkgroups(tilesX, tilesY)
  const markGroup = device.createBindGroup({
    label: `${VSM_DENOISE_TILES_PASS}.mark`,
    layout: marks.layout,
    entries: [
      params,
      bufferOf(TILE_BINDING.stats, tiles.stats),
      bufferOf(TILE_BINDING.flags, tiles.flags),
      bufferOf(TILE_BINDING.list, tiles.list),
      bufferOf(TILE_BINDING.args, tiles.args),
      bufferOf(TILE_BINDING.counter, tiles.counter),
    ],
  })
  tilePass.setPipeline(marks.mark.get()!)
  tilePass.setBindGroup(0, markGroup, [offset(0)])
  tilePass.dispatchWorkgroups(ceilDiv(tilesX, DENOISE_GROUP), ceilDiv(tilesY, DENOISE_GROUP))
  tilePass.setPipeline(marks.args.get()!)
  tilePass.dispatchWorkgroups(1)

  const filterPass = open(STEP)
  filterPass.setPipeline(pipeline.get()!)
  for (let k = 0; k < count; k++) {
    const last = k === iterations
    // The first pass reads the mask; the others the scratch the pass before wrote (the copy: the last one, whose
    // neighbours it reads from itself, the mask being the pass's target).
    const from = k === 0 ? target.view : scratch.views[(k - 1) & 1]
    const orig = last ? from : target.view
    const into = last ? target.view : scratch.views[k & 1]
    filterPass.setBindGroup(0, group(from, orig, into), [offset(k)])
    filterPass.dispatchWorkgroupsIndirect(tiles.args, 0)
  }
  return true
}

/** The suns' mask (the first `suns` layers of `sunsView`) and, where there are any, the local lights' packed mask of `localFormat`, filtered in the frame's compute run. */
export function denoiseProjected(
  device: GPUDevice,
  steps: ComputeRun,
  view: DenoiseView,
  iterations: number,
  masks: {
    suns: GPUTexture
    sunsView: GPUTextureView
    sunCount: number
    locals?: GPUTexture
    localsView?: GPUTextureView
    localFormat: 'r32uint' | 'rg32uint' | 'rgba32uint'
  },
) {
  // No pass: nothing is opened, nothing is encoded, the masks are as the projection wrote them.
  if (!denoisePasses(iterations)) return
  const rect = [0, 0, view.width, view.height] as const
  const pass: OpenPass = (descriptor) => steps.pass(descriptor)
  if (masks.sunCount > 0)
    dispatchPasses(
      device,
      pass,
      {
        kind: 'sun',
        view: masks.sunsView,
        width: masks.suns.width,
        height: masks.suns.height,
        layers: masks.suns.depthOrArrayLayers,
      },
      view,
      rect,
      iterations,
    )
  if (masks.locals && masks.localsView)
    dispatchPasses(
      device,
      pass,
      {
        kind: masks.localFormat,
        view: masks.localsView,
        width: masks.locals.width,
        height: masks.locals.height,
        layers: 1,
      },
      view,
      rect,
      iterations,
    )
}

/** The per-light layer `layer` of a texture of `width` × `height`, filtered over `rect` (the pixels its light reached). */
export function denoiseLayer(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  view: DenoiseView,
  iterations: number,
  layer: GPUTextureView,
  size: readonly [number, number],
  rect: readonly [number, number, number, number],
) {
  if (rect[2] <= rect[0] || rect[3] <= rect[1]) return
  if (!denoiseReady(device, 'light')) return
  const opened: GPUComputePassEncoder[] = []
  const open: OpenPass = (descriptor) => {
    // One pass is open on an encoder at a time: the tile pass ends before the filter's begins.
    for (const earlier of opened.splice(0)) earlier.end()
    const pass = encoder.beginComputePass(descriptor)
    opened.push(pass)
    return pass
  }
  dispatchPasses(
    device,
    open,
    { kind: 'light', view: layer, width: size[0], height: size[1], layers: 1 },
    view,
    rect,
    iterations,
  )
  for (const pass of opened) pass.end()
}
