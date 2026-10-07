import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts'
import { MATERIAL_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import {
  MATERIAL_TILE_SLOTS,
  materialTilesOn,
  MATERIAL_TILES_SHADER,
} from '../../visibility/shader/materialTilesWgsl.ts'
import { createWebgpuBindIdentity } from './bindIdentity.ts'
import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import type { RenderCommands } from '../../gpu/core/renderBundles.ts'

/** Bytes of one class's indirect draw: vertex count, instance count, first vertex, first instance. */
const DRAW_BYTES = 16

/** Group 1 of the class draws: the slot of each class key, and the tile lists. */
export function materialTileDrawLayout(device: GPUDevice) {
  const vertex = GPUShaderStage.VERTEX,
    buffer: GPUBufferBindingLayout = { type: 'read-only-storage' }
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: vertex, buffer },
      { binding: 1, visibility: vertex, buffer },
    ],
  })
}

/** The classification's pipelines — its draws' clear and the classification — and layout; none on
 *  a device with no compute or that refuses them (`validated`). A shader that does not compile is
 *  a defect, thrown by name. */
async function classifier(device: GPUDevice) {
  if (typeof device.createComputePipeline !== 'function') return undefined
  const compute = GPUShaderStage.COMPUTE,
    storage: GPUBufferBindingLayout = { type: 'storage' },
    readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' }
  return validated(device, async () => {
    const module = await createCheckedShaderModule(device, MATERIAL_TILES_SHADER, 'MATERIAL_TILES')
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: compute, texture: { sampleType: 'uint' } },
        { binding: 1, visibility: compute, buffer: readOnly },
        { binding: 2, visibility: compute, buffer: { type: 'uniform' } },
        { binding: 3, visibility: compute, buffer: readOnly },
        { binding: 4, visibility: compute, buffer: storage },
        { binding: 5, visibility: compute, buffer: storage },
      ],
    })
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
    const stages = await buildComputeStages(device, pipelineLayout, module, [
      'clearTiles',
      'classify',
    ])
    return { layout, ...stages }
  })
}

/** What the classification reads each image: the visibility buffer, its page table and the
 *  resolve's uniform. */
export type MaterialTileInputs = { vis: GPUTextureView; pages: GPUBuffer; uniform: GPUBuffer }

/**
 * The material tiles of the image (`materialTilesWgsl.ts`): the slot table, rewritten when the
 * classes the image holds change; the tile lists, sized for the largest image yet; one indirect
 * draw per slot, cleared then counted by the classification each image, both dispatches of the
 * caller's compute pass. Without a classification — a device that refused its pipelines — every
 * class takes no slot and draws the full-screen triangle.
 */
