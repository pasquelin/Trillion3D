import { savedOffsets } from './offsets.ts'
import { jsonCopy } from '../../../../sdk-core/src/runtime/jsonCopy.ts'
import { DEFAULT_LIGHT_UNITS } from '../../../../sdk-core/src/scene/light/lightUnits.ts'
import type { ModuleOption } from '../../../../sdk-core/src/modules/descriptor.ts'
import { MATERIAL_BOOKKEEPING } from '../../../../sdk-core/src/world/material/material.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { Sprite } from '../../../../sdk-core/src/world/object/sprite.ts'
import type { Light } from '../../../../sdk-core/src/world/light/light.ts'
import { tintSet } from '../../../../sdk-core/src/world/light/lightAirSettings.ts'
import { settingsSet } from '../../../../sdk-core/src/world/light/lightShaftSettings.ts'
import { settingsSet as cloudShadowSettingsSet } from '../../../../sdk-core/src/world/light/lightCloudShadowSettings.ts'
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

/** The camera's pose and optics. */
function saveCamera(camera: Camera): SavedCamera {
  return {
    projection: camera.projection,
    position: camera.position.toArray(),
    quaternion: camera.quaternion.toArray(),
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
  const tables: Tables = { geometries: new Map(), materials: new Map() }
  const children = scene.children.filter((c) => !isHelper(c)).map((c) => saveNode(c, tables))
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

/** The shapes and materials a save stores once, each at the rank it was first met at. */
type Tables = { geometries: Map<Geometry, number>; materials: Map<Material, number> }

const rank = <T>(table: Map<T, number>, item: T) => {
  if (!table.has(item)) table.set(item, table.size)
  return table.get(item)!
}

/** One node and its subtree, `helper` marks left out. */
function saveNode(o: Object3D, tables: Tables): SavedNode {
  const mesh = o as Mesh,
    lamp = o as Light,
    model = o as LoadedModel
  const saved: SavedNode = {
    kind: mesh.isMesh ? 'mesh' : lamp.isLight ? 'light' : model.isLoadedModel ? 'model' : 'object',
    name: o.name,
    position: o.position.toArray(),
    quaternion: o.quaternion.toArray(),
    scale: o.scale.toArray(),
    visible: o.visible,
    castShadow: o.castShadow,
    ...(o.castFarShadow ? { castFarShadow: true as const } : {}),
    ...(o.farField ? { farField: true as const } : {}),
    ...(o.farShadowTest === null ? {} : { farShadowTest: o.farShadowTest }),
    ...savedOffsets(o),
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
  if (lamp.isLight) saved.light = saveLight(lamp)
  if (model.isLoadedModel) saved.model = { url: model.record.manifestUrl }
  return saved
}

/** A light's kind, colours, numbers and aim, and each setting it holds against its default. */
function saveLight(lamp: Light): NonNullable<SavedNode['light']> {
  const shafts = settingsSet(lamp)
  const cloudShadows = cloudShadowSettingsSet(lamp)
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
    ...(lamp.shadowsAir ? { shadowsAir: true as const } : {}),
    ...(lamp.transmittancePerPixel ? { transmittancePerPixel: true as const } : {}),
    ...(tintSet(lamp) ? { sunDiskTint: rgb(tintSet(lamp)!) } : {}),
    ...(Object.keys(shafts).length ? { shafts } : {}),
    ...(Object.keys(cloudShadows).length ? { cloudShadows } : {}),
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
  if (mesh.physics) saved.physics = plain(savedPhysics(mesh.physics))
}
