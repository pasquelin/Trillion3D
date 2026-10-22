import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { SceneLink } from '../../../../sdk-core/src/world/object/sceneLink.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { Color } from '../../../../sdk-core/src/world/math/color.ts'
import { listen, unlisten } from '../../../../sdk-core/src/world/observed.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import type { LoadedModel } from './models/loadedModel.ts'
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { saveScene } from '../saved/write.ts'
import { readScene } from '../saved/read.ts'
import type { SavedScene } from '../saved/format.ts'
import type { JobProgress } from '../../../../sdk-core/src/runtime/jobs/jobs.ts'
import { validateSceneFog } from '../../../../sdk-core/src/scene/core/fog.ts'
import {
  validateSceneAtmosphere,
  type ResolvedAtmosphere,
  type SceneAtmosphere,
} from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import { sceneFogOf, type Fog } from './sceneFog.ts'

/** What `scene.load` may be told about the model it loads; every field is optional. */
export interface LoadOptions {
  /** Stops the load when the signal is aborted. */
  signal?: AbortSignal
  /** `'full'` requires the whole cache, `'progressive'` its streamed slice; a model of another
   *  scope is refused by name. Unset, the model is read at the scope its pointer declares. */
  scope?: 'full' | 'progressive'
  /** A streamer the page configured; the world's session streams with its own. */
  stream?: unknown
  /** Where the model's origin goes in the scene. */
  position?: readonly [number, number, number] | { x: number; y: number; z: number }
  /** Hears how far the load has got: `bytes` at each chunk of every file read, up to
   *  `completed === total`; `manifest` once the manifest is read, `tables` once the scene tables
   *  are, then `resources` as each file the scene reads lands (`completed` of `total` known so
   *  far). The event is a `JobProgress`: a `createJob` wrapping the load passes its `progress`
   *  here, and `world.awaitPages` hears the first pages on the same shape. */
  onProgress?: (event: JobProgress) => void
}

/** What reads the models `Scene.load` adds; `added` hears each once the scene holds it. */
export type SceneLoader = ((url: string, options: LoadOptions) => Promise<LoadedModel>) & {
  added?: (model: LoadedModel) => void
}

/** What a world hears from its scene: a node's changes, its background, its fog and its
 *  atmosphere set or written. */
export type WorldSceneLink = SceneLink & { background(): void; fog(): void; atmosphere(): void }

/**
 * The root of a world's scene: objects are added to it, a compiled model is loaded into it, and
 * what fills the image behind them is `background`.
 */
export class Scene extends Object3D {
  /** Always `true`: tells the scene root apart from any other object. */
  get isScene() {
    return true as const
  }
  private _background: Color | null = null
  /** Tells the world the background changed, chained on the colour to hear writes in place; a
   *  link that is no world's hears neither the background nor the fog. */
  private readonly recoloured = () => (this._link as Partial<WorldSceneLink> | null)?.background?.()
  /** A picture of the surroundings; `null` for none. */
  environment: Texture | null = null
  private _fog: Fog | null = null
  /** Tells the world the fog changed, chained on its colour to hear writes in place. */
  private readonly refogged = () => (this._link as Partial<WorldSceneLink> | null)?.fog?.()

  private _atmosphere: SceneAtmosphere | true | null = null
  private _air: ResolvedAtmosphere | undefined

