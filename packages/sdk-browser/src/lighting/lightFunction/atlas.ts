import { LIGHT_FUNCTION_ATLAS_PASS } from '../../diagnostic/stage/passLabels.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { AtlasFormat } from './renderWgsl.ts'
import type { LightFunctionMaps } from './maps.ts'
import type { GraphClocks } from '../../materials/graph/clocks.ts'
import { lightFunctionTextures, usableGraphSlot, writeGraphSlot } from './graphSlot.ts'
import {
  createSlotPrograms,
  GIVEN_BYTES,
  layoutOf,
  programOf,
  type SlotPrograms,
} from './slotPrograms.ts'
import { createAtlasTexture, fitAtlasTexture, type AtlasTexture } from './atlasTexture.ts'
import type { AtlasShape, LightFunctionPlan } from './plan.ts'

/** What the atlas keeps of a slot it drew: the material, its version, the format it was drawn in,
 *  the slots of its textures in the colour atlas (empty for none) and whether they were read at the
 *  detail the slot shows. */
type Drawn = {
  material: Material
  version: number
  format: AtlasFormat
  places: string
  warm: boolean
}

/** A slot to draw: its rank in the plan, its textures' slots in the colour atlas (and as a key),
 *  and whether they were read at the detail the slot shows. */
type Due = { index: number; key: string; places: number[]; warm: boolean }

/** What the atlas holds: its texture, its programs, the slots it drew, the buffer of their
 *  parameters (one aligned stride a slot) and whether the last image left a slot undrawn or moving. */
interface Atlas {
  readonly device: GPUDevice
  readonly texture: AtlasTexture
  readonly programs: SlotPrograms
  readonly drawn: Map<number, Drawn>
  readonly align: number
  /** The clocks the graphs of its slots read: the image's (`WebgpuRun.graphClocks`). */
  readonly clocks: GraphClocks
  given?: GPUBuffer
  givenSlots: number
  stride: number
  changes: number
  waiting: boolean
}

