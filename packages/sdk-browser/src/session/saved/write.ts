import { offsetSwitchesSet } from '../../../../sdk-core/src/world/object/offsetSwitches.ts'
import { jsonCopy } from '../../../../sdk-core/src/runtime/jsonCopy.ts'
import { DEFAULT_LIGHT_UNITS } from '../../../../sdk-core/src/scene/light/lightUnits.ts'
import type { ModuleOption } from '../../../../sdk-core/src/modules/descriptor.ts'
import { MATERIAL_BOOKKEEPING } from '../../../../sdk-core/src/world/material/material.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { Sprite } from '../../../../sdk-core/src/world/object/sprite.ts'
import type { WaterExclusionVolume } from '../../../../sdk-core/src/world/object/waterExclusionVolume.ts'
import type { Light } from '../../../../sdk-core/src/world/light/light.ts'
import { tintSet } from '../../../../sdk-core/src/world/light/lightAirSettings.ts'
import { settingsSet } from '../../../../sdk-core/src/world/light/lightShaftSettings.ts'
import { settingsSet as cloudShadowSettingsSet } from '../../../../sdk-core/src/world/light/lightCloudShadowSettings.ts'
import { settingsSet as shadowSettingsSet } from '../../../../sdk-core/src/world/light/lightShadowSettings.ts'
import { LIGHT_FUNCTION_DEFAULTS } from '../../../../sdk-core/src/scene/light/lightFunction.ts'
import { settingsSet as contactShadowSettingsSet } from '../../../../sdk-core/src/world/light/lightContactShadowSettings.ts'
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { Color } from '../../../../sdk-core/src/world/math/color.ts'
import type { LoadedModel } from '../world/models/loadedModel.ts'
import { isHelper } from '../world/helperMark.ts'
import { savedPhysics } from './physics.ts'
import {
  notSavable,
  SCENE_FORMAT,
  SCENE_FORMAT_VERSION,
  type SavedCamera,
  type SavedGeometry,
  type SavedMaterial,
  type SavedNode,
  type SavedWaterBody,
  type SavedPose,
  type SavedScene,
} from './format.ts'

type SceneLike = Object3D & {
  background: unknown
  environment: unknown
  sky?: ModuleOption
}

/** A linear colour, or a point a light aims at. */
type Triple = [number, number, number]
const rgb = (c: Color): Triple => [c.r, c.g, c.b]
/** A plain copy of JSON-shaped data: what the page stored in `userData` or a parameter; a
 *  `null` stays `null` (a cleared parameter), `undefined` stays unset. */
const plain = <T>(value: T): T => (value === undefined ? value : jsonCopy(value))

/** The sky word as plain data: the numbers of a typed array (a cubemap's texels, the fog's or the
 *  sky light's) are saved as an array of them, which reads back as the picture they are. */
const plainSky = (sky: unknown) =>
  JSON.parse(
    JSON.stringify(sky, (_key, value) =>
      ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value,
    ),
  )

/** The shape: its family call while it still holds, its vertices otherwise. */
function saveGeometry(g: Geometry): SavedGeometry {
  if (g.recipe) return { recipe: plain(g.recipe) as SavedGeometry['recipe'] }
  const attributes: SavedGeometry['attributes'] = {}
  for (const [name, attribute] of Object.entries(g.attributes)) {
    // A view of an interleaved buffer is stored as its own numbers, not the whole pack.
    const a = attribute.kind === 'attribute' ? attribute : attribute.clone()
    attributes[name] = {
      itemSize: a.itemSize,
      array: Array.from(a.array),
      type: a.array.constructor.name,
      normalized: a.normalized,
    }
  }
  const index = g.index ? Array.from(g.index.array) : undefined
  const groups = g.groups.map((group) => ({ ...group }))
  return { attributes, index, groups, owner: g._owner === 'host' ? 'host' : undefined }
}

/** The matter: its kind and each parameter; a texture or a shader cannot be stored. */
function saveMaterial(m: Material): SavedMaterial {
  if (m.kind === 'shader') notSavable('a shader material')
  const parameters: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(m)) {
    if (name === 'kind' || MATERIAL_BOOKKEEPING.has(name)) continue
    const shaped = value as { isColor?: boolean; isTexture?: boolean } | null
    if (shaped?.isTexture) notSavable('a texture', { parameter: name })
    parameters[name] = shaped?.isColor ? rgb(value as Color) : plain(value)
  }
  return { kind: m.kind, parameters }
}

/** Where `o` stands and how it is turned; its Euler order and its up only where they are not the
 *  defaults. */
