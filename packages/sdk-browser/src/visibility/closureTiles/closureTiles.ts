import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { preparedComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { arrayView } from '../../gpu/core/textureViews.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'
import { mostClosures } from '../../frame/prepare/closures.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  CLOSURE_ARGS_BYTES,
  CLOSURE_ARGS_ENTRY,
  CLOSURE_TILE_BINDINGS as B,
  CLOSURE_TILE_SIZE,
  CLOSURE_TILES_ENTRY,
  CLOSURE_TILE_COORD_MAX,
  closureRegionOf,
  closureRegionWords,
  closureTilesWgsl,
} from './closureTilesWgsl.ts'

/** The closure tiles of a view: the entries, and the indirect dispatch over those of each closure. */
export interface ClosureTiles {
  /** The entries, a region for each closure past the first (`closureRegionOf`): the entries written there (`closureTilesMain`, cleared each image), the tiles along a row, then an entry for each tile that holds the closure (`packClosureTile`). */
  readonly list: GPUBuffer
  /** The indirect dispatch of each closure's entries, from the second (`closureArgsAt`): x tiles a row, as many rows as the count asks. */
  readonly args: GPUBuffer
  /** The tiles along each side the list was sized for, and the closures it holds a region for (one more than its regions). */
  readonly tiles: readonly [number, number]
  readonly closures: number
}

/** What a view holds of its closure tiles, between images. */
interface Held extends ClosureTiles {
  readonly device: GPUDevice
  /** The bind group over the words target and the list it was made for. */
  group?: { readonly target: GPUTexture; readonly bind: GPUBindGroup }
}

const states = new WeakMap<object, Held>()

const LABEL = 'Trillion3D closure tiles'
const PASS: GPUComputePassDescriptor = { label: LABEL }

/** The layout and the two kernels of a device, prepared off the frame. */
const programsOf = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [
      computeTextureEntry(B.words, 'uint', '2d-array'),
      computeBufferEntry(B.list, 'storage'),
      computeBufferEntry(B.args, 'storage'),
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ label: LABEL, bindGroupLayouts: [layout] })
  const module = device.createShaderModule({ label: LABEL, code: closureTilesWgsl() })
  const kernel = (entryPoint: string) =>
    preparedComputePipeline(device, { layout: pipelineLayout, compute: { module, entryPoint } })
  return { layout, tiles: kernel(CLOSURE_TILES_ENTRY), args: kernel(CLOSURE_ARGS_ENTRY) }
})

/** Gives back what a view held of its closure tiles. */
function release(device: GPUDevice, key: object) {
  const held = states.get(key)
  if (!held) return
  for (const buffer of [held.list, held.args]) retire(device, buffer)
  states.delete(key)
}

/**
 * The resources of a view for a frame of `tiles` holding `closures` closures a pixel: the arguments are made once, the list
 * again when the tiles or the closures change (the old retired).
 */
function resourcesFor(
  device: GPUDevice,
  key: object,
  tiles: readonly [number, number],
  closures: number,
) {
  const held = states.get(key)
  if (
    held &&
    held.device === device &&
    held.tiles[0] === tiles[0] &&
    held.tiles[1] === tiles[1] &&
    held.closures === closures
  )
    return held
  const make = (name: string, size: number, usage: GPUBufferUsageFlags) =>
    device.createBuffer({ label: `${LABEL} ${name}`, size, usage })
  const list = make(
    'list',
    4 * closureRegionWords(tiles) * (closures - 1),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  )
  if (held?.device === device) {
    retire(device, held.list)
    const made: Held = { ...held, list, tiles, closures, group: undefined }
    states.set(key, made)
    return made
  }
  release(device, key)
  const made: Held = {
    device,
    tiles,
    closures,
    list,
    args: make(
      'args',
      CLOSURE_ARGS_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    ),
  }
  states.set(key, made)
  return made
}

/**
 * The drawn view's closure tiles of the last image that listed them, none while its record holds one closure: the readers that iterate the
 * closures of the pixels (the screen probes' integration of the overflow tiles) dispatch over `args` and read their closure's region of `list`
 * (`closureRegionOf`). They exist from the first image of a record of several closures on, whether or not the kernels are compiled: their words are
 * zero, an empty dispatch, until the kernels write them.
 */
export const closureTilesOf = (rt: Pick<WebgpuPagesRuntime, 'gpu'>): ClosureTiles | undefined =>
  states.get(viewKey(rt.gpu))

/**
 * After the resolve (`encodeMaterialPasses`), for a record that holds several closures: the tiles whose pixels do are listed, one entry for
 * each closure past the first, and the indirect dispatch over them written (`closureTilesWgsl.ts`). A record of one closure gives back what
 * the view held, and a frame past the tiles a coordinate holds (32768 pixels a side) holds none. While no surface of the scene has several closures the pass is
 * not run and the counts and the arguments are cleared (an empty dispatch); while the kernels compile the list is empty (they are started here).
 */
export function encodeClosureTiles(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu } = rt,
    surfaces = gpu.surfaces,
    device = gpu.device
  if (!surfaces || !device) return
  const key = viewKey(gpu)
  const tiles = [
    ceilDiv(surfaces.width, CLOSURE_TILE_SIZE),
    ceilDiv(surfaces.height, CLOSURE_TILE_SIZE),
  ] as const
  if (
    !(surfaces.closures > 1) ||
    tiles[0] > CLOSURE_TILE_COORD_MAX ||
    tiles[1] > CLOSURE_TILE_COORD_MAX
  )
    return release(device, key)
  const program = programsOf(device)
  const kernels = program.tiles.get(),
    args = program.args.get()
  // The resources are made before the kernels are ready: the readers bind them, and read an empty list until the kernels write it.
  const held = resourcesFor(device, key, tiles, surfaces.closures)
  if (!kernels || !args) return
  const clearCounts = () => {
    for (let closure = 1; closure < held.closures; closure++)
      encoder.clearBuffer(held.list, closureRegionOf(tiles, closure).offset, 4)
  }
  if (mostClosures(rt) < 2) {
    clearCounts()
    encoder.clearBuffer(held.args)
    return
  }
  if (held.group?.target !== surfaces.words) {
    const bind = device.createBindGroup({
      label: LABEL,
      layout: program.layout,
      entries: [
        { binding: B.words, resource: arrayView(surfaces.words) },
        { binding: B.list, resource: { buffer: held.list } },
        { binding: B.args, resource: { buffer: held.args } },
      ],
    })
    held.group = { target: surfaces.words, bind }
  }
  clearCounts()
  const pass = encoder.beginComputePass(PASS)
  pass.setBindGroup(0, held.group.bind)
  pass.setPipeline(kernels)
  pass.dispatchWorkgroups(tiles[0], tiles[1])
  pass.setPipeline(args)
  pass.dispatchWorkgroups(1)
  pass.end()
}