/** The parameters buffer, one aligned slot a material of the plan, `bytes` the most any takes. */
function fitGiven(atlas: Atlas, count: number, bytes: number) {
  const needed = alignUp(Math.max(bytes, GIVEN_BYTES), atlas.align)
  if (atlas.given && count <= atlas.givenSlots && needed <= atlas.stride) return
  if (atlas.given) retire(atlas.device, atlas.given)
  atlas.givenSlots = count
  atlas.stride = Math.max(atlas.stride, needed)
  atlas.given = atlas.device.createBuffer({
    label: 'Trillion3D light function parameters',
    size: count * atlas.stride,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
}

/** The slots to draw: new ones, those whose material was written, those whose textures are not yet
 *  read at the detail the slot shows, and those that read the time. Sets `waiting` for a slot not
 *  ready or animated: such an image is drawn again. */
function dueSlots(
  atlas: Atlas,
  plan: LightFunctionPlan,
  at: AtlasShape,
  format: AtlasFormat,
  maps: LightFunctionMaps,
  fresh: boolean,
) {
  atlas.waiting = false
  const due: Due[] = []
  plan.slots.forEach(({ material }, index) => {
    const places = lightFunctionTextures(material).map((texture) => maps.slotOf(texture))
    const missing = places.includes(undefined)
    const key = places.join(',')
    const warm = maps.warm(material, at.slot)
    const animated = !!usableGraphSlot(material)?.animated
    const kept = atlas.drawn.get(index)
    const same =
      kept?.material === material &&
      kept.version === material.version &&
      kept.format === format &&
      kept.places === key &&
      (kept.warm || !warm) &&
      !animated
    atlas.waiting ||= missing || !warm || animated
    if (!missing && (fresh || !same)) due.push({ index, key, places: places as number[], warm })
  })
  return due
}

/** Writes the parameters of a due slot and draws it into its square; a slot whose program or
 *  textures are not ready is left for the next image. */
function drawSlot(
  atlas: Atlas,
  pass: GPURenderPassEncoder,
  plan: LightFunctionPlan,
  at: AtlasShape,
  format: AtlasFormat,
  maps: LightFunctionMaps,
  { index, key, places, warm }: Due,
  groupOf: (bytes: number, mapped: boolean) => GPUBindGroup | undefined,
) {
  const { material, x, y } = plan.slots[index]
  const graph = usableGraphSlot(material)
  const group = groupOf(graph?.bytes ?? GIVEN_BYTES, places.length > 0)
  const pipeline = programOf(atlas.programs, material, at, format).get()
  if (!group || !pipeline) {
    atlas.waiting = true
    return
  }
  const data = new ArrayBuffer(atlas.stride)
  if (graph) {
    if (!writeGraphSlot(graph, material, data, atlas.clocks, maps.slotOf)) {
      atlas.waiting = true
      return
    }
  } else {
    new Float32Array(data, 0, 3).set(material.surface().emissive)
    new Uint32Array(data, 12, 1)[0] = places[0] ?? 0
  }
  atlas.device.queue.writeBuffer(
    atlas.given!,
    index * atlas.stride,
    data,
    0,
    graph?.bytes ?? GIVEN_BYTES,
  )
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group, [index * atlas.stride])
  const [px, py] = [x * at.slot, y * at.slot]
  pass.setViewport(px, py, at.slot, at.slot, 0, 1)
  pass.setScissorRect(px, py, at.slot, at.slot)
  pass.draw(3)
  atlas.drawn.set(index, { material, version: material.version, format, places: key, warm })
}

/** The groups a pass binds, made on first ask: the parameters buffer at the size a program reads,
 *  with the colour atlas's pools when mapped; none while the pools are not there. */
function groupsOf(atlas: Atlas, maps: LightFunctionMaps) {
  const groups = new Map<string, GPUBindGroup | undefined>()
  return (bytes: number, mapped: boolean) => {
    const key = `${bytes}|${mapped}`
    if (!groups.has(key)) {
      const entries = mapped ? maps.entries() : []
      groups.set(
        key,
        entries &&
          atlas.device.createBindGroup({
            layout: layoutOf(atlas.programs, bytes, mapped),
            entries: [{ binding: 0, resource: { buffer: atlas.given!, size: bytes } }, ...entries],
          }),
      )
    }
    return groups.get(key)
  }
}

/** Fits the atlas to `plan` and draws the slots that need it. */
function encodeAtlas(
  atlas: Atlas,
  encoder: GPUCommandEncoder,
  plan: LightFunctionPlan,
  at: AtlasShape,
  format: AtlasFormat,
  maps: LightFunctionMaps,
) {
  const { fresh, wrote } = fitAtlasTexture(atlas.texture, plan, at)
  if (fresh) atlas.drawn.clear()
  if (wrote) atlas.changes++
  const due = dueSlots(atlas, plan, at, format, maps, fresh)
  const { view } = atlas.texture
  if (!due.length || !view) return
  const widest = Math.max(
    ...plan.slots.map(({ material }) => usableGraphSlot(material)?.bytes ?? 0),
  )
  fitGiven(atlas, plan.slots.length, widest)
  const groupOf = groupsOf(atlas, maps)
  const pass = encoder.beginRenderPass({
    label: LIGHT_FUNCTION_ATLAS_PASS,
    colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
  })
  for (const slot of due) drawSlot(atlas, pass, plan, at, format, maps, slot, groupOf)
  pass.end()
  atlas.changes++
}

/**
 * THE LIGHT FUNCTION ATLAS: one texture of slots in a square, one slot a material, drawn by the
 * material's own program — its graph's emission, else its colour and map — when it is new, has been
 * written, has a texture not yet read at the detail its slot shows, or reads the time; below the
 * slots, the table of entries, written when the plan changes (`layout.ts`). The frame reads `view`;
 * the graphs of the slots read the image's `clocks`.
 */
export function createLightFunctionAtlas(device: GPUDevice, clocks: GraphClocks) {
  const align = device.limits.minUniformBufferOffsetAlignment
  const atlas: Atlas = {
    device,
    texture: createAtlasTexture(device),
    programs: createSlotPrograms(device),
    drawn: new Map(),
    align,
    clocks,
    givenSlots: 0,
    stride: Math.max(GIVEN_BYTES, align),
    changes: 0,
    waiting: false,
  }
  return {
    /** Starts the compile of the program of `material`; the frames wait for it. */
    ask(material: Material, at: AtlasShape, format: AtlasFormat) {
      programOf(atlas.programs, material, at, format).ask()
    },
    /**
     * Fits the atlas to `plan` and draws the slots that need it: new ones, those whose material was
     * written, those whose textures are not yet read at the detail the slot shows, and those that
     * read the time. A slot whose program is not compiled yet, or whose textures have not joined the
     * colour atlas, is left for the next image.
     */
    encode(
      encoder: GPUCommandEncoder,
      plan: LightFunctionPlan,
      at: AtlasShape,
      format: AtlasFormat,
      maps: LightFunctionMaps,
    ) {
      encodeAtlas(atlas, encoder, plan, at, format, maps)
    },
    get view() {
      return atlas.texture.view
    },
    /** Whether a texture of a material a light wears was not read at the detail its slot shows at the
     *  last image, or a slot moves with the time: such an image is drawn again, never held. */
    get waiting() {
      return atlas.waiting
    },
    /** How many times the atlas changed — its table written, a slot drawn —: what caches the light it gave
     *  (the bounce's probes) is traced again when it moved. */
    get changes() {
      return atlas.changes
    },
    dispose() {
      atlas.texture.texture?.destroy()
      atlas.given?.destroy()
    },
  }
}

/** The atlas of a device. */
export type LightFunctionAtlas = ReturnType<typeof createLightFunctionAtlas>
