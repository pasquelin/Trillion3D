import { wearOffsets } from './offsets.ts'
import type { ModuleOption } from '../../../../sdk-core/src/modules/descriptor.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { RECIPES } from '../../../../sdk-core/src/world/geometry/recipes.ts'
import { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { WaterExclusionVolume } from '../../../../sdk-core/src/world/object/waterExclusionVolume.ts'
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Mesh, type Primitive } from '../../../../sdk-core/src/world/object/mesh.ts'
import { Sprite } from '../../../../sdk-core/src/world/object/sprite.ts'
import { Light } from '../../../../sdk-core/src/world/light/light.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import { isHelper } from '../world/helperMark.ts'
import type { LoadedModel } from '../world/models/loadedModel.ts'
import {
  assertSavedScene,
  notSavable,
  type SavedCamera,
  type SavedGeometry,
  type SavedNode,
  type SavedPose,
} from './format.ts'
import { legacySky, type LegacySkyLight } from './legacySky.ts'

/** What reading a scene needs of the scene it fills: its root, its load door, its surroundings. */
type Target = Object3D & {
  background: unknown
  sky: ModuleOption
  load(url: string): Promise<Object3D>
}

/** The typed arrays a saved attribute may name: its values come back in the type they had. */
const TYPED: Record<string, new (values: number[]) => ArrayLike<number>> = {
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
}

/** A shape again: its family call, or its vertices. */
function readGeometry(saved: SavedGeometry): Geometry {
  if (saved.recipe) {
    const build = (RECIPES as Record<string, (...args: unknown[]) => Geometry>)[saved.recipe.type]
    if (!build) notSavable(`a shape built by ${saved.recipe.type}`)
    return build(...saved.recipe.args)
  }
  const g = new Geometry()
  if (saved.owner === 'host') g._owner = 'host'
  for (const [name, a] of Object.entries(saved.attributes ?? {})) {
    const Typed = TYPED[a.type] ?? Float32Array
    g.setAttribute(name, new BufferAttribute(new Typed(a.array) as never, a.itemSize, a.normalized))
  }
  if (saved.index) g.setIndex(saved.index)
  for (const group of saved.groups ?? []) g.addGroup(group.start, group.count, group.materialIndex)
  return g
}

/** The kinds of a light that write their intensity in a unit. */
const LAMP_KINDS = ['point', 'spot', 'rectArea']

/** The numbers of a light saved at `version`: before 5, a spot's cone was an `angle` and a
 *  `penumbra` share, the inner cone the angle less that share. */
function savedValues({ values }: NonNullable<SavedNode['light']>, version: number) {
  if (version >= 5) return values
  const { angle, penumbra, ...rest } = values
  if (!Number.isFinite(angle) || !Number.isFinite(penumbra)) return rest
  return { ...rest, outerConeAngle: angle, innerConeAngle: angle * (1 - penumbra) }
}

/** The intensity and unit of a light saved at `version`: before 4, a rectangle's intensity was its
 *  radiance `L`, which is `L / 2` nits (`SceneLight`, version 3); one with no such number is not a
 *  scene of that version, and is refused by name. Before 5, a lamp that named no unit was in
 *  candelas. */
function savedIntensity(saved: NonNullable<SavedNode['light']>, version: number) {
  if (version >= 5 || !LAMP_KINDS.includes(saved.kind))
    return { intensityUnits: saved.intensityUnits }
  if (version >= 4 || saved.kind !== 'rectArea')
    return { intensityUnits: saved.intensityUnits ?? ('candelas' as const) }
  const radiance = saved.values.intensity
  if (!Number.isFinite(radiance))
    throw new EngineError(
      'UNSUPPORTED_SCENE_FORMAT',
      `A version-${version} rectangle light without its radiance`,
      { intensity: radiance },
    )
  return { intensity: radiance / 2, intensityUnits: 'nits' as const }
}

/** A light built again from what was saved of it, in a scene of `version`. */
function readLight(
  saved: NonNullable<SavedNode['light']>,
  version: number,
  materials: readonly Material[],
) {
  const { kind, color, groundColor, target, sh } = saved
  const { atmosphereSun, atmosphereSunIndex, shadowsFog, mobility } = saved
  const { useTemperature, shadowsAir, transmittancePerPixel, sunDiskTint, inverseSquared } = saved
  const { transmission, castHairDeepShadow } = saved
  return new Light(kind, {
    ...savedValues(saved, version),
    ...savedIntensity(saved, version),
    color,
    groundColor,
    target,
    sh: sh ?? undefined,
    atmosphereSun,
    atmosphereSunIndex,
    shadowsFog,
    mobility,
    inverseSquared,
    useTemperature,
    transmission,
    castHairDeepShadow,
    shadowsAir,
    transmittancePerPixel,
    sunDiskTint,
    ...saved.shafts,
    ...saved.cloudShadows,
    ...saved.contactShadows,
    ...saved.shadows,
    ...readLightFunction(saved.lightFunction, materials),
  })
}

/** Gives `o` what every saved node holds: its name, pose, visibility, shadows, render order and
 *  user data. */
function wear(o: Object3D, saved: SavedNode) {
  o.name = saved.name
  readPose(o, saved)
  o.scale.fromArray(saved.scale)
  o.visible = saved.visible
  o.castShadow = saved.castShadow
  o.castsShadowMaps = saved.castsShadowMaps ?? true
  o.farField = saved.farField ?? false
  wearOffsets(o, saved)
  o.renderOrder = saved.renderOrder
  o.userData = saved.userData
}