function savePose(o: Object3D): SavedPose {
  return {
    position: o.position.toArray(),
    quaternion: o.quaternion.toArray(),
    ...(o.rotation.order === 'XYZ' ? {} : { rotationOrder: o.rotation.order }),
    ...(o.up.x === 0 && o.up.y === 1 && o.up.z === 0 ? {} : { up: o.up.toArray() }),
  }
}

/** The camera's pose and optics. */
function saveCamera(camera: Camera): SavedCamera {
  return {
    projection: camera.projection,
    ...savePose(camera),
    optics: { ...camera._optics },
    ...(camera.fitAspect && { fitAspect: true }),
  }
}

/**
 * A scene as plain JSON (`format.ts`): its hierarchy and poses, each shape by the call that built
 * it, each material by its parameters, lights, the background and fog, a loaded model by its
 * manifest address, and `camera` when one is given. Shapes and materials worn by several meshes
 * are stored once. `helper` marks are left out: they are how a scene is worked on, not what it is.
 */
export function saveScene(scene: SceneLike, camera?: Camera): SavedScene {
  const background = scene.background as Color | null
  if (scene.environment) notSavable('a picture environment')
  const tables: Tables = {
    geometries: new Map(),
    materials: new Map(),
    ranks: new Map(),
    volumes: [],
  }
  const children = scene.children.filter((c) => !isHelper(c)).map((c) => saveNode(c, tables))
  // The bodies a volume names are found in the tree just saved: each stays in its place in the list, whatever it is.
  for (const [saved, volume] of tables.volumes)
    saved.waterExclusion!.bodies = volume.bodies.map((body) => savedWaterBody(body, tables.ranks))
  return {
    format: SCENE_FORMAT,
    formatVersion: SCENE_FORMAT_VERSION,
    background: background && rgb(background),
    ...(scene.sky != null && { sky: plainSky(scene.sky) as ModuleOption }),
    camera: camera ? saveCamera(camera) : null,
    geometries: [...tables.geometries.keys()].map(saveGeometry),
    materials: [...tables.materials.keys()].map(saveMaterial),
    children,
  }
}

/** The reference to a water body `body` in the tree saved (`SavedWaterBody`): its rank, else the model whose file carried it, else none. */
function savedWaterBody(body: Object3D, ranks: ReadonlyMap<Object3D, number>): SavedWaterBody {
  const own = ranks.get(body)
  if (own !== undefined) return own
  for (let up = body.parent; up; up = up.parent) {
    const at = ranks.get(up)
    if (at === undefined) continue
    // The first node up the chain that was saved: a model's file brings its nodes back, found by name.
    const model = up as LoadedModel
    return model.isLoadedModel && model.getObjectByName(body.name) === body
      ? { model: at, name: body.name }
      : null
  }
  return null
}

/** The shapes and materials a save stores once, each at the rank it was first met at. */
type Tables = {
  geometries: Map<Geometry, number>
  materials: Map<Material, number>
  /** The rank of each node saved, depth first. */
  ranks: Map<Object3D, number>
  /** The water exclusion volumes saved, their bodies filled once the whole tree has its ranks. */
  volumes: [SavedNode, WaterExclusionVolume][]
}

const rank = <T>(table: Map<T, number>, item: T) => {
  if (!table.has(item)) table.set(item, table.size)
  return table.get(item)!
}

/** One node and its subtree, `helper` marks left out. */
function saveNode(o: Object3D, tables: Tables): SavedNode {
  const mesh = o as Mesh,
    lamp = o as Light,
    model = o as LoadedModel,
    volume = o as WaterExclusionVolume
  tables.ranks.set(o, tables.ranks.size)
  const saved: SavedNode = {
    kind: mesh.isMesh
      ? 'mesh'
      : lamp.isLight
        ? 'light'
        : model.isLoadedModel
          ? 'model'
          : volume.isWaterExclusionVolume
            ? 'waterExclusion'
            : 'object',
    name: o.name,
    ...savePose(o),
    scale: o.scale.toArray(),
    visible: o.visible,
    castShadow: o.castShadow,
    ...(o.castsShadowMaps ? {} : { castsShadowMaps: false as const }),
    ...(o.farField ? { farField: true as const } : {}),
    ...offsetSwitchesSet(o),
    renderOrder: o.renderOrder,
    userData: plain(o.userData),
    // What a model's file carried comes back with the model; what the page placed under it
    // is saved like any child.
    children: o.children
      .filter((c) => !isHelper(c) && !(model.isLoadedModel && model._fromFile(c)))
      .map((c) => saveNode(c, tables)),
  }
  if ((o as { isGroup?: boolean }).isGroup) saved.kind = 'group'
  if (mesh.isMesh) saveMesh(saved, mesh, tables)
  if (lamp.isLight) saved.light = saveLight(lamp, tables)
  if (model.isLoadedModel) saved.model = { url: model.record.manifestUrl }
  if (volume.isWaterExclusionVolume) {
    saved.waterExclusion = { mode: volume.mode, bodies: [] }
    tables.volumes.push([saved, volume])
  }
  return saved
}

