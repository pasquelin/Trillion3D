import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { createScreenProbeParams } from './params.ts'
import {
  SCREEN_PROBE_FORMATS as F,
  SCREEN_PROBE_PARAMS_BYTES,
  geometryOfTile,
  type ScreenProbeGeometry,
} from './screenProbeLayout.ts'

/** The tile of pixels the short-range occlusion of the irradiance field is searched over, from its radius in pixels: the search reaches two tiles (`2 · sp.size.z`), the reference's `MaxScreenTraceFraction` of twice the radius. */
const TILE_RANGE = [4, 64] as const

/** The settings the field's short-range occlusion runs on: the view's, with the tile the radius names and no short-range global illumination (the bent normal follows the view's, as the reference's pass does for the field); none of the
 *  probes' passes runs, so nothing else of them is read. Made once for a settings object. */
const derived = new WeakMap<ScreenProbeSettings, ScreenProbeSettings>()
export function fieldOcclusionSettings(base: ScreenProbeSettings) {
  let settings = derived.get(base)
  if (!settings) {
    settings = {
      ...base,
      downsampleFactor: clamp(Math.round(base.irradianceField.shortRangeRadius), ...TILE_RANGE),
      shortRangeGi: false,
    }
    derived.set(base, settings)
  }
  return settings
}

/** Whether the field searches a short-range occlusion: the switch is on, its intensity above zero and its radius at least a pixel. */
export const fieldSearchesOcclusion = (base: ScreenProbeSettings) =>
  base.occlusion && base.irradianceField.shortRangeRadius >= 1

/**
 * THE FIELD'S SHORT-RANGE OCCLUSION RESOURCES: the screen probes' parameters (the occlusion pass reads the same uniform) with their writer, and the amount a texel of the pass writes, at the image's
 * size over the occlusion's reduction. Held by the screen probes' store; made again where the size or the reduction moved.
 */
export interface FieldOcclusion {
  readonly key: string
  readonly params: GPUBuffer
  readonly write: ReturnType<typeof createScreenProbeParams>
  readonly previousInverse: Float64Array
  readonly view: GPUTextureView
  geometry: ScreenProbeGeometry | undefined
  /** The pass's bind group and the identity of what it names (the surfaces' normals and flags, the noise, the layout). */
  group: GPUBindGroup | undefined
  readonly identity: ReturnType<typeof createWebgpuBindIdentity>
  dispose(): void
}

/** The resources for an image of `size` at `settings` (`fieldOcclusionSettings`): the held ones where they are those. */
export function ensureFieldOcclusion(
  held: FieldOcclusion | undefined,
  device: GPUDevice,
  size: readonly [number, number],
  settings: ScreenProbeSettings,
): FieldOcclusion {
  const key = `${size[0]}x${size[1]}:${settings.occlusionDownsample}:${settings.bentNormal}`
  if (held?.key === key) return held
  if (held) held.dispose()
  const params = device.createBuffer({
    label: 'Trillion3D irradiance field occlusion parameters',
    size: SCREEN_PROBE_PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const texture = device.createTexture({
    label: 'Trillion3D irradiance field occlusion',
    size: [
      ceilDiv(size[0], settings.occlusionDownsample),
      ceilDiv(size[1], settings.occlusionDownsample),
    ],
    format: settings.bentNormal ? F.bentOcclusion : F.occlusion,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const run: FieldOcclusion = {
    key,
    params,
    write: createScreenProbeParams(device, params),
    previousInverse: new Float64Array(16),
    view: texture.createView(),
    geometry: undefined,
    group: undefined,
    identity: createWebgpuBindIdentity(),
    dispose() {
      retire(device, { destroy: () => (params.destroy(), texture.destroy()) })
    },
  }
  return run
}

/** The geometry of an image of `size` at `settings`, held. */
export function fieldOcclusionGeometry(
  run: FieldOcclusion,
  size: readonly [number, number],
  settings: ScreenProbeSettings,
) {
  const held = run.geometry
  if (held && held.width === size[0] && held.height === size[1]) return held
  return (run.geometry = geometryOfTile(size[0], size[1], settings.downsampleFactor, settings))
}
