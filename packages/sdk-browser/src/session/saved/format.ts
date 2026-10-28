import type { OffsetSwitchValues } from '../../../../sdk-core/src/world/object/offsetSwitches.ts'
import type { SceneFog } from '../../../../sdk-core/src/scene/core/fog.ts'
import type { ResolvedAtmosphere } from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import type { ModuleOption } from '../../../../sdk-core/src/modules/descriptor.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { PhysicsOption } from '../../../../sdk-core/src/physics/options.ts'
import type { LightShaftParameters } from '../../../../sdk-core/src/world/light/lightShaftSettings.ts'
import type { LightCloudShadowParameters } from '../../../../sdk-core/src/world/light/lightCloudShadowSettings.ts'
import type { LightShadowParameters } from '../../../../sdk-core/src/world/light/lightShadowSettings.ts'
import type { LightContactShadowParameters } from '../../../../sdk-core/src/world/light/lightContactShadowSettings.ts'
import type { LightUnits } from '../../../../sdk-core/src/scene/light/lightUnits.ts'

/** The name a saved scene carries, and the version of its layout this runtime writes. Version 1
 *  wrote a mesh's `castShadow` as `false` by default, which the engine never read: it is refused.
 *  Version 2 wrote the air and the fog as `atmosphere` and `fog`, and the sky light as a light
 *  node: it is read, and moved into the sky module once (`read.ts`). Versions 2 and 3 wrote a
 *  rectangle light's intensity as its radiance, before a lamp's intensity had a unit: it is read as
 *  half that many nits, the same light (`read.ts`). Versions before 5 wrote a spot's cone as an
 *  `angle` and a `penumbra` share, and a lamp that named no unit was in candelas: they are read as
 *  an outer cone, an inner cone of the angle less that share, and the unit named. Versions before
 *  6 wrote a node's `receiveShadow`, which no pass read and the engine no longer holds: it is
 *  left unread. */
export const SCENE_FORMAT = 'trillion3d-scene'
export const SCENE_FORMAT_VERSION = 6
/** The versions this runtime reads. */
const READ_VERSIONS: readonly number[] = [2, 3, 4, 5, SCENE_FORMAT_VERSION]

/** A geometry: the family call that built it, or its vertices when no call can build it again. */
export interface SavedGeometry {
  /** The family member and every argument it was built with. */
  recipe?: { type: string; args: (number | boolean)[] }
  /** Each per-vertex list, when no call builds the shape again. */
  attributes?: Record<
    string,
    { itemSize: number; array: number[]; type: string; normalized: boolean }
  >
  /** Which vertices make each triangle. */
  index?: number[]
  /** Index ranges drawn with one material each. */
  groups?: { start: number; count: number; materialIndex: number }[]
  /** `'host'` for a loaded scene's vertices, read at their value (`Geometry._owner`); unset for
   *  the world's. */
  owner?: 'host'
}

/** A material: its kind and every parameter, colours as linear `[r, g, b]`. */
export interface SavedMaterial {
  /** The kind the material was made as: `'meshStandard'`, `'meshBasic'`… */
  kind: string
  /** Every parameter by name. */
  parameters: Record<string, unknown>
}

/** Where a node or the eye stands and how it is turned, from its parent. */
export interface SavedPose {
  /** Where it stands. */
  position: number[]
  /** How it is turned, as a quaternion. */
  quaternion: number[]
  /** The order its Euler angles turn in (`Object3D.rotation.order`); absent, `'XYZ'`. */
  rotationOrder?: string
  /** Which way is up for `lookAt` (`Object3D.up`); absent, +Y. */
  up?: number[]
}

