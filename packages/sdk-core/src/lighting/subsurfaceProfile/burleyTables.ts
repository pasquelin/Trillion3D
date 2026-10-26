import {
  CM_TO_MM,
  diffusionProfile,
  searchLightScale,
  transmissionProfile,
  type Rgba,
} from './burleyMath.ts'

/** The transmission profile starts this far (cm) off the surface, sampled over 5 cm. */
const PROFILE_RADIUS_OFFSET = 0.06
const MAX_TRANSMISSION_DISTANCE = 5

/**
 * The `size` samples of the transmission profile: the light through the thickness of the volume,
 * tinted by `tint`, its alpha the extinction `exp(-distance * extinctionScale)`. The profile does
 * not hold the surface albedo (the recombine uses the stored base colour), and its last sample is
 * black (alpha one, as a black colour is) so a thickness past the radius takes no scattering. `unitScale` is the world unit scale
 * times the distance scale.
 */
export function transmissionProfileSamples(
  size: number,
  extinctionScale: number,
  albedo: Rgba,
  dmfpMm: Rgba,
  unitScale: number,
  tint: Rgba,
): Rgba[] {
  const invUnit = 0.1 / unitScale,
    scale = [0, 1, 2].map((c) => searchLightScale(albedo[c]!)),
    out: Rgba[] = []
  for (let i = 0; i < size; i++) {
    const distance = (i / size) * (MAX_TRANSMISSION_DISTANCE * CM_TO_MM) * invUnit,
      radius = distance + PROFILE_RADIUS_OFFSET * CM_TO_MM * invUnit,
      texel: Rgba = [0, 0, 0, Math.exp(-distance * extinctionScale)]
    for (let c = 0; c < 3; c++) {
      texel[c] = transmissionProfile(radius, 1, scale[c]!, dmfpMm[c]!) * tint[c]!
    }
    out.push(texel)
  }
  out[size - 1] = [0, 0, 0, 1]
  return out
}

/**
 * The one-sided separable kernel of `size` samples (the centre first, then the positive offsets;
 * RGB the weight per channel, A the offset in kernel units) of the normalised diffusion profile
 * over `scatterRadiusCm`. Each channel is normalised over the mirrored kernel.
 */
export function mirroredKernel(
  size: number,
  albedo: Rgba,
  dmfpMm: Rgba,
  scatterRadiusCm: number,
): Rgba[] {
  const total = size * 2 - 1,
    range = total > 20 ? 3 : 2,
    spaceScale = scatterRadiusCm * CM_TO_MM,
    scale = [0, 1, 2].map((c) => searchLightScale(albedo[c]!)),
    kernel: Rgba[] = []
  for (let i = 0; i < total; i++) {
    const o = -range + i * ((2 * range) / (total - 1))
    kernel.push([0, 0, 0, (range * (o < 0 ? -1 : 1) * Math.abs(o ** 2)) / range ** 2])
  }
  kernel[total >> 1]![3] = 0
  for (let i = 0; i < total; i++) {
    const w0 = i > 0 ? Math.abs(kernel[i]![3] - kernel[i - 1]![3]) : 0,
      w1 = i < total - 1 ? Math.abs(kernel[i]![3] - kernel[i + 1]![3]) : 0,
      area = (w0 + w1) / 2
    for (let c = 0; c < 3; c++) {
      kernel[i]![c] =
        area *
        diffusionProfile(Math.abs(kernel[i]![3]) * spaceScale, albedo[c]!, scale[c]!, dmfpMm[c]!)
    }
  }
  // the radius is matched visually by twice the offsets
  for (const texel of kernel) texel[3] *= 2
  // the offset 0 comes first
  const centre = kernel[total >> 1]!
  for (let i = total >> 1; i > 0; i--) kernel[i] = kernel[i - 1]!
  kernel[0] = centre
  for (let c = 0; c < 3; c++) {
    let sum = 0
    for (const texel of kernel) sum += texel[c]!
    for (const texel of kernel) texel[c] = texel[c]! / sum
  }
  return [kernel[0]!, ...Array.from({ length: size - 1 }, (_, i) => kernel[size + i]!)]
}
