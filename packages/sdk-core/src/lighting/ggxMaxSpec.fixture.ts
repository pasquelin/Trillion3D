// The GGX peak table built sample by sample (`ggxMaxSpec.ts` holds it as data, which the test of that file checks against this
// builder). Run `node packages/sdk-core/src/lighting/ggxMaxSpec.fixture.ts` to write the data (`ggxMaxSpecTable.ts`).
import { writeFileSync } from 'node:fs'
import { PI, TAU } from '../../../math/src/constants.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import { owenSobolPoint } from '../../../math/src/sequence/owenSobol.ts'
import { unorm16 } from './environmentBrdf.ts'
import { GGX_MAX_SIZE, GGX_MAX_VIEW_COSINES, GGX_MAX_VIEW_STEP } from './ggxMaxSpec.ts'
import { GGX_MAX_SPEC_TABLE } from './ggxMaxSpecTable.ts'

/** The values a texel holds, one for each view cosine. */
export const GGX_MAX_VIEWS = GGX_MAX_VIEW_COSINES.length
/** Points of the sequence a texel's maximum is taken over. */
const GGX_MAX_SAMPLES = 1 << 14
/** The least roughness a lobe is built with. */
const MIN_ROUGHNESS = 0.01
/** The least width of an anisotropic lobe's axis. */
const MIN_ALPHA = 0.001

/**
 * The four values of the texel (`column` the roughness, `row` the anisotropy): for each view cosine `k / 3`, `π / max` of the lobe's
 * value `D` over `samples` visible normals of the Owen-scrambled Sobol sequence of the texel (`owenSobolPoint`, the texel's place the
 * pixel, the view its frame), the visible normals drawn from the view stretched by the lobe's two axes, none bounded to the reflection
 * (`ImportanceSampleVisibleGGX`), held to [0, 1]; a view whose normals all face away holds 1.
 */
export function ggxMaxTexel(column: number, row: number, samples = GGX_MAX_SAMPLES) {
  const roughness = Math.max(column / (GGX_MAX_SIZE - 1), MIN_ROUGHNESS)
  const anisotropy = row / (GGX_MAX_SIZE - 1)
  const alpha = roughness * roughness
  const ax = Math.max(alpha * (1 + anisotropy), MIN_ALPHA),
    ay = Math.max(alpha * (1 - anisotropy), MIN_ALPHA)
  const out = new Float32Array(GGX_MAX_VIEWS)
  for (let view = 0; view < GGX_MAX_VIEWS; view++) {
    const vz = Math.max(view / (GGX_MAX_VIEWS - 1), 1e-8)
    const vx = Math.sqrt(Math.max(1 - vz * vz, 0))
    // The view in the frame where the lobe is stretched to a hemisphere.
    const stretch = Math.hypot(ax * vx, vz)
    const sx = (ax * vx) / stretch,
      sz = vz / stretch
    let peak = 0
    for (let i = 0; i < samples; i++) {
      const [first, second] = owenSobolPoint(column, row, view, i, samples)
      const phi = TAU * first
      const z = 1 + (-sz - 1) * second
      const sine = Math.sqrt(Math.min(Math.max(1 - z * z, 0), 1))
      let hx = sine * Math.cos(phi) + sx
      let hy = sine * Math.sin(phi)
      let hz = Math.max(0, z + sz)
      hx *= ax
      hy *= ay
      const length = Math.hypot(hx, hy, hz)
      hx /= length
      hy /= length
      hz /= length
      const vDotH = vx * hx + vz * hz
      if (2 * vDotH * hz - vz <= 0) continue
      // D: the anisotropic lobe's value at the half vector.
      const a2 = ax * ay
      const s = (ay * hx) ** 2 + (ax * hy) ** 2 + (a2 * hz) ** 2
      peak = Math.max(peak, (1 / PI) * a2 * (a2 / s) ** 2)
    }
    out[view] = Math.min(Math.max((1 / PI) * (1 / peak), 0), 1)
  }
  return out
}

/** The whole table built: `GGX_MAX_SIZE` rows of anisotropy (rising) of `GGX_MAX_SIZE` columns of roughness (rising), `GGX_MAX_VIEWS` values a texel. */
function ggxMaxSpecTable(samples = GGX_MAX_SAMPLES) {
  const table = new Float32Array(GGX_MAX_SIZE * GGX_MAX_SIZE * GGX_MAX_VIEWS)
  for (let row = 0; row < GGX_MAX_SIZE; row++)
    for (let column = 0; column < GGX_MAX_SIZE; column++)
      table.set(ggxMaxTexel(column, row, samples), (row * GGX_MAX_SIZE + column) * GGX_MAX_VIEWS)
  return table
}

/** The value of one texel held in 16 bits, as the buffer holds it. */
const held = (v: number) => unorm16(v) / 65535

/**
 * The factor the toon specular is multiplied by (`GGXMaxEnergyLookup`): the table read at the texel of `roughness` and `|anisotropy|`
 * by a bilinear filter that clamps at the edge (the texel coordinates `(r, a) · 31`: the table maps its first and last texel centres to 0 and 1), the
 * four values blended by the distance of `noV` to the view cosines over `GGX_MAX_VIEW_STEP`, times π. The CPU twin of the shader's read (`toonPeak`).
 */
export function ggxMaxEnergy(roughness: number, anisotropy: number, noV: number) {
  const x = clamp(roughness, 0, 1) * (GGX_MAX_SIZE - 1),
    y = clamp(Math.abs(anisotropy), 0, 1) * (GGX_MAX_SIZE - 1)
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    tx = x - x0,
    ty = y - y0
  const x1 = Math.min(x0 + 1, GGX_MAX_SIZE - 1),
    y1 = Math.min(y0 + 1, GGX_MAX_SIZE - 1)
  const texel = (column: number, row: number, k: number) =>
    held(GGX_MAX_SPEC_TABLE[(row * GGX_MAX_SIZE + column) * GGX_MAX_VIEWS + k])
  let total = 0
  for (let k = 0; k < GGX_MAX_VIEWS; k++) {
    const blend = 1 - clamp(Math.abs(noV - GGX_MAX_VIEW_COSINES[k]) / GGX_MAX_VIEW_STEP, 0, 1)
    const value =
      (texel(x0, y0, k) * (1 - tx) + texel(x1, y0, k) * tx) * (1 - ty) +
      (texel(x0, y1, k) * (1 - tx) + texel(x1, y1, k) * tx) * ty
    total += value * blend
  }
  return total * PI
}

/** The source of the data module (`ggxMaxSpecTable.ts`) holding `table`. */
function ggxMaxSpecTableSource(table: Float32Array) {
  const lines: string[] = []
  for (let i = 0; i < table.length; i += 8)
    lines.push(
      `  ${Array.from(table.subarray(i, i + 8), (v) => String(Number(v.toPrecision(9)))).join(', ')},`,
    )
  return `// Generated by \`node packages/sdk-core/src/lighting/ggxMaxSpec.fixture.ts\`: do not edit.
// The GGX peak table, row after row of anisotropy, column after column of roughness, four values a texel (\`ggxMaxSpec.ts\`).
export const GGX_MAX_SPEC_TABLE = new Float32Array([
${lines.join('\n')}
])
`
}

if (import.meta.main)
  writeFileSync(
    new URL('./ggxMaxSpecTable.ts', import.meta.url),
    ggxMaxSpecTableSource(ggxMaxSpecTable()),
  )
