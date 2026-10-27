import type { PhysicsMaterialPreset } from '../../physics/options.ts'
import type { MaterialParameters } from './materialParameters.ts'
import { alphaModeOf, type Material as EngineMaterial } from '../../contracts/material.ts'
import {
  resolveVolumeMaterial,
  VOLUME_MATERIAL_KIND,
  type MaterialDomain,
  type VolumeMaterial,
} from '../../contracts/volumeMaterial.ts'
import { Color, type ColorInput } from '../math/color.ts'
import { listen, unlisten } from '../observed.ts'
import { createListeners, type Listeners } from '../../runtime/listeners.ts'
import {
  DEFAULT_TRANSLUCENCY_LIGHTING,
  type Blending,
  type Side,
  type TranslucencyLighting,
  type TranslucencyPass,
} from '../constants/index.ts'
import {
  forgetLightFunctionMaterial,
  LIGHT_FUNCTION_MATERIAL_KIND,
} from './lightFunctionMaterial.ts'
import { MaterialGraph } from './graph/api.ts'
import type { GraphData } from './graph/graph.ts'
import { graphError } from './graph/valueType.ts'

/** The fields whose value is a colour: written through `Color`, whatever the page passes. Every
 *  surface and table that carries a colour reads this list. */
export const MATERIAL_COLOURS: ReadonlySet<string> = new Set([
  'color',
  'emissive',
  'albedo',
  'specular',
  'sheenColor',
  'specularColor',
  'attenuationColor',
  'subsurfaceColor',
])
/** The texture fields that hold a colour: the only ones whose sRGB image is decoded. The others
 *  hold data — a direction, a roughness, an occlusion — read as stored whatever the image
 *  declares, as the WebGPU path reads them. */
export const COLOUR_MAPS: ReadonlySet<string> = new Set([
  'map',
  'emissiveMap',
  'matcap',
  'subsurfaceMap',
  'sheenColorMap',
  'specularColorMap',
])
/** A value that may be heard: a texture keeps its hearers in `_listeners`. */
type Heard = { isTexture?: boolean; _listeners?: Listeners }
/** The fields that are a material's bookkeeping, never one of its parameters. */
export const MATERIAL_BOOKKEEPING: ReadonlySet<string> = new Set([
  'isMaterial',
  'version',
  '_listeners',
  'heard',
])

/**
 * The matter alone: the parameters of one material kind. The engine lights every kind with its
 * one surface model (`contracts/material.ts`); `surface()` is how a kind reads in that model. Any
 * write — a field, a colour, `needsUpdate` — reaches the meshes that wear it.
 */