export async function createMaterialTiles(device: GPUDevice, drawLayout: GPUBindGroupLayout) {
  const classify = await classifier(device)
  const slotWords = new Uint32Array(MATERIAL_CLASS_KEYS).fill(MATERIAL_TILE_SLOTS)
  const slots = device.createBuffer({
    label: 'Trillion3D material tile slots',
    size: slotWords.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(slots, 0, slotWords)
  const draws = device.createBuffer({
    label: 'Trillion3D material tile draws',
    size: MATERIAL_TILE_SLOTS * DRAW_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  })
  const t: Tiles = {
    ...{ device, drawLayout, classify, listed: classify ? MATERIAL_TILE_SLOTS : 0 },
    ...{ slotWords, slots, draws, bound: createWebgpuBindIdentity() },
    ...{ lists: undefined, capacity: 0, tilesX: 0, tilesY: 0 },
    ...{ classifyGroup: undefined, drawGroup: undefined, held: [] },
  }
  return {
    /** Gives each class key of `keys` its slot, in order, `MATERIAL_TILE_SLOTS` past the last
     *  list; rewrites the table when they changed. */
    assign: (keys: readonly number[]) => assign(t, keys),
    /** The class draws' group 1 for a `width` × `height` image, its tile lists grown to hold it. */
    layFor: (width: number, height: number) => layFor(t, width, height),
    /** Classifies the image `layFor` laid, as dispatches of the frame's compute pass: the draws
     *  cleared, then one workgroup per tile. None on a device that refused the classification. */
    encode: (open: OpenPass, inputs: MaterialTileInputs) => encodeTiles(t, open, inputs),
    /** Draws class `at` of the keys assigned, in a pass or the bundle it executes: its tiles, or
     *  the full-screen triangle past the lists. */
    draw(pass: RenderCommands, at: number) {
      if (at < t.listed) pass.drawIndirect(draws, at * DRAW_BYTES)
      else pass.draw(3)
    },
    dispose() {
      t.lists?.destroy()
      slots.destroy()
      draws.destroy()
    },
  }
}

type Tiles = {
  device: GPUDevice
  drawLayout: GPUBindGroupLayout
  classify: Awaited<ReturnType<typeof classifier>>
  /** Slots with a tile list: none without a classification. */
  listed: number
  slotWords: Uint32Array<ArrayBuffer>
  slots: GPUBuffer
  draws: GPUBuffer
  bound: ReturnType<typeof createWebgpuBindIdentity>
  lists: GPUBuffer | undefined
  capacity: number
  tilesX: number
  tilesY: number
  classifyGroup: GPUBindGroup | undefined
  drawGroup: GPUBindGroup | undefined
  held: readonly number[]
}

function assign(t: Tiles, keys: readonly number[]) {
  const { slotWords, held } = t
  if (keys.length === held.length && keys.every((key, at) => held[at] === key)) return
  for (const key of held) slotWords[key] = MATERIAL_TILE_SLOTS
  keys.forEach((key, at) => (slotWords[key] = at < t.listed ? at : MATERIAL_TILE_SLOTS))
  t.held = keys.slice()
  t.device.queue.writeBuffer(t.slots, 0, slotWords)
}

function layFor(t: Tiles, width: number, height: number) {
  t.tilesX = materialTilesOn(width)
  t.tilesY = materialTilesOn(height)
  const tiles = t.tilesX * t.tilesY
  if (tiles > t.capacity) {
    t.lists?.destroy()
    t.capacity = tiles
    const lists = (t.lists = t.device.createBuffer({
      label: 'Trillion3D material tile lists',
      size: t.capacity * MATERIAL_TILE_SLOTS * 4,
      usage: GPUBufferUsage.STORAGE,
    }))
    t.drawGroup = t.device.createBindGroup({
      layout: t.drawLayout,
      entries: [
        { binding: 0, resource: { buffer: t.slots } },
        { binding: 1, resource: { buffer: lists } },
      ],
    })
  }
  return t.drawGroup!
}

function encodeTiles(t: Tiles, open: OpenPass, inputs: MaterialTileInputs) {
  const { classify, bound } = t
  if (!classify) return
  bound.next[0] = inputs.vis
  bound.next[1] = inputs.pages
  bound.next[2] = inputs.uniform
  bound.next[3] = t.lists
  if (bound.moved() || !t.classifyGroup)
    t.classifyGroup = t.device.createBindGroup({
      layout: classify.layout,
      entries: [
        { binding: 0, resource: inputs.vis },
        { binding: 1, resource: { buffer: inputs.pages } },
        { binding: 2, resource: { buffer: inputs.uniform } },
        { binding: 3, resource: { buffer: t.slots } },
        { binding: 4, resource: { buffer: t.lists! } },
        { binding: 5, resource: { buffer: t.draws } },
      ],
    })
  const pass = open.pass
  pass.setPipeline(classify.clearTiles)
  pass.setBindGroup(0, t.classifyGroup)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(classify.classify)
  pass.dispatchWorkgroups(t.tilesX, t.tilesY, 1)
}

export type MaterialTiles = Awaited<ReturnType<typeof createMaterialTiles>>