/** A light's kind, colours, numbers and aim, and each setting it holds against its default. */
function saveLight(lamp: Light, { materials }: Tables): NonNullable<SavedNode['light']> {
  const shafts = settingsSet(lamp)
  const cloudShadows = cloudShadowSettingsSet(lamp)
  const contactShadows = contactShadowSettingsSet(lamp)
  const shadows = shadowSettingsSet(lamp)
  return {
    kind: lamp.kind,
    color: rgb(lamp.color),
    groundColor: rgb(lamp.groundColor),
    values: { ...lamp._values },
    target: lamp.target.position.toArray() as Triple,
    sh: lamp.sh ? [...lamp.sh] : null,
    ...(lamp.atmosphereSun ? {} : { atmosphereSun: false as const }),
    ...(lamp.atmosphereSunIndex ? { atmosphereSunIndex: lamp.atmosphereSunIndex } : {}),
    ...(lamp.shadowsFog === (lamp.kind === 'directional') ? {} : { shadowsFog: lamp.shadowsFog }),
    ...(lamp.mobility === 'stationary' ? {} : { mobility: lamp.mobility }),
    ...(lamp.inverseSquared ? {} : { inverseSquared: false as const }),
    ...(lamp.intensityUnits === DEFAULT_LIGHT_UNITS ? {} : { intensityUnits: lamp.intensityUnits }),
    ...(lamp.useTemperature ? { useTemperature: true as const } : {}),
    ...(lamp.transmission ? { transmission: true as const } : {}),
    ...(lamp.castHairDeepShadow ? { castHairDeepShadow: true as const } : {}),
    ...(lamp.shadowsAir ? { shadowsAir: true as const } : {}),
    ...(lamp.transmittancePerPixel ? { transmittancePerPixel: true as const } : {}),
    ...(tintSet(lamp) ? { sunDiskTint: rgb(tintSet(lamp)!) } : {}),
    ...(Object.keys(shafts).length ? { shafts } : {}),
    ...(Object.keys(cloudShadows).length ? { cloudShadows } : {}),
    ...(Object.keys(contactShadows).length ? { contactShadows } : {}),
    ...(Object.keys(shadows).length ? { shadows } : {}),
    ...(lamp.lightFunction ? { lightFunction: saveLightFunction(lamp, materials) } : {}),
  }
}

/** The light function `lamp` wears: its material by rank, and each setting against its default
 *  (`LIGHT_FUNCTION_DEFAULTS`). */
function saveLightFunction(lamp: Light, materials: Tables['materials']) {
  const { scale, fadeDistance, disabledBrightness, coneAngle } = LIGHT_FUNCTION_DEFAULTS
  const at = lamp.lightFunctionScale
  return {
    material: rank(materials, lamp.lightFunction!),
    ...(at.x === scale[0] && at.y === scale[1] && at.z === scale[2]
      ? {}
      : { lightFunctionScale: at.toArray() }),
    ...(lamp.lightFunctionFadeDistance === fadeDistance
      ? {}
      : { lightFunctionFadeDistance: lamp.lightFunctionFadeDistance }),
    ...(lamp.lightFunctionDisabledBrightness === disabledBrightness
      ? {}
      : { lightFunctionDisabledBrightness: lamp.lightFunctionDisabledBrightness }),
    ...(lamp.lightFunctionConeAngle === coneAngle
      ? {}
      : { lightFunctionConeAngle: lamp.lightFunctionConeAngle }),
  }
}

/** A mesh's shape and materials by their ranks, its sprite centre and its physics. */
function saveMesh(saved: SavedNode, mesh: Mesh, { geometries, materials }: Tables) {
  const worn = mesh.material
  saved.mesh = {
    geometry: rank(geometries, mesh.geometry),
    material: Array.isArray(worn) ? worn.map((m) => rank(materials, m)) : rank(materials, worn),
    primitive: mesh.primitive,
  }
  const center = mesh instanceof Sprite ? mesh.center : undefined
  if (center) saved.mesh.center = [center.x, center.y]
  if (mesh.waterBody) saved.mesh.waterBody = { ...mesh.waterBody }
  if (mesh.physics) saved.physics = plain(savedPhysics(mesh.physics))
}