/** The light function a saved light wears: its material out of `materials`, and its settings. */
function readLightFunction(
  saved: NonNullable<SavedNode['light']>['lightFunction'],
  materials: readonly Material[],
) {
  if (!saved) return {}
  const { material, ...settings } = saved
  return { ...settings, lightFunction: materials[material] }
}

/** The up of a node that saved none (`Object3D.up`'s default). */
const DEFAULT_UP = [0, 1, 0]

/** Puts `o` where it was saved, turned as it was: the Euler order first, so the angles follow the
 *  quaternion read after it, never the other way round. */
function readPose(o: Object3D, saved: SavedPose) {
  o.position.fromArray(saved.position)
  const order = saved.rotationOrder ?? 'XYZ'
  if (o.rotation.order !== order) o.rotation.order = order
  o.quaternion.fromArray(saved.quaternion)
  o.up.fromArray(saved.up ?? DEFAULT_UP)
}

/** Puts a camera back where it was saved; a camera of another projection keeps its own. */
function readCamera(saved: SavedCamera, camera: Camera) {
  readPose(camera, saved)
  if (saved.projection !== camera.projection) return
  Object.assign(camera, saved.optics)
  camera.fitAspect = saved.fitAspect === true
}

/** The mesh or sprite a saved node held, over the geometries and materials read. */
function readMesh(
  saved: NonNullable<SavedNode['mesh']>,
  physics: SavedNode['physics'],
  geometries: Geometry[],
  materials: Material[],
) {
  const worn = saved.material
  const matter = Array.isArray(worn) ? worn.map((i) => materials[i]) : materials[worn]
  const { geometry, primitive, center } = saved
  let o: Object3D
  if (primitive === 'sprite') {
    const sprite = new Sprite(matter as Material)
    sprite.geometry = geometries[geometry]
    if (center) sprite.center.set(center[0], center[1])
    o = sprite
  } else o = new Mesh(geometries[geometry], matter, primitive as Primitive)
  if (physics) (o as Mesh).physics = physics
  if (saved.waterBody) (o as Mesh).waterBody = { ...saved.waterBody }
  return o
}

/** A model that could not be read leaves the scene as it was: every load still running is waited
 *  for — one may start another under it — and every model that arrived goes again. */
async function dropLoads(loads: Promise<Object3D>[]) {
  for (let settled = -1; settled !== loads.length;) {
    settled = loads.length
    await Promise.allSettled(loads)
  }
  for (const load of await Promise.allSettled(loads))
    if (load.status === 'fulfilled') load.value.removeFromParent()
}

/**
 * Fills `scene` with a saved scene (`format.ts`) in place of what it held, its `helper` marks
 * excepted: every node, shape, material and light built again through the families, each loaded
 * model loaded again from its address, siblings in their order. `camera`, when given, is put where
 * the scene was saved from. Another format or version, or a model that cannot be loaded, is
 * refused by name and the scene is left as it was.
 */
export async function readScene(scene: Target, json: unknown, camera?: Camera) {
  assertSavedScene(json)
  const geometries = json.geometries.map(readGeometry)
  const materials = json.materials.map((m) => new Material(m.kind, m.parameters))
  /** Every model load started: `load` adds each model to the scene as it arrives. */
  const loads: Promise<Object3D>[] = []
  /** The last visible sky light node of a version-2 scene: the sky module's sky light now. */
  let skyLight: LegacySkyLight | undefined
  /** Every node built, by the saved node it was read from. */
  const built = new Map<SavedNode, Object3D>()
  const node = async (saved: SavedNode): Promise<Object3D> => {
    let o: Object3D
    if (saved.mesh) {
      o = readMesh(saved.mesh, saved.physics, geometries, materials)
    } else if (saved.light?.kind === 'sky') {
      if (saved.visible) skyLight = saved.light
      o = new Object3D() // its place and children stay; its light is the sky module's part
    } else if (saved.light) {
      o = readLight(saved.light, json.formatVersion, materials)
    } else if (saved.model) {
      const load = scene.load(saved.model.url)
      loads.push(load)
      o = await load
    } else if (saved.waterExclusion) {
      o = new WaterExclusionVolume()
      ;(o as WaterExclusionVolume).mode = saved.waterExclusion.mode
    } else o = saved.kind === 'group' ? new Group() : new Object3D()
    built.set(saved, o)
    wear(o, saved)
    const children = await Promise.all(saved.children.map(node))
    if (children.length) o.add(...children)
    return o
  }
  // The `helper` marks are how the scene is worked on: they stay, as `toJSON` left them out.
  const before = scene.children.filter((child) => !isHelper(child))
  let children: Object3D[]
  try {
    children = await Promise.all(json.children.map(node))
  } catch (error) {
    await dropLoads(loads)
    throw error
  }
  // The bodies a volume names are ranks in the saved tree read depth first.
  const ranked: Object3D[] = []
  const rankAll = (saved: SavedNode) => {
    ranked.push(built.get(saved)!)
    saved.children.forEach(rankAll)
  }
  json.children.forEach(rankAll)
  for (const [saved, o] of built)
    if (saved.waterExclusion)
      (o as WaterExclusionVolume).bodies = saved.waterExclusion.bodies.map((ref) => {
        const body =
          typeof ref === 'number'
            ? ranked[ref]
            : ref && (ranked[ref.model] as LoadedModel | undefined)?.getObjectByName(ref.name)
        // A body the save could not name keeps its place in the list, as a node that is in no scene.
        return body ?? new Object3D()
      })
  if (before.length) scene.remove(...before)
  if (children.length) scene.add(...children)
  scene.background = json.background && new Color().setRGB(...json.background)
  scene.sky = json.sky ?? legacySky(json, skyLight) ?? null
  if (camera && json.camera) readCamera(json.camera, camera)
}