export class Material {
  /** Always `true`: tells a material apart from anything else. */
  readonly isMaterial = true as const
  /** The base colour; change it in place with `set`. */
  color = new Color(0xffffff)
  /** The colour the surface gives off by itself. */
  emissive = new Color(0x000000)
  /** How strongly the surface glows. */
  emissiveIntensity = 1
  /** Diffuse transmission tint of thin double-sided matter; black disables it. */
  subsurfaceColor = new Color(0x000000)
  /** How much the surface is metal, 0 to 1. */
  metalness = 0
  /** How rough the surface is, 0 (mirror) to 1 (matte). */
  roughness = 1
  /** How opaque the surface is, 0 to 1. */
  opacity = 1
  /** Whether `opacity` lets what is behind show through. */
  transparent = false
  /** Which faces are drawn: `'front'`, `'back'` or `'double'`. */
  side: Side = 'front'
  /** How the surface mixes with what is behind it. */
  blending: Blending = 'normal'
  /** Pixels less opaque than this are dropped. */
  alphaTest = 0
  /** Whether the geometry's per-vertex colours tint the surface. */
  vertexColors = false
  /** Whether the surface writes its depth. */
  depthWrite = true
  /** Whether the surface hides behind closer things. */ depthTest = true
  /** Whether the `emissive` output of the material's graph may be negative: held at zero unless it is. */ allowNegativeEmissive = false
  /** The value the `opacityMask` output of the material's graph must reach for a pixel to be drawn: unset, the `alphaTest` where above 0, else 0.3333. */ declare opacityMaskClipValue?: number
  /** Whether the `opacityMask` output of the material's graph cuts by a dither of the output instead of a hard threshold. */ ditherOpacityMask = false
  /** Whether a double-sided see-through surface is drawn in two passes, its back faces then its front faces. */ twoSidedPasses = false
  /** Whether the roughness is raised to at least the one the change of the vertex normal across the pixel gives it. */ normalCurvatureToRoughness = false
  /** The greatest distance in metres along each axis the `worldPositionOffset` output may move a vertex, which also grows the bounds of the surface's clusters; 0 holds nothing and grows nothing. */ maxWorldPositionOffset = 0
  /** Whether the `worldPositionOffset` output is evaluated whatever the object's switch (`Object3D.evaluateWorldPositionOffset`) and its distance (`worldPositionOffsetDisableDistance`) say. */ alwaysEvaluateWorldPositionOffset = false
  /** How far, in metres, the `displacement` output of the material's graph moves a surface along its normal where it is 1 above where it is `displacementCenter`: the displaced height is `(output - displacementCenter) * displacementMagnitude`. */ displacementMagnitude = 4
  /** The value of the `displacement` output that leaves the surface where it is, from 0 to 1. */ displacementCenter = 0.5
  /** Where the displacement of the surface fades out with distance, as the on-screen size in pixels of its largest displacement: whole above `displacementFadeStart`, gone below `displacementFadeEnd` (which is the smaller). Both unset, it never fades. */ declare displacementFadeStart?: number
  /** See `displacementFadeStart`. */ declare displacementFadeEnd?: number
  /** Whether a see-through surface receives the clouds in front of it as part of its fog: a rough approximation that can help where it lies behind a cloud. It needs the fog (`fog`). */ cloudFog = false
  /** Whether the fog of a see-through surface is worked out for each pixel instead of each vertex and interpolated: the exact fog, at the cost of a fog computed in every pixel of the surface. A surface of a large triangle, or one close enough to the fog's start to show its steps, wants it. */ computeFogPerPixel = false
  /** Whether the lights cast contact shadows on a see-through surface lit with `translucencyLighting: 'forward'` or a transmissive one: a short ray from each pixel toward each light through the opaque scene's depth (never a water's), a ray a light in every pixel.
   *  @example material.meshStandard({ transparent: true, opacity: 0.3, translucencyLighting: 'forward', contactShadows: true }) */ contactShadows = false
  /** How the lights light a see-through surface: `'volumetricNonDirectional'` (the default), read from the translucency lighting volume (`translucencyVolume`, a field of the light around the camera) as a medium with no direction; `'volumetric'`, as a medium; `'volume'`, as a surface; `'forward'`, each light evaluated for the pixel. A material imported from a scene file is given `'volume'`, or `'forward'` where it transmits. */ translucencyLighting: TranslucencyLighting =
    DEFAULT_TRANSLUCENCY_LIGHTING
  /** The pass of the image a see-through surface is drawn in: `'afterDepthOfField'` (the default), apart from the scene and laid over the image once the depth of field has read it, so that no blur reaches it; `'beforeDepthOfField'`, into the scene, blurred with it; `'afterMotionBlur'`, laid over the image after the temporal anti-aliasing and the motion blur, so neither smears it. */ translucencyPass: TranslucencyPass =
    'afterDepthOfField'
  /** Whether the shadow of a point, spot or rectangle light reaches a see-through surface even where the project switch `shadowTranslucentLocalLights` is off. It is read as `translucentLocalLightShadowQuality` says. */ translucentLocalLightShadow = false
  /** How a see-through surface reads the shadow of the local lights that reach it, from 0 to 1: above 0 the full trace the opaque surfaces get, at 0 one sample of the light's map (unless the project switch `shadowTranslucentQuality` traces every translucent surface). Needs `translucentLocalLightShadow`, or the project switch `shadowTranslucentLocalLights`, for the lights to be shadowed at all. */ translucentLocalLightShadowQuality = 0
  /** How a see-through surface reads the sun's shadow, from 0 to 1: above 0 the full trace the opaque surfaces get, at 0 one sample of the sun's map (unless the project switch `shadowTranslucentQuality` traces every translucent surface). */ translucentDirectionalLightShadowQuality = 0
  /** Physics matter preset of the bodies wearing it. */ declare physics?: PhysicsMaterialPreset
  /** kg/m³, for a body's mass. */ declare density?: number
  /** Physics friction. */ declare friction?: number
  /** Physics restitution. */ declare restitution?: number
  /** The graph wired into this material's outputs (`material.graph(domain)`), or none: its
   *  outputs replace the parameters they stand for. A graph of another domain than the material's is
   *  refused. */
  declare graph?: MaterialGraph
  /** Bumped by every write: what the world compares to repaint. */
  version = 0
  /** Who wears this material: every mesh holding it hears its writes. */
  readonly _listeners = createListeners();
  [param: string]: unknown
  /** Tells every wearer this material changed. */
  private readonly heard = () => {
    this.version++
    this._listeners.emit()
  }

