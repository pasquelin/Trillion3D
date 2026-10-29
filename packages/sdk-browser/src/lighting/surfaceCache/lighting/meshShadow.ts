import { normalizeVector3OrZero } from '../../../../../math/src/vector/vector.ts'
import { namedEntries, wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { CENTIMETRES_PER_METRE as CM } from '../../../../../sdk-core/src/page/format.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { vsmMapSettings } from '../../shadows/vsm/frame/vsmFarShadow.ts'
import { ledgerAdmitted, type HeldAllocation } from '../../../gpu/core/deviceLedger.ts'
import { objectCapacity } from '../../rays/meshTrace/gridPasses.ts'
import { boxBounds } from '../../distanceField/shadow/bounds.ts'
import {
  createDfshState,
  encodeShadowTiles,
  type DfshState,
} from '../../distanceField/shadow/frame.ts'
import { dfshLightGroups } from '../../distanceField/shadow/groups.ts'
import {
  DFSH_BINDING as B,
  DFSH_MAX_LIGHTS,
  DFSH_PARAMS,
  DFSH_PARAMS_BYTES,
  DFSH_PARAMS_STRIDE,
} from '../../distanceField/shadow/layout.ts'
import {
  snapTexelsOf,
  tilesOf,
  writeDfshParams,
  type DfshSettings,
} from '../../distanceField/shadow/params.ts'
import { dfshPrograms, dfshProgramsReady } from '../../distanceField/shadow/pipelines.ts'
import { ensureDfshView } from '../../distanceField/shadow/view.ts'
import { viewResources } from '../../distanceField/viewResources.ts'
import type { MeshFieldScene } from '../../distanceField/meshFieldScene.ts'

/**
 * THE MESHES' FIELDS THE SUNS' SHADOW ON THE CARDS IS TRACED THROUGH (`fieldShadowMesh`, `fieldShadowWgsl.ts`), listed before the lighting.
 * For each sun with shadows (the first `DFSH_MAX_LIGHTS`, one pass of lists a directional light as the reference makes), the meshes that
 * cast one are culled to the volume the cards are kept in — a cube round the eye, as far as the cards reach — and the sun, and listed by tile
 * of the volume's shadow space across it (`encodeShadowTiles`, over a shadow space of the volume's bounds), the settings of its tiles
 * the view's (`dfshSettingsOf`), every mesh listed, the ones made of clusters too: the sun's shadow maps draw the clusters at any distance
 * but do not reach the cards, so this is the only distance-field shadow of a sun. The passes make one sun's lists after the other in the
 * view's buffers, each copied after its pass to
 * the place of its sun in the buffers the shadow pass reads (`ListStore`). Every other light is traced through the global field. None
 * where the option is off, the scene has no mesh with a field, no sun casts a shadow, the programs are not compiled or the memory is
 * refused (`state.dfsh.why`): the image is then lit through the global field.
 */

/** What the shadow pass through the suns' meshes reads of the lists, in its bind group `MESH_SHADOW_GROUP`: the resources it names (to know a moved one)
 *  and the entries of the group. */
export interface MeshShadow {
  /** The group of the pass that traces the suns through the lists and the meshes' fields (`fieldShadowMeshKernel`). */
  readonly identity: readonly unknown[]
  entries(): GPUBindGroupEntry[]
}

/** Where the three arrays of the suns' lists begin in the one buffer that holds them, in words: the tiles' start offsets, their counts, then the entries (`tiles` words of each of the first two and `entries` of the third, a sun). */
const listRegions = (tiles: number, entries: number) => ({
  offsets: 0,
  counts: tiles * DFSH_MAX_LIGHTS,
  data: 2 * tiles * DFSH_MAX_LIGHTS,
  words: (2 * tiles + entries) * DFSH_MAX_LIGHTS,
})

/** The buffers the shadow pass reads: a uniform block a sun, and the suns' tile lists one after the other in one buffer (`listRegions`), which keeps the pass within the storage buffers a stage is granted. */
interface ListStore extends HeldAllocation {
  readonly params: GPUBuffer
  readonly lists: GPUBuffer
  readonly tiles: number
  readonly entries: number
}

/** What the host holds of the suns' lists between images. */
export interface MeshShadowState {
  /** The lists' passes' resources, one sun's lists at a time. */
  readonly dfsh: DfshState
  store: ListStore | undefined
}

export const createMeshShadowState = (): MeshShadowState => ({
  dfsh: createDfshState(),
  store: undefined,
})

/** Gives the memory of the lists back: the state holds none after. */
export function releaseMeshShadow(state: MeshShadowState) {
  state.dfsh.view?.dispose()
  state.dfsh.view = undefined
  state.store?.dispose()
  state.store = undefined
}

/** The unit directions toward the light of the frame's suns that cast a shadow, the first `DFSH_MAX_LIGHTS`. */
function sunDirections(rt: WebgpuPagesRuntime) {
  const toLights: (readonly [number, number, number])[] = []
  const direction: [number, number, number] = [0, 0, 0]
  for (const projected of rt.lights.vsm?.plan?.projected ?? []) {
    const sun = projected.clipmap?.light
    if (!sun || !sun.shadow) continue
    normalizeVector3OrZero(direction, sun.direction, 1e-12)
    if (direction[0] === 0 && direction[1] === 0 && direction[2] === 0) continue
    toLights.push([-direction[0], -direction[1], -direction[2]])
    if (toLights.length === DFSH_MAX_LIGHTS) break
  }
  return toLights
}

/** Whether the scene has what the lists are made of: a mesh with a field and a sun that casts a shadow. */
export function meshShadowWanted(rt: WebgpuPagesRuntime) {
  const objects = rt.distanceFields?.scene?.meshes
  return !!objects && objects.generation > 0 && objects.count > 0 && sunDirections(rt).length > 0
}

const settings = {} as DfshSettings

/** The settings of the lists, `quality` to `snapTexels` (`SUN_SHADOW_RULES`), into `into`, on a device whose textures go to `limit` texels across. */
function dfshSettingsOf(rt: WebgpuPagesRuntime, limit: number, into: DfshSettings) {
  const { shadows } = vsmMapSettings(rt)
  into.quality = shadows.distanceFieldShadowQuality
  into.tileSize = shadows.distanceFieldShadowTileSize
  into.twoSidedBias = shadows.distanceFieldShadowTwoSidedBias
  into.perTile = shadows.distanceFieldShadowObjectsPerTile
  into.compactTiles = shadows.distanceFieldShadowCompactTiles
  into.snapTexels = snapTexelsOf(shadows.distanceFieldShadowSnapResolution, limit)
}

const floats = new Float32Array((DFSH_MAX_LIGHTS * DFSH_PARAMS_STRIDE) / 4)
const words = new Uint32Array(floats.buffer)
/** The suns' blocks, side by side, as the shadow pass reads them. */
const blocks = new Float32Array((DFSH_MAX_LIGHTS * DFSH_PARAMS_BYTES) / 4)
const blockWords = new Uint32Array(blocks.buffer)
/** The store of `tiles` × `tiles` tiles and `entries` list entries a sun, the `held` one if it is that, else made (the old one given back), or none where the budget refuses it. */
function ensureStore(
  state: MeshShadowState,
  device: GPUDevice,
  shape: { tiles: number; entries: number },
) {
  const held = state.store
  if (held && held.tiles === shape.tiles * shape.tiles && held.entries === shape.entries)
    return held
  const tiles = shape.tiles * shape.tiles
  const sizes = {
    params: DFSH_PARAMS_BYTES * DFSH_MAX_LIGHTS,
    lists: listRegions(tiles, shape.entries).words * 4,
  }
  // The lists are one binding: where it passes what the device grants a buffer, the suns are lit through the global field.
  const { maxStorageBufferBindingSize, maxBufferSize } = device.limits
  if (sizes.lists > Math.min(maxStorageBufferBindingSize, maxBufferSize)) {
    held?.dispose()
    state.store = undefined
    state.dfsh.why = 'the suns’ meshes lists pass the largest buffer binding of the device'
    return undefined
  }
  const { value, why } = ledgerAdmitted(device, {
    held,
    asked: Object.values(sizes).reduce((sum, bytes) => sum + bytes, 0),
    what: 'the suns’ meshes lists on the cards',
    make: () => {
      const { buffer, dispose } = viewResources(device, 'Trillion3D cards sun meshes')
      const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      return {
        params: buffer('params', sizes.params, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
        lists: buffer('lists', sizes.lists, STORAGE),
        tiles,
        entries: shape.entries,
        bytes: Object.values(sizes).reduce((sum, bytes) => sum + bytes, 0),
        dispose,
      }
    },
  })
  state.store = value
  state.dfsh.why = why
  return value
}

type Suns = ReturnType<typeof sunDirections>
type SunStore = NonNullable<ReturnType<typeof ensureStore>>
type SunView = NonNullable<ReturnType<typeof ensureDfshView>['view']>

/** The suns' parameter blocks written into `blocks`: each sun's parameters, its ray bias, and where its lists lie in the store. */
function writeSunBlocks(
  suns: Suns,
  bounds: readonly ReturnType<typeof boxBounds>[],
  eye: ArrayLike<number>,
  objectCount: number,
  options: Pick<SurfaceCacheSettings, 'surfaceCacheDirectLightingMeshSdfShadowRayBias'>,
  entries: number,
  tilesPerSun: number,
) {
  const at = DFSH_PARAMS.at
  blocks.fill(0)
  suns.forEach((toLight, sun) => {
    writeDfshParams(floats, words, sun, { eye, toLight, bounds: bounds[sun] }, settings, {
      objects: objectCount,
    })
    const base = (sun * DFSH_PARAMS_STRIDE) / 4
    // The mesh bias of the rays, centimetres, in the fourth word of the range.
    floats[base + at.range + 3] = options.surfaceCacheDirectLightingMeshSdfShadowRayBias
    const own = (sun * DFSH_PARAMS_BYTES) / 4
    blocks.set(floats.subarray(base, base + DFSH_PARAMS_BYTES / 4), own)
    // Where the sun's lists lie in the store (the lists' passes read none of these words): its first tile in `counts.z`, its first entry in `lists.x`, and
    // where the arrays begin in the buffer: the offsets in `lists.y`, the counts in `lists.z`, the entries in `lists.w`.
    const regions = listRegions(tilesPerSun, entries)
    blockWords[own + at.counts + 2] = sun * tilesPerSun
    blockWords[own + at.lists] = sun * entries
    blockWords[own + at.lists + 1] = regions.offsets
    blockWords[own + at.lists + 2] = regions.counts
    blockWords[own + at.lists + 3] = regions.data
  })
}

/** The suns' lists made for the volume's tiles, `sides[sun]` tiles a side, copied into the store at the place of each sun. */
function encodeSunLists(
  encoder: GPUCommandEncoder,
  device: GPUDevice,
  programs: ReturnType<typeof dfshPrograms>,
  view: SunView,
  store: SunStore,
  objects: MeshFieldScene,
  sides: readonly number[],
  entries: number,
  tilesPerSun: number,
) {
  const groups = dfshLightGroups(device, programs, view, objects)
  sides.forEach((side, sun) => {
    encodeShadowTiles(encoder, programs, view, groups, {
      side,
      index: sun,
      objects: objects.count,
      settings,
    })
    const regions = listRegions(tilesPerSun, entries)
    const copy = (from: GPUBuffer, region: number, stride: number, count: number) =>
      encoder.copyBufferToBuffer(from, 0, store.lists, (region + sun * stride) * 4, count * 4)
    copy(view.tileOffsets, regions.offsets, tilesPerSun, side * side)
    copy(view.tileCounts, regions.counts, tilesPerSun, side * side)
    copy(view.tileData, regions.data, entries, settings.perTile * side * side)
  })
}

/** The group the shadow pass reads the suns' lists through: the store's buffers and the objects'. */
function meshShadowGroup(store: SunStore, objects: MeshFieldScene): MeshShadow {
  const named = (resources: Partial<Record<keyof typeof B, GPUBindingResource>>) =>
    namedEntries(B, resources)
  return {
    identity: [store.params, store.lists, objects.generation],
    entries: () => [
      ...named({
        params: wholeBuffer(store.params),
        tileOffsets: wholeBuffer(store.lists),
      }),
      ...objects.bindEntries(B.objects),
    ],
  }
}

/**
 * Lists the meshes of `rt`'s scene for the suns on `encoder`, before the lighting's pass, for the cards' volume `reach` centimetres round
 * the eye `eye` (metres): the lists and the suns' uniform, as a group for the shadow pass, or none (and why in `state.dfsh`).
 */
export function encodeMeshShadow(
  state: MeshShadowState,
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  options: Pick<SurfaceCacheSettings, 'surfaceCacheDirectLightingMeshSdfShadowRayBias'>,
  volume: { eye: ArrayLike<number>; reach: number },
): MeshShadow | undefined {
  const objects: MeshFieldScene | undefined = rt.distanceFields?.scene?.meshes
  const suns = sunDirections(rt)
  if (!objects || suns.length === 0 || objects.generation === 0 || objects.count === 0)
    return undefined
  dfshSettingsOf(rt, device.limits.maxTextureDimension2D, settings)
  const programs = dfshPrograms(device)
  if (!dfshProgramsReady(programs, settings)) return undefined
  const bounds = suns.map((toLight) => boxBounds([0, 0, 0], volume.reach / CM, toLight))
  const sides = bounds.map((b) => tilesOf(b, settings))
  const held = state.dfsh.view?.shape
  const made = ensureDfshView(state.dfsh.view, device, {
    objects: Math.max(held?.objects ?? 0, objectCapacity(objects.count)),
    tiles: Math.max(held?.tiles ?? 0, ...sides),
    perTile: settings.perTile,
  })
  state.dfsh.view = made.view
  state.dfsh.why = made.why
  const view = made.view
  if (!view) return undefined
  const entries = Math.max(...sides.map((side) => settings.perTile * side * side))
  const store = ensureStore(state, device, { tiles: view.shape.tiles, entries })
  if (!store) return undefined
  const tilesPerSun = view.shape.tiles * view.shape.tiles
  writeSunBlocks(suns, bounds, volume.eye, objects.count, options, entries, tilesPerSun)
  device.queue.writeBuffer(view.params, 0, floats)
  device.queue.writeBuffer(store.params, 0, blocks)
  encodeSunLists(encoder, device, programs, view, store, objects, sides, entries, tilesPerSun)
  return meshShadowGroup(store, objects)
}
