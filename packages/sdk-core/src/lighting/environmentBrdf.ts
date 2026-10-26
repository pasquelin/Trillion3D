/**
 * THE PREINTEGRATED ENVIRONMENT BRDF, as data (`packages/sdk-browser/src/lighting/direct/environmentBrdfWgsl.ts`): what a surface of
 * a given roughness, seen at a given angle, keeps of the light of every direction, split into the share under a Fresnel of one
 * (`A`) and the share under the Fresnel's fifth power (`B`), so that the reflectance `f0 · A + f90 · B` weighs the light the
 * environment, the probes and the traces bring.
 *
 * Across, N·V at the texel's centre; down, the perceptual roughness at the texel's centre. Each texel integrates the GGX lobe, with
 * the Smith visibility, over 128 stratified samples: the half vectors a sample of the lobe gives (`A`, `B`). The values are held as
 * 16-bit unsigned integers, one word a texel, `A` in the low half.
 */
import { TAU } from '../../../math/src/constants.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

/** Texels across (N·V) and down (roughness). */
export const ENV_BRDF_WIDTH = 128
export const ENV_BRDF_HEIGHT = 32
/** Words of the table. */
export const ENV_BRDF_TEXELS = ENV_BRDF_WIDTH * ENV_BRDF_HEIGHT

const SAMPLES = 128

/** The bits of `i` in reverse order, over 2³², as a fraction. */
function radicalInverse(i: number) {
  let bits = i >>> 0
  bits = ((bits << 16) | (bits >>> 16)) >>> 0
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0
  return bits / 4294967296
}

/** The two shares of one texel: the view at cosine `noV` (sine toward x), the lobe of perceptual roughness `roughness`. */
function integrate(noV: number, roughness: number): [number, number] {
  const m = roughness * roughness
  const m2 = m * m
  const sinV = Math.sqrt(1 - noV * noV)
  let a = 0
  let b = 0
  for (let i = 0; i < SAMPLES; i++) {
    const e1 = i / SAMPLES
    const e2 = radicalInverse(i)
    const phi = TAU * e1
    const cosTheta = Math.sqrt((1 - e2) / (1 + (m2 - 1) * e2))
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)
    const hx = sinTheta * Math.cos(phi)
    const hz = cosTheta
    const vDotH = sinV * hx + noV * hz
    const noL = Math.max(2 * vDotH * hz - noV, 0)
    const noH = Math.max(hz, 0)
    const voH = Math.max(vDotH, 0)
    if (noL > 0) {
      const visV = noL * (noV * (1 - m) + m)
      const visL = noV * (noL * (1 - m) + m)
      const vis = 0.5 / (visV + visL)
      const weight = noL * vis * ((4 * voH) / noH)
      let fc = 1 - voH
      fc *= (fc * fc) ** 2
      a += weight * (1 - fc)
      b += weight * fc
    }
  }
  return [a / SAMPLES, b / SAMPLES]
}

const unorm16 = (v: number) => Math.trunc(clamp(v, 0, 1) * 65535 + 0.5)

let table: Uint32Array<ArrayBuffer> | null = null

/** The table's words (`ENV_BRDF_TEXELS`), row after row, built once. */
export function environmentBrdfTable() {
  if (table) return table
  const words = new Uint32Array(ENV_BRDF_TEXELS)
  for (let y = 0; y < ENV_BRDF_HEIGHT; y++) {
    const roughness = (y + 0.5) / ENV_BRDF_HEIGHT
    for (let x = 0; x < ENV_BRDF_WIDTH; x++) {
      const [a, b] = integrate((x + 0.5) / ENV_BRDF_WIDTH, roughness)
      words[y * ENV_BRDF_WIDTH + x] = (unorm16(a) | (unorm16(b) << 16)) >>> 0
    }
  }
  return (table = words)
}