  /** The kind the material was made as: `'meshStandard'`, `'meshBasic'`… */
  readonly kind: string
  constructor(
    kind: string,
    parameters: MaterialParameters = {},
    defaults: Partial<MaterialParameters> = {},
  ) {
    this.kind = kind
    const changed = this.heard
    listen(this.color, changed)
    listen(this.emissive, changed)
    listen(this.subsurfaceColor, changed)
    for (const [key, value] of Object.entries({ ...defaults, ...parameters }))
      if (value !== undefined) this.assign(key, value)
    // Every field written from here on is a change the meshes wearing it must see.
    return new Proxy(this, {
      set(target, key, value) {
        if (typeof key === 'string' && key !== 'version') target.assign(key, value)
        else Reflect.set(target, key, value)
        if (key !== 'version') changed()
        return true
      },
    })
  }
  private assign(key: string, value: unknown) {
    if (key === 'graph') return this.assignGraph(value)
    const current = this[key]
    if (MATERIAL_COLOURS.has(key) && !(value instanceof Color)) {
      // A colour written as a value: into the held `Color`, or a new one heard like the others.
      if (current instanceof Color) current.set(value as ColorInput)
      else listen((this[key] = new Color(value as ColorInput)), this.heard)
      return
    }
    if (current !== value) this.release(key, current)
    this[key] = value
    // A colour or a texture this material holds is heard like the material itself.
    if (MATERIAL_COLOURS.has(key)) listen(value as Color, this.heard)
    const sampled = value as Heard | null
    if (sampled?.isTexture) sampled._listeners?.subscribe(this.heard)
  }
  /** Holds the graph `value` (a `MaterialGraph`, or its saved data), heard like a texture; none
   *  clears it. */
  private assignGraph(value: unknown) {
    const next =
      value === undefined || value === null
        ? undefined
        : value instanceof MaterialGraph
          ? value
          : MaterialGraph.fromJSON(value as GraphData)
    if (next && next.domain !== this.domain)
      throw graphError(`a ${next.domain} graph cannot be worn by a ${this.domain} material`)
    this.graph?._listeners.unsubscribe(this.heard)
    next?._listeners.subscribe(this.heard)
    if (next) this.graph = next
    else delete this.graph
  }
  /** Stops hearing what `key` held, unless another field of this material still holds it. */
  private release(key: string, held: unknown) {
    const texture = (held as Heard | null)?.isTexture
    if (!(held instanceof Color) && !texture) return
    for (const other in this) if (other !== key && this[other] === held) return
    if (held instanceof Color) unlisten(held, this.heard)
    else (held as Heard)._listeners?.unsubscribe(this.heard)
  }
  /** `material.needsUpdate = true`: the meshes wearing it are repainted. */
  set needsUpdate(_value: boolean) {}
  get needsUpdate() {
    return false
  }
  /** The domain the material is authored in: a volume material (`material.volume`) is voxelised
   *  into the fog's volume where its mesh stands and draws no surface. */
  get domain(): MaterialDomain {
    if (this.kind === LIGHT_FUNCTION_MATERIAL_KIND) return 'lightFunction'
    return this.kind === VOLUME_MATERIAL_KIND ? 'volume' : 'surface'
  }
  /** The emissive colour times its intensity, as three numbers. */
  private emitted() {
    return this.emissive.toArray().map((c) => c * this.emissiveIntensity)
  }
  /** The outputs of a material of the volume domain, held to their ranges: its albedo, its
   *  extinction and its emissive light (`emissive` times `emissiveIntensity`). */
  volumeOutputs(): VolumeMaterial {
    const emissive = this.emitted()
    return resolveVolumeMaterial({
      albedo: (this.albedo as Color | undefined)?.toArray(),
      extinction: this.extinction as number | undefined,
      emissive: emissive as [number, number, number],
      emissiveOnly: this.emissiveOnly as boolean | undefined,
    })
  }
  /** The engine's physical surface record of this material (`contracts/material.ts`). A kind
   *  outside the physical family is drawn through the host family of its name, which the engine
   *  maps onto its one lighting model (`surfaceModel.ts`). */
  surface(): EngineMaterial {
    const emitted = this.emitted()
    return {
      baseColor: this.color.toArray(),
      emissive: emitted as [number, number, number],
      opacity: this.opacity,
      metalness: this.metalness,
      roughness: this.roughness,
      side: this.side,
      alphaMode: alphaModeOf(this),
      alphaCutoff: this.alphaTest,
    }
  }
  /** A new material of the same kind, with the same values. */
  clone() {
    const parameters: MaterialParameters = {}
    for (const [key, value] of Object.entries(this))
      if (key !== 'kind' && !MATERIAL_BOOKKEEPING.has(key))
        parameters[key] =
          value instanceof Color || value instanceof MaterialGraph ? value.clone() : value
    return new Material(this.kind, parameters)
  }
  /** Forgets the wearers: a disposed material repaints nobody. */
  dispose() {
    forgetLightFunctionMaterial(this)
    this.graph?._listeners.unsubscribe(this.heard)
    this._listeners.clear()
  }
}
