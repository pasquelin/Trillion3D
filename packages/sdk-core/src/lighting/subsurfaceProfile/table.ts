import { toHalf } from '../../../../math/src/float/half.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { diffuseMeanFreePathOf, meanFreePathOf, type Rgba } from './burleyMath.ts'
import { mirroredKernel, transmissionProfileSamples } from './burleyTables.ts'
import { defaultSkinProfile, upgradedProfile, type SubsurfaceProfile } from './profile.ts'

/** The texel columns of a row of the table, in order: the tint and world unit scale, the surface
 *  albedo, the diffuse mean free path, the transmission terms, the boundary colour bleed, the dual
 *  specular, the three kernels and the transmission profile. */
export const PROFILE_COLUMNS = {
  tint: 0,
  albedo: 1,
  dmfp: 2,
  transmission: 3,
  boundary: 4,
  dualSpecular: 5,
  kernel0: 6,
  kernel0Size: 13,
  kernel1: 19,
  kernel1Size: 9,
  kernel2: 28,
  kernel2Size: 6,
  transmissionProfile: 34,
  transmissionProfileSize: 32,
} as const

/** The width of the table in texels. */
export const PROFILE_TABLE_WIDTH =
  PROFILE_COLUMNS.transmissionProfile + PROFILE_COLUMNS.transmissionProfileSize

/** The rows a table holds at most (one per profile, the default skin first). */
const MAX_SUBSURFACE_PROFILES = 256

const KERNEL_RADIUS_SCALE = 1024
/** The roughness the table's dual specular scales are over: a scale of one is this. */
export const MAX_DUAL_SPECULAR_ROUGHNESS = 2
const MAX_DMFP_CODE = 1 / (0.01 * 0.2)
const WORLD_UNIT_CODE = 0.02
const EXTINCTION_CODE = 0.01
/** A floor so no channel is zero: that would divide by zero or jump to another value. */
const CHANNEL_FLOOR = 0.009
const UNIT_SPAN = 0x10000
/** The largest float under 65536: scaled and truncated, a value in 0..1 spreads evenly over the
 *  sixteen bits and never reaches 65536. */
const SPAN_SCALE = UNIT_SPAN - 1 / 256

const rgba = (c: readonly number[], a = 1): Rgba => [c[0]!, c[1]!, c[2]!, a]
const clampedRgba = (c: readonly number[], lo: number): Rgba => rgba(c.map((v) => clamp(v, lo, 1)))

type ProfileData = ReturnType<typeof upgradedProfile>

/** The dual specular texel: both roughnesses, the mix between the lobes and their mixed roughness,
 *  each over `MAX_DUAL_SPECULAR_ROUGHNESS`. */
function dualSpecularTexel(data: ProfileData): Rgba {
  const roughnessMix = data.roughness0 * (1 - data.lobeMix) + data.roughness1 * data.lobeMix
  return [
    clamp(data.roughness0 / MAX_DUAL_SPECULAR_ROUGHNESS, 0, 1),
    clamp(data.roughness1 / MAX_DUAL_SPECULAR_ROUGHNESS, 0, 1),
    data.lobeMix,
    clamp(roughnessMix / MAX_DUAL_SPECULAR_ROUGHNESS, 0, 1),
  ]
}

/** The transmission texel: extinction, normal scale, scattering distribution and inverse index. */
const transmissionTexel = (data: ProfileData): Rgba => [
  data.extinctionScale * EXTINCTION_CODE,
  data.normalScale,
  (data.scatteringDistribution + 1) / 2,
  1 / data.ior,
]

/** Writes the three mirrored kernels into their columns of `row`. */
function spliceKernels(row: Rgba[], albedo: Rgba, dmfp: Rgba, scatterRadius: number) {
  const kernels = [
    ['kernel0', 'kernel0Size'],
    ['kernel1', 'kernel1Size'],
    ['kernel2', 'kernel2Size'],
  ] as const
  for (const [at, size] of kernels) {
    row.splice(
      PROFILE_COLUMNS[at],
      PROFILE_COLUMNS[size],
      ...mirroredKernel(PROFILE_COLUMNS[size], albedo, dmfp, scatterRadius),
    )
  }
}