/** A node: its pose and what it is — a group, a mesh, a light or a loaded model — and below it. */
export interface SavedNode extends SavedPose, OffsetSwitchValues {
  /** What the node is. */
  kind: 'object' | 'group' | 'mesh' | 'light' | 'model'
  /** Its name. */
  name: string
  /** How it is stretched on each axis. */
  scale: number[]
  /** Whether it is drawn. */
  visible: boolean
  /** Whether it casts shadows. */
  castShadow: boolean
  /** Whether its surface stays out of the lights' shadow maps; absent, it is drawn into them. */
  castsShadowMaps?: false
  /** Whether it is a far-field object, which the primed depth pyramid draws; absent, it is not. */
  farField?: true
  /** Its drawing order among see-through things. */
  renderOrder: number
  /** The page's own data, as JSON. */
  userData: Record<string, unknown>
  /** The nodes below it, in order. */
  children: SavedNode[]
  /** Ranks in `geometries` and `materials`, how the triangles are read, and a sprite's centre. */
  mesh?: {
    geometry: number
    material: number | number[]
    primitive: string
    center?: [number, number]
  }
  /** A light's kind, colours, numbers, aim and probe coefficients. */
  light?: {
    kind: string
    color: [number, number, number]
    groundColor: [number, number, number]
    values: Record<string, number>
    target: [number, number, number]
    sh: number[] | null
    /** A directional light left out of the atmosphere's candidates; absent, it is one. */
    atmosphereSun?: false
    /** A directional light set to the atmosphere's second light; absent, it is for the first. */
    atmosphereSunIndex?: 1
    /** A light whose shadow-on-fog setting is against its kind's default (`Light.shadowsFog`);
     *  absent, the default. */
    shadowsFog?: boolean
    /** A light whose mobility is not the default (`Light.mobility`); absent, `stationary`. */
    mobility?: 'static' | 'movable'
    /** A point or spot light taken off the inverse square (`Light.inverseSquared`); absent, it falls
     *  off as the inverse square. */
    inverseSquared?: false
    /** The unit a point, spot or rectangle light's intensity is written in (`Light.intensityUnits`)
     *  when it is not the default; absent, the default (`DEFAULT_LIGHT_UNITS`). */
    intensityUnits?: LightUnits
    /** A light whose colour follows its temperature (`Light.useTemperature`); absent, it does not. */
    useTemperature?: true
    /** A light that shines through the subsurface-profile surfaces it shadows (`Light.transmission`);
     *  absent, it does not. */
    transmission?: true
    /** A light that draws a deep shadow of the hair strands it reaches (`Light.castHairDeepShadow`);
     *  absent, it does not. */
    castHairDeepShadow?: true
    /** A directional light whose shadow shades the air (`Light.shadowsAir`); absent, it does not. */
    shadowsAir?: true
    /** A directional light whose air transmittance is read per surface point
     *  (`Light.transmittancePerPixel`); absent, it is not. */
    transmittancePerPixel?: true
    /** A directional light's sun-disk tint (`Light.sunDiskTint`) when it is not white. */
    sunDiskTint?: [number, number, number]
    /** The light shaft settings (`Light.shaft*`) that differ from their defaults; absent, none. */
    shafts?: LightShaftParameters
    /** The cloud shadow settings (`Light.cloudShadow*`) that differ from their defaults; absent, none. */
    cloudShadows?: LightCloudShadowParameters
    /** The contact shadow settings (`Light.contactShadow*`) that differ from their defaults; absent,
     *  none. */
    contactShadows?: LightContactShadowParameters
    /** The shadow settings (`Light.shadow*`, `Light.farShadow*`, `Light.distanceField*`) that differ
     *  from their defaults; absent, none. */
    shadows?: LightShadowParameters
    /** The light function the light wears (`Light.lightFunction`): its material's rank in
     *  `materials`, and the settings that differ from their defaults; absent, none. */
    lightFunction?: {
      material: number
      lightFunctionScale?: [number, number, number]
      lightFunctionFadeDistance?: number
      lightFunctionDisabledBrightness?: number
      lightFunctionConeAngle?: number
    }
  }
  /** A compiled model, by the manifest address it was loaded from: never inlined. */
  model?: { url: string }
  /** A mesh's body, as `mesh.physics` declares it. */
  physics?: PhysicsOption
}

/** The camera a scene was saved with: its pose, projection and optics. */
export interface SavedCamera extends SavedPose {
  /** Perspective or orthographic. */
  projection: 'perspective' | 'orthographic'
  /** Field, near, far, zoom and box, by name. */
  optics: Record<string, number>
  /** An orthographic box widened to the picture's shape (`fitAspect`); absent when off. */
  fitAspect?: boolean
}

/** A scene as `scene.toJSON` writes it and `scene.fromJSON` reads it: plain JSON. */
export interface SavedScene {
  /** Always `'trillion3d-scene'`. */
  format: typeof SCENE_FORMAT
  /** The version of this layout; one this runtime does not read is refused. */
  formatVersion: number
  /** The background colour, or `null`. */
  background: [number, number, number] | null
  /** The sky module's word as the scene held it (`scene.sky`); absent, none. */
  sky?: ModuleOption
  /** Version 2 only: the fog, its colour in linear components, or `null`. */
  fog?: SceneFog | null
  /** Version 2 only: the atmosphere, every field set; absent, none. */
  atmosphere?: ResolvedAtmosphere
  /** The camera saved with the scene, or `null`. */
  camera: SavedCamera | null
  /** Every shape, once, however many meshes wear it. */
  geometries: SavedGeometry[]
  /** Every material, once, however many meshes wear it. */
  materials: SavedMaterial[]
  /** The scene's top nodes, in order. */
  children: SavedNode[]
}

/** Refuses what is not a saved scene of the version this runtime reads, by name. */
export function assertSavedScene(value: unknown): asserts value is SavedScene {
  const saved = value as Partial<SavedScene> | null
  if (saved?.format !== SCENE_FORMAT || !READ_VERSIONS.includes(saved.formatVersion as number))
    throw new EngineError(
      'UNSUPPORTED_SCENE_FORMAT',
      `Not a saved scene of version ${READ_VERSIONS.join(' or ')}`,
      { format: saved?.format, formatVersion: saved?.formatVersion },
    )
}

/** Refuses a scene holding what a saved scene cannot store. */
export function notSavable(what: string, details: Record<string, unknown> = {}): never {
  throw new EngineError('SCENE_NOT_SAVABLE', `A saved scene cannot store ${what}`, details)
}