  /** Called before the scene is drawn; none by default. */
  declare onBeforeRender?: () => void
  /** Called once the scene is drawn; none by default. */
  declare onAfterRender?: () => void
  // Written only when used, as `reading` is: a scene the engine builds holds neither.
  declare private readonly loader?: SceneLoader
  /** A scene; `loader` reads the models `load` adds, and a scene built without one loads none. */
  constructor(loader?: SceneLoader) {
    super()
    if (loader) this.loader = loader
    this.type = 'Scene'
  }
  /** Refused: a world has one scene root, never cloned. */
  protected override blank(): this {
    throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'A Scene cannot be cloned: a world has one')
  }
  /** What fills the image behind every object: a colour, or `null` for the default. A change
   *  shows at the next frame, the session kept: a new colour set here, or the one held written
   *  through its methods (`set`, `setRGB`, `setHex`, `setHSL`...). A direct write of `.r`, `.g`
   *  or `.b` is not heard: set `background` again after one. A picture, or any value without
   *  `getHex`, is refused (`UNSUPPORTED_SCENE_UPDATE`): no path draws one. */
  get background() {
    return this._background
  }
  set background(value: Color | null) {
    if (value != null && typeof (value as { getHex?: unknown }).getHex !== 'function')
      throw new EngineError(
        'UNSUPPORTED_SCENE_UPDATE',
        'scene.background takes a colour or null: a picture background is not drawn',
      )
    if (this._background) unlisten(this._background, this.recoloured)
    this._background = value ?? null
    if (value) listen(value, this.recoloured)
    this.recoloured()
  }
  /** Fog over every surface, opaque and transparent; `null`, the default,
   *  for none, at no cost. `{ color, near, far }` fades objects into `color` from `near` to `far`,
   *  distances from the camera; `{ color, density }` thickens by `density` per unit of distance;
   *  add `heightFalloff` (and `baseHeight`, 0 by default) and it lies on the ground, thinning out
   *  above `baseHeight` — divided by e every `1 / heightFalloff` units up. The height fog's own
   *  fields (`SceneHeightFog`: `baseDensity`, `falloff`, `maxOpacity`, `startDistance`,
   *  `cutoffDistance`, the sun's `directional` lobe, `skyContribution`, every one with its default,
   *  `{}` the default fog) say the same law in base 2, in metres (`fogHeight.ts`).
   *  A change shows at the next frame: a new fog set here, or its colour written through its
   *  methods. A direct write of `near`, `far`, `density`... is not heard: set `fog` again after
   *  one. A fog out of range — `far` not beyond `near`, a negative density — is refused
   *  (`INVALID_SCENE_ENVIRONMENT`). */
  get fog() {
    return this._fog
  }
  set fog(value: Fog | null) {
    if (value) validateSceneFog(sceneFogOf(value)!)
    if (this._fog?.color) unlisten(this._fog.color, this.refogged)
    this._fog = value ?? null
    if (value?.color) listen(value.color, this.refogged)
    this.refogged()
  }
  /** The planet's air: the sky behind every surface, the haze over the distance, and the sun's
   *  light tinted by what it crosses; `null`, the default, for none, at no cost. `true` is an
   *  Earth-like atmosphere; an object sets any of its fields over those defaults (`planetRadius`
   *  and `height` in kilometres, the scattering coefficients per kilometre, `groundHeight` in
   *  metres: the height of the planet's ground in the scene, 0 by default). The sun is the
   *  brightest directional light (`light.directional({ atmosphereSun: false })` leaves one out);
   *  `light.sky()` lights the scene from the sky. Where the atmosphere is on, `background` is not
   *  shown. A change shows at the next frame: set `atmosphere` again after writing a field of
   *  it. A value out of range — a negative radius, an anisotropy outside (−1, 1) — is refused
   *  (`INVALID_SCENE_ENVIRONMENT`). */
  get atmosphere() {
    return this._atmosphere
  }
  set atmosphere(value: SceneAtmosphere | true | null) {
    this._air = value ? validateSceneAtmosphere(value) : undefined
    this._atmosphere = value ?? null
    ;(this._link as Partial<WorldSceneLink> | null)?.atmosphere?.()
  }
  /** The atmosphere with every field set, what the lighting reads; none without one. */
  get resolvedAtmosphere() {
    return this._air
  }
  /** Loads a compiled model — its manifest URL — and adds it to this scene. A manifest this world
   *  loaded already is not read again: the model returned is another placement of it, its own
   *  position, rotation and visibility over the same pages, images and buffers, each placement
   *  drawn at the detail its own distance asks. */
  async load(manifestUrl: string, options: LoadOptions = {}) {
    if (!this.loader)
      throw new EngineError(
        'UNSUPPORTED_SCENE_UPDATE',
        'This scene loads no model: it has no world',
      )
    const model = await this.loader(manifestUrl, options)
    try {
      const at = options.position
      if (at) {
        if (Array.isArray(at)) model.position.set(at[0], at[1], at[2])
        else model.position.copy(at as { x: number; y: number; z: number })
      }
      this.add(model)
    } finally {
      // Held by the scene, or not at all: the loader stops waiting for it (`loader.ts`).
      this.loader.added?.(model)
    }
    return model
  }
  /** The scene as plain JSON, versioned: its objects, shapes by the call that built them,
   *  materials, lights, each mesh's body as declared and loaded models by address; `camera`'s
   *  pose too when one is given.
   *  @param camera - A camera to save with the scene, `world.camera` most often. */
  toJSON(camera?: Camera): SavedScene {
    return saveScene(this, camera)
  }
  /** Replaces what the scene holds with a scene `toJSON` saved, its `helper` marks kept;
   *  resolves once its models are loaded. Another format or version is refused
   *  (`UNSUPPORTED_SCENE_FORMAT`). Calls made while one is reading run one after the other, in
   *  order, each on what the one before left: two saved scenes never merge.
   *  @param json - The saved scene. @param camera - A camera to put where the scene was saved from. */
  fromJSON(json: unknown, camera?: Camera) {
    const read = () => readScene(this, json, camera)
    const next = (this.reading ?? Promise.resolve()).then(read, read)
    this.reading = next.catch(() => undefined)
    return next
  }
  /** The last `fromJSON` under way, settled or not: the next one waits for it. */
  declare private reading?: Promise<void>
}
