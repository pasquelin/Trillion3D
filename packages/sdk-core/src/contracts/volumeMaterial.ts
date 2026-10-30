import { EngineError } from './cache.ts'
import type { LinearRgb } from './material.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

/**
 * THE VOLUME MATERIAL DOMAIN: a material whose object is not drawn as a surface but voxelised into
 * the fog's volume, where it adds to the medium. A material is of the `surface` domain unless it is
 * made as a `volume` one (`material.volume`, `../world/material/index.ts`). Its outputs are three:
 * the albedo, the extinction (the fraction of light a metre of it takes away) and the emissive
 * light. The object it covers is a box (any mesh) or a sphere (a particle).
 */

/** The domains a material may be authored in: the light function domain is `material.lightFunction`
 *  (`../world/material/lightFunctionMaterial.ts`), the post-process domain `material.postProcess`
 *  (`../world/material/postProcessMaterial.ts`). */
export const MATERIAL_DOMAINS = ['surface', 'volume', 'lightFunction', 'postProcess'] as const
/** A material's domain. */
export type MaterialDomain = (typeof MATERIAL_DOMAINS)[number]
/** The kind name of a material of the volume domain (`Material.kind`). */
export const VOLUME_MATERIAL_KIND = 'volume'

/** The greatest an extinction or an emissive channel is held to: what a half float holds. */
export const VOLUME_OUTPUT_LIMIT = 65000
/** The share of the fog's distance past which a voxelised object fades out: it is full up to 0.6 of
 *  it, and gone at the distance itself, by the cube of a linear ramp. */
export const VOLUME_FADE_START = 0.6

/** The outputs of a volume material, as a host writes them; every field is optional. */
export interface VolumeMaterialOptions {
  /** The share of the light each channel scatters, linear, in [0, 1] (held to it); white by
   *  default. */
  albedo?: LinearRgb
  /** The fraction of light a metre of the object takes away, 0 or more (held to 65 000); 0 by
   *  default, so an object that names none adds no medium. */
  extinction?: number
  /** The light the object gives off per metre, linear, 0 or more (held to 65 000); black by
   *  default. */
  emissive?: LinearRgb
  /** True: only the emissive light counts, the albedo and the extinction are zero (the unlit
   *  shading model of the domain). False by default. */
  emissiveOnly?: boolean
}

/** A volume material with every output set and held to its range. */
export interface VolumeMaterial {
  albedo: LinearRgb
  extinction: number
  emissive: LinearRgb
  emissiveOnly: boolean
}

/** The defaults of a volume material's outputs. */
const VOLUME_MATERIAL_DEFAULTS = {
  albedo: [0, 0, 0],
  extinction: 0,
  emissive: [0, 0, 0],
  emissiveOnly: false,
} as const satisfies Required<VolumeMaterialOptions>

function refuse(message: string): never {
  throw new EngineError('INVALID_MATERIAL', `volume material: ${message}`, {})
}

/** A colour of three finite numbers ≥ 0, else refused by `name`. */
function colour(value: unknown, name: string): LinearRgb {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((c) => Number.isFinite(c) && c >= 0)
  )
    refuse(`${name} expects three finite numbers ≥ 0`)
  return [value[0], value[1], value[2]]
}

const held = (value: number) => clamp(value, 0, VOLUME_OUTPUT_LIMIT)

/**
 * The volume material `option` writes: the albedo held to [0, 1], the extinction and the emissive
 * to [0, 65 000], an output left out at its default, and — for the emissive-only model — the
 * albedo and the extinction zero.
 * @throws EngineError `INVALID_MATERIAL` naming the output when one is not a finite number ≥ 0
 * (three for a colour), or the switch is not a boolean.
 */
export function resolveVolumeMaterial(option: VolumeMaterialOptions = {}): VolumeMaterial {
  const d = VOLUME_MATERIAL_DEFAULTS
  const { extinction = d.extinction, emissiveOnly = d.emissiveOnly } = option
  if (typeof extinction !== 'number' || !Number.isFinite(extinction) || extinction < 0)
    refuse('extinction expects a finite number ≥ 0')
  if (typeof emissiveOnly !== 'boolean') refuse('emissiveOnly expects a boolean')
  const albedo = colour(option.albedo ?? d.albedo, 'albedo')
  const emissive = colour(option.emissive ?? d.emissive, 'emissive')
  return {
    albedo: emissiveOnly ? [0, 0, 0] : (albedo.map((c) => Math.min(c, 1)) as unknown as LinearRgb),
    extinction: emissiveOnly ? 0 : held(extinction),
    emissive: emissive.map(held) as unknown as LinearRgb,
    emissiveOnly,
  }
}
