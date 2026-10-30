import { retire } from '../../gpu/core/frameRetire.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { wordsOf } from '../../gpu/core/wordViews.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { BLEND_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { bufferEntry } from '../../gpu/bind/liveEntries.ts'
import { BLEND_ITEM_WORDS, ITEM_MATERIAL_WORD, itemNode } from '../items.ts'
import { FACING_MATERIAL_MASK } from '../facing.ts'
import { blendEntries } from '../identity.ts'
import { readByRadianceMark, radianceMarkBlendLayout } from '../radianceMarkStage.ts'
import { translucentCastersOf } from '../../lighting/shadows/perObject/objectShadowFeed.ts'
import {
  objectShadowHeldDrawn,
  objectShadowHoldKey,
  type ObjectShadowFrame,
} from '../../lighting/shadows/perObject/objectShadowFrame.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { objectShadowDrawLayout } from './objectShadowStage.ts'
import { waterExclusionRevision, waterTableGroup } from '../water/waterExclusions.ts'
import { WATER_GROUP } from '../water/waterLayout.ts'
import { objectShadowClipMatrix } from './objectShadowClip.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'
import { publishObjectShadowRead, releaseObjectShadowRead } from './objectShadowSelf.ts'

export { objectShadowClipMatrix }
import {
  OBJECT_SHADOW_DRAW_BINDING,
  OBJECT_SHADOW_DRAW_FLOATS,
  OBJECT_SHADOW_MATERIAL_VECS,
  OBJECT_SHADOW_MATERIALS_BINDING,
} from './objectShadowWgsl.ts'
import {
  MATERIAL_TRANSLUCENT_SHADOW_RULES,
  TRANSLUCENT_MULTIPLE_SCATTERING_EXTINCTION_DEFAULT as EXTINCTION_DEFAULT,
} from '../../../../sdk-core/src/contracts/translucentObjectShadowOptions.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/**
 * THE DEPTH PASS OF THE TRANSLUCENT OBJECT SHADOWS: for each subject of the frame (a light x object pair, `ObjectShadowFrame`), the translucent
 * surfaces of the object are drawn from the light into the rectangle of its atlas slot, the two coefficient targets of the atlas added into
 * (`objectShadowWgsl.ts`), after the transparents were prepared for the image (`prepareBlend`) and before the lights' shadow reads the atlases
 * back (`objectShadowProject.ts`). The atlases are cleared at the pass's start, so a border or a rectangle nothing draws in holds no density.
 *
 * What a subject draws is the whole object at its finest level, from the light: the clusters of level 0 of its caster's translucent items
 * (`TransparentTable.isFinest`), not the camera's cut, written once, caster after caster, into an instance buffer of the pass's own (the blend's
 * `planInstances` binding of the items group is replaced by it in the pass's group, so the blends' instance list holds no room for it) and drawn in one
 * call per subject over its caster's range alone, culled by the light's own frustum as the rasterizer clips them (a layer adds, so the order does not
 * matter, and no plan, verdict or camera cut is involved). The ranges are rewritten when the casters, the items or the table moved; the materials'
 * shadow properties are a table of their own by material rank (`osMaterials`), written from the contract where the scene or the casting moved, bound by
 * this pass alone. The subjects' draw uniforms are one dynamic offset each into one uniform buffer, written together once an image. The pass's state belongs to the view
 * (`viewKey`): its draws' buffer, instances and materials are its own, so a view's offsets and writes never meet another's, and one view letting go leaves the others'. The atlases are cleared
 * at the pass's start; where the pass cannot run (the transparents not prepared, the stage compiling, nothing to draw) the frame stays undrawn
 * (`ObjectShadowFrame.drawn`) and the projections read nothing.
 */

const SLOT_BYTES = 256
const SLOT_FLOATS = SLOT_BYTES / 4

interface Kept {
  readonly device: GPUDevice
  draws: GPUBuffer | undefined
  drawFloats: Float32Array<ArrayBuffer>
  /** Per item: whether its object casts (the materials table is written for those alone), and the caster's rank in the list plus one. */
  casting: Uint32Array<ArrayBuffer>
  /** Per caster of the list: the first cluster of its range in the pass's instances and the count, and the cursor the ranges are filled by. */
  ranges: Uint32Array<ArrayBuffer>
  cursors: Uint32Array<ArrayBuffer>
  /** The node of each caster, to its place in the list. */
  placeOf: Map<Object3D, number>
  /** The subjects' clusters (item, entry), the buffer they were written to and their count. */
  clusters: Uint32Array<ArrayBuffer>
  clusterCount: number
  instances: GPUBuffer | undefined
  /** The per-material table and the values to write (the words the buffer holds are kept beside it by `writeChanged`). */
  materials: GPUBuffer | undefined
  materialWords: Float32Array<ArrayBuffer>
  /** What the ranges were written from. */
  casters: unknown
  blend: unknown
  items: number
  epoch: number
  table: unknown
  /** What the materials were written from: the casting (a count of the times it was made) and the scene's revision. */
  castingEpoch: number
  materialCasting: number
  materialScene: number
  group: GPUBindGroup | undefined
  /** What the atlases were last drawn from (the frame's hold key, the scene's revision, the casting, the atlases' texture, the draw pipeline and the water exclusion volumes' revision): the same again draws and copies nothing. A graph that reads time redraws every image. */
  drawnEpoch: number
  drawnScene: number
  drawnCasting: number
  drawnAtlas: unknown
  drawnPipeline: unknown
  drawnWater: number
  /** The pass's items group (the mark stage's layout, the pass's instances) and what it names. */
  readonly identity: ReturnType<typeof createWebgpuBindIdentity>
  itemsGroup: GPUBindGroup | undefined
}
const kept = new WeakMap<object, Kept>()

function stateOf(rt: WebgpuPagesRuntime, device: GPUDevice): Kept {
  const key = viewKey(rt.gpu)
  let state = kept.get(key)
  if (state?.device !== device) {
    if (state) releaseObjectShadowDraw(rt)
    kept.set(
      key,
      (state = {
        device,
        draws: undefined,
        drawFloats: new Float32Array(SLOT_FLOATS),
        casting: new Uint32Array(1),
        ranges: new Uint32Array(2),
        cursors: new Uint32Array(1),
        placeOf: new Map(),
        clusters: new Uint32Array(2),
        clusterCount: 0,
        instances: undefined,
        materials: undefined,
        materialWords: new Float32Array(0),
        casters: undefined,
        blend: undefined,
        items: -1,
        epoch: -1,
        table: undefined,
        castingEpoch: 0,
        materialCasting: -1,
        materialScene: -1,
        group: undefined,
        drawnEpoch: -1,
        drawnScene: -1,
        drawnCasting: -1,
        drawnAtlas: undefined,
        drawnPipeline: undefined,
        drawnWater: -1,
        identity: createWebgpuBindIdentity(2),
        itemsGroup: undefined,
      }),
    )
  }
  return state
}

/**
 * Lets go of the view's pass: its buffers, and the table the blends read (`releaseObjectShadowRead`), which stays with `keepProfiles` while it holds the light profiles
 * (the view still draws its blends, only without a shadow context).
 */
export function releaseObjectShadowDraw(rt: WebgpuPagesRuntime, keepProfiles = false) {
  const key = viewKey(rt.gpu)
  const state = kept.get(key)
  releaseObjectShadowRead(rt.gpu, keepProfiles)
  if (!state) return
  if (state.draws) retire(state.device, state.draws)
  if (state.materials) retire(state.device, state.materials)
  if (state.instances) retire(state.device, state.instances)
  kept.delete(key)
}

/**
 * The casters' cluster ranges and the items that cast, written where the casters, the items or the table moved since they were: for each
 * caster in turn, the clusters of the finest level of its items, as the instances (item, entry) the vertex stage reads, in the pass's own instance
 * buffer. Returns whether there is something to draw.
 */
function writeObjects(rt: WebgpuPagesRuntime, device: GPUDevice, state: Kept) {
  const { blendState } = rt
  const { blendGpu, verdictEpoch, table } = blendState
  const casters = translucentCastersOf(rt)
  const count = blendGpu.length
  if (!table) return false
  if (
    state.casters === casters &&
    state.items === count &&
    state.blend === blendGpu &&
    state.epoch === verdictEpoch &&
    state.table === table
  )
    return state.clusterCount > 0
  const { placeOf } = state
  placeOf.clear()
  casters.forEach((caster, place) => placeOf.set(caster.node, place))
  state.casting = resized(state.casting, count)
  state.ranges = resized(state.ranges, casters.length * 2)
  state.cursors = resized(state.cursors, casters.length)
  const { ranges, cursors, casting } = state
  ranges.fill(0, 0, casters.length * 2)
  // The finest-level clusters of an item: the entries of its range of the table that are of level 0.
  const finest = (item: (typeof blendGpu)[number], visit: (entry: number) => void) => {
    if (item.pagedIndex === undefined) return
    const first = table.itemRanges[item.pagedIndex * 2]!
    const held = table.itemRanges[item.pagedIndex * 2 + 1]!
    for (let e = first; e < first + held; e++) if (table.isFinest(e)) visit(e)
  }
  for (let i = 0; i < count; i++) {
    const item = blendGpu[i]!
    const place = placeOf.get(itemNode(item) as Object3D)
    casting[i] = place === undefined ? 0 : place + 1
    if (place !== undefined)
      finest(item, () => (ranges[place * 2 + 1] = ranges[place * 2 + 1]! + 1))
  }
  let total = 0
  for (let c = 0; c < casters.length; c++) {
    ranges[c * 2] = total
    total += ranges[c * 2 + 1]!
    cursors[c] = 0
  }
  state.clusters = resized(state.clusters, total * 2)
  const { clusters } = state
  for (let i = 0; i < count; i++) {
    if (!casting[i]) continue
    const place = casting[i]! - 1
    finest(blendGpu[i]!, (entry) => {
      const slot = ranges[place * 2]! + cursors[place]!
      cursors[place] = cursors[place]! + 1
      clusters[slot * 2] = i
      clusters[slot * 2 + 1] = entry
    })
  }
  if (total) {
    state.instances = sizedBuffer(
      device,
      state.instances,
      total * 8,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'Trillion3D translucent object shadow instances',
    )
    device.queue.writeBuffer(state.instances, 0, clusters, 0, total * 2)
  }
  state.clusterCount = total
  state.casters = casters
  state.blend = blendGpu
  state.items = count
  state.epoch = verdictEpoch
  state.table = table
  state.castingEpoch++
  return total > 0
}

/**
 * The per-material table (`osMaterials`), by material rank, from the surfaces of the casters' items: for each, the density scale of its shadow, its
 * start offset, the self shadow's scales and weight, the backscattering exponent and the extinction (the contract's `Material` fields, their
 * defaults where unset). Made again only where the casting or the scene's revision moved (a material edit moves it), and then only the words that differ go
 * up (`writeChanged`); only the materials of items that cast hold a row. False while the items' records do not exist: there is no table to draw with.
 */
function writeMaterials(rt: WebgpuPagesRuntime, device: GPUDevice, state: Kept) {
  const { blendGpu, itemInts } = rt.blendState
  if (!itemInts) return false
  const scene = rt.run.gate.revisions.scene
  if (
    state.materials &&
    state.materialCasting === state.castingEpoch &&
    state.materialScene === scene
  )
    return true
  const rules = MATERIAL_TRANSLUCENT_SHADOW_RULES
  const rows = OBJECT_SHADOW_MATERIAL_VECS * 4
  let most = 0
  for (let i = 0; i < blendGpu.length; i++)
    if (state.casting[i])
      most = Math.max(
        most,
        itemInts[i * BLEND_ITEM_WORDS + ITEM_MATERIAL_WORD]! & FACING_MATERIAL_MASK,
      )
  const length = (most + 1) * rows
  state.materialWords = resized(state.materialWords, length)
  const words = state.materialWords
  words.fill(0, 0, length)
  for (let i = 0; i < blendGpu.length; i++) {
    if (!state.casting[i]) continue
    const m = blendGpu[i]!.surface
    const at = (itemInts[i * BLEND_ITEM_WORDS + ITEM_MATERIAL_WORD]! & FACING_MATERIAL_MASK) * rows
    const extinction = m.translucentMultipleScatteringExtinction ?? EXTINCTION_DEFAULT
    words[at] = m.translucentShadowDensityScale ?? rules.translucentShadowDensityScale.default
    words[at + 1] = m.translucentShadowStartOffset ?? rules.translucentShadowStartOffset.default
    words[at + 2] =
      m.translucentSelfShadowDensityScale ?? rules.translucentSelfShadowDensityScale.default
    words[at + 3] =
      m.translucentSelfShadowSecondDensityScale ??
      rules.translucentSelfShadowSecondDensityScale.default
    words[at + 4] =
      m.translucentSelfShadowSecondOpacity ?? rules.translucentSelfShadowSecondOpacity.default
    words[at + 5] =
      m.translucentBackscatteringExponent ?? rules.translucentBackscatteringExponent.default
    words[at + 8] = extinction[0]
    words[at + 9] = extinction[1]
    words[at + 10] = extinction[2]
  }
  const buffer = sizedBuffer(
    device,
    state.materials,
    Math.max(rows * 4, length * 4),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'Trillion3D translucent object shadow materials',
  )
  if (buffer !== state.materials) {
    state.materials = buffer
    state.group = undefined
  }
  writeChanged(device, buffer, wordsOf(words), 0, length)
  state.materialCasting = state.castingEpoch
  state.materialScene = scene
  return true
}

/** The pass's items group: the mark stage's layout over the blend's resources, but for the instance list, which is the pass's own. */
function itemsGroupOf(rt: WebgpuPagesRuntime, device: GPUDevice, state: Kept) {
  // The material records the item records named go up before a group names their texture.
  rt.vis.materialTable.viewFor(device)
  const { identity } = state
  identity.entries[0] ??= blendEntries(rt)
    .filter(readByRadianceMark)
    .map((entry) =>
      entry.binding === BLEND_BINDINGS.planInstances
        ? bufferEntry(entry.binding, () => state.instances)
        : entry,
    )
  const layout = radianceMarkBlendLayout(device)
  if (identity.entriesMoved(layout)) state.itemsGroup = undefined
  return (state.itemsGroup ??= device.createBindGroup({
    label: 'Trillion3D translucent object shadow depth items',
    layout,
    entries: identity.entries[0],
  }))
}

/** What the atlases are drawn from, as the last image drew them (`Kept.drawn*`) and as this image has them. */
export interface DrawnKey {
  readonly animated: boolean
  readonly epoch: number
  readonly heldDrawn: boolean
  readonly scene: number
  readonly atlas: unknown
  readonly pipeline: unknown
  readonly water: number
}

/** Whether the atlases are as the last image drew them, so that nothing is drawn or copied again: no graph reads time, and the hold's epoch, the scene, the casting, the atlas texture, the draw pipeline and the water volumes' revision are the same. */
export const atlasesAsDrawn = (
  state: Pick<
    Kept,
    | 'drawnEpoch'
    | 'drawnScene'
    | 'drawnCasting'
    | 'castingEpoch'
    | 'drawnAtlas'
    | 'drawnPipeline'
    | 'drawnWater'
  >,
  now: DrawnKey,
) =>
  !now.animated &&
  now.heldDrawn &&
  state.drawnEpoch === now.epoch &&
  state.drawnScene === now.scene &&
  state.drawnCasting === state.castingEpoch &&
  state.drawnAtlas === now.atlas &&
  state.drawnPipeline === now.pipeline &&
  state.drawnWater === now.water

/**
 * Draws the subjects of `frame` into its atlases; the number of draws encoded. None where the transparents were not prepared for this image, the
 * stage is still compiling (asked), the casters have no cluster to draw, or no subject has a slot: the frame stays undrawn then (`drawn`), its
 * atlases hold a past image's and the projections skip them.
 */
export function encodeObjectShadowDepths(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  frame: ObjectShadowFrame,
) {
  frame.drawn = false
  const { blendState, vis, run } = rt
  if (blendState.preparedFrame !== run.frame || !vis.blendPipelines) return 0
  const { blendPipelines } = vis
  const set = blendPipelines.objectShadow
  if (!set.ready) {
    set.ask()
    return 0
  }
  const state = stateOf(rt, device)
  if (!writeObjects(rt, device, state)) return 0
  // No draw until the items and their materials exist.
  if (!writeMaterials(rt, device, state) || !state.materials) return 0
  const pipeline = set.at(0)
  if (!pipeline) return 0
  const { subjects, atlases } = frame
  const scene = run.gate.revisions.scene
  const water = blendPipelines.objectShadowCut ? waterExclusionRevision(rt, device) : 0
  // The atlases as the last image drew them (the same subjects, light frames, slots, casting, scene, atlas texture, pipeline and water volumes, no graph reading time): nothing is
  // drawn or copied again, the records are made as ever. The hold's tuple is taken once, after the decision.
  if (
    atlasesAsDrawn(state, {
      animated: !!vis.graphsAnimated,
      epoch: frame.hold.epoch,
      heldDrawn: objectShadowHeldDrawn(frame),
      scene,
      atlas: atlases.texture,
      pipeline,
      water,
    })
  ) {
    frame.drawn = true
    publishObjectShadowRead(rt, device, encoder, frame, readInput(rt, state), false)
    return 0
  }
  state.drawnEpoch = -1
  state.drawFloats = resized(state.drawFloats, Math.max(1, subjects.length) * SLOT_FLOATS)
  const draws = sizedBuffer(
    device,
    state.draws,
    state.drawFloats.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    'Trillion3D translucent object shadow draws',
  )
  if (draws !== state.draws) {
    state.draws = draws
    state.group = undefined
  }
  const group = (state.group ??= device.createBindGroup({
    label: 'Trillion3D translucent object shadow depth',
    layout: objectShadowDrawLayout(device),
    entries: [
      {
        binding: OBJECT_SHADOW_DRAW_BINDING,
        resource: { buffer: draws, size: OBJECT_SHADOW_DRAW_FLOATS * 4 },
      },
      { binding: OBJECT_SHADOW_MATERIALS_BINDING, resource: { buffer: state.materials! } },
    ],
  }))
  const items = itemsGroupOf(rt, device, state)
  const casters = translucentCastersOf(rt)
  const { vertexShift, maxVertexWords } = blendState
  const { drawFloats } = state
  let encoded = 0
  atlases.atlases.forEach((atlas, index) => {
    if (!atlases.slots.some((slot) => slot?.atlas === index)) return
    const pass = encoder.beginRenderPass({
      label: 'Trillion3D translucent object shadow depth',
      colorAttachments: attachmentsOf(atlas.views),
    })
    frame.drawn = true
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, items)
    // The variant that cuts the water's surface inside an exclusion volume reads the volumes' table.
    if (blendPipelines.objectShadowCut) pass.setBindGroup(WATER_GROUP, waterTableGroup(rt, device))
    subjects.forEach((subject, k) => {
      const slot = atlases.slots[k]
      if (slot?.atlas !== index) return
      const place = subject.place
      const first = state.ranges[place * 2]!
      const held = state.ranges[place * 2 + 1]!
      if (!held) return
      const p = subject.projection
      const at = encoded * SLOT_FLOATS
      objectShadowClipMatrix(p, drawFloats, at)
      drawFloats[at + 16] = p.invMaxSubjectDepth
      drawFloats[at + 17] = p.directional ? 1 : 0
      drawFloats[at + 18] =
        casters[place]!.node.matrixWorld.getMaxScaleOnAxis() / (p.maxSubjectZ - p.minSubjectZ)
      pass.setViewport(slot.x + p.border, slot.y + p.border, p.resolutionX, p.resolutionY, 0, 1)
      pass.setBindGroup(1, group, [encoded * SLOT_BYTES])
      pass.draw(maxVertexWords, held, first << vertexShift, 0)
      encoded++
    })
    pass.end()
  })
  // The subjects' uniforms, all at once.
  if (encoded)
    device.queue.writeBuffer(
      draws,
      0,
      drawFloats,
      0,
      (encoded - 1) * SLOT_FLOATS + OBJECT_SHADOW_DRAW_FLOATS,
    )
  run.gpuDrawCalls += encoded
  // The translucent surfaces' own shadow: the records of the sun's subjects, the atlas copied where the device reads it from a buffer.
  if (encoded) {
    publishObjectShadowRead(rt, device, encoder, frame, readInput(rt, state))
    // The key is taken once, with the frame drawn, as the hold takes it after this pass.
    if (frame.drawn) {
      state.drawnEpoch = objectShadowHoldKey(frame)
      state.drawnScene = scene
      state.drawnCasting = state.castingEpoch
      state.drawnAtlas = atlases.texture
      state.drawnPipeline = pipeline
      state.drawnWater = water
    }
  }
  return encoded
}

/** The clearing attachments of an atlas's views, made once for the views (kept by them). */
const attachments = new WeakMap<object, GPURenderPassColorAttachment[]>()
function attachmentsOf(views: readonly GPUTextureView[]) {
  let held = attachments.get(views)
  if (!held)
    attachments.set(
      views,
      (held = views.map((view) => ({
        view,
        loadOp: 'clear' as const,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store' as const,
      }))),
    )
  return held
}

/** What the depth pass tells the table of the translucent surfaces' own shadow of the items. */
const readInput = (rt: WebgpuPagesRuntime, state: Kept) => ({
  casting: state.casting,
  count: rt.blendState.blendGpu.length,
  materialRank: (i: number) =>
    rt.blendState.itemInts![i * BLEND_ITEM_WORDS + ITEM_MATERIAL_WORD]! & FACING_MATERIAL_MASK,
  materialWords: state.materialWords,
})