/** The texels of one row of the table, as floats. */
function rowTexels(source: SubsurfaceProfile, samplingChannel: number): Rgba[] {
  const data = upgradedProfile(source),
    row: Rgba[] = Array.from({ length: PROFILE_TABLE_WIDTH }, () => [0, 0, 0, 0])
  const tint = clampedRgba(data.tint, 0),
    transmissionTint = clampedRgba(data.transmissionTintColor, CHANNEL_FLOOR),
    albedo = clampedRgba(data.surfaceAlbedo, CHANNEL_FLOOR),
    mfp = clampedRgba(data.meanFreePathColor, CHANNEL_FLOOR)
  row[PROFILE_COLUMNS.tint] = [tint[0], tint[1], tint[2], data.worldUnitScale * WORLD_UNIT_CODE]

  const dmfp: Rgba = [0, 0, 0, 0]
  for (let c = 0; c < 3; c++) {
    dmfp[c] = diffuseMeanFreePathOf(albedo[c]!, mfp[c]! * data.meanFreePathDistance) * 10
  }
  // the channel that sets the sampling is kept in alpha: the largest diffuse mean free path (selection 0) or the largest mean free
  // path (selection 1)
  const reach = [0, 1, 2].map((c) =>
      samplingChannel === 0 ? dmfp[c]! : meanFreePathOf(albedo[c]!, dmfp[c]!),
    ),
    maxReach = Math.max(...reach),
    index = reach.findIndex((v) => v === maxReach)
  albedo[3] = albedo[index]!
  dmfp[3] = dmfp[index]!
  for (let c = 0; c < 4; c++) dmfp[c] = clamp(dmfp[c]!, 0, MAX_DMFP_CODE)
  row[PROFILE_COLUMNS.albedo] = albedo
  row[PROFILE_COLUMNS.dmfp] = dmfp.map((v) => v / MAX_DMFP_CODE) as Rgba
  row[PROFILE_COLUMNS.boundary] = [
    ...(data.boundaryColorBleed as [number, number, number]),
    data.implementation === 'importanceSampling' ? 0 : 1,
  ]
  row[PROFILE_COLUMNS.dualSpecular] = dualSpecularTexel(data)
  row[PROFILE_COLUMNS.transmission] = transmissionTexel(data)

  const scatterRadius = Math.max(Math.max(...dmfp.slice(0, 4)) * 0.1, 0.1)
  spliceKernels(row, albedo, dmfp, scatterRadius)
  row.splice(
    PROFILE_COLUMNS.transmissionProfile,
    PROFILE_COLUMNS.transmissionProfileSize,
    ...transmissionProfileSamples(
      PROFILE_COLUMNS.transmissionProfileSize,
      data.extinctionScale,
      albedo,
      dmfp,
      data.worldUnitScale * data.distanceScale,
      transmissionTint,
    ),
  )
  // the kernels' offsets are stored over the radius they reach, in world units
  const reachScale = (scatterRadius * data.worldUnitScale * 10) / KERNEL_RADIUS_SCALE,
    kernelEnd = PROFILE_COLUMNS.kernel2 + PROFILE_COLUMNS.kernel2Size
  for (let x = PROFILE_COLUMNS.kernel0; x < kernelEnd; x++) {
    const texel = row[x]!
    texel[3] = (texel[3] / 3) * reachScale
  }
  return row
}

/**
 * The profile table: one row per profile, row 0 the default skin the surfaces without a profile
 * take, `PROFILE_TABLE_WIDTH` texels of four halves each. Each value is spread over sixteen bits
 * and read back in 0..1 as the normalised texture the shader reads would give it. `samplingChannel` picks the channel that steers the
 * sampled scattering: 0 the largest diffuse mean free path, 1 the largest mean free path. Throws when the profiles do not fit.
 */
export function buildProfileTable(
  profiles: readonly SubsurfaceProfile[],
  samplingChannel = 1,
): Uint16Array {
  if (profiles.length + 1 > MAX_SUBSURFACE_PROFILES) {
    throw new RangeError(`at most ${MAX_SUBSURFACE_PROFILES - 1} subsurface profiles`)
  }
  const rows = [defaultSkinProfile(), ...profiles],
    out = new Uint16Array(rows.length * PROFILE_TABLE_WIDTH * 4)
  rows.forEach((profile, y) => {
    rowTexels(profile, samplingChannel).forEach((texel, x) => {
      texel.forEach((value, c) => {
        const code = clamp(Math.trunc(value * SPAN_SCALE), 0, 0xffff)
        out[(y * PROFILE_TABLE_WIDTH + x) * 4 + c] = toHalf(code / (UNIT_SPAN - 1))
      })
    })
  })
  return out
}
