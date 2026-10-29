// The glass energy table built sample by sample (`glassEnergy.ts` holds it as data, which the test of that file checks against this builder).
// Run `node packages/sdk-core/src/lighting/glassEnergy.fixture.ts` to write the data (`glassEnergyTable.ts`).
import { writeFileSync } from 'node:fs'
import { TAU } from '../../../math/src/constants.ts'
import { owenSobolPoint } from '../../../math/src/sequence/owenSobol.ts'
import { unorm16 } from './environmentBrdf.ts'
import { GLASS_ENERGY_SIZE, glassEnergyEta } from './glassEnergy.ts'

/** Points of the sequence a texel is the mean of. */
export const GLASS_ENERGY_SAMPLES = 1 << 14
/** The least roughness a lobe is built with. */
const MIN_ROUGHNESS = 0.01

type Vec3 = readonly [number, number, number]

/** The half vector drawn from the normals the view `v` sees, the whole cap kept (so that a refracted direction may lie under the horizon) and the lobe round. */
function visibleHalf(e0: number, e1: number, alpha: number, v: Vec3): Vec3 {
  const stretched = Math.hypot(alpha * v[0], alpha * v[1], v[2])
  const seen = [(alpha * v[0]) / stretched, (alpha * v[1]) / stretched, v[2] / stretched]
  const z = 1 - e1 * (1 + seen[2])
  const sine = Math.sqrt(Math.min(Math.max(1 - z * z, 0), 1))
  const phi = TAU * e0
  const x = alpha * (sine * Math.cos(phi) + seen[0])
  const y = alpha * (sine * Math.sin(phi) + seen[1])
  const h = [x, y, Math.max(0, z + seen[2])]
  const length = Math.hypot(h[0], h[1], h[2])
  return length > 0 ? [h[0] / length, h[1] / length, h[2] / length] : [0, 0, 1]
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The weight and density of the light reflected to `l` about `h`, without Fresnel. */
function reflection(l: Vec3, v: Vec3, h: Vec3, alpha: number): number {
  const noL = Math.min(Math.max(l[2], 0), 1)
  const noV = Math.min(Math.max(v[2], 0), 1)
  if (!(noL > 0 && noV > 0)) return 0
  const lenL = Math.hypot(l[0] * alpha, l[1] * alpha, noL)
  const lenV = Math.hypot(v[0] * alpha, v[1] * alpha, noV)
  return (noL * (lenV + noV)) / (noV * lenL + noL * lenV)
}

/** The weight of the light refracted to `l` through `h`, without Fresnel. */
function refraction(l: Vec3, v: Vec3, h: Vec3, alpha: number): number {
  const noV = Math.min(Math.max(v[2], 0), 1)
  const noL = Math.min(Math.max(-l[2], 0), 1)
  if (!(noL > 0 && noV > 0 && h[2] > 0)) return 0
  const lenL = Math.hypot(l[0] * alpha, l[1] * alpha, noL)
  const lenV = Math.hypot(v[0] * alpha, v[1] * alpha, noV)
  return (noL * (lenV + noV)) / (noV * lenL + noL * lenV)
}

/**
 * The branch a ray `-v` takes at the half vector `h`, bending by `eta` and reflecting by the Fresnel of reflectance `f0`: the direction, and
 * whether it refracted, as the path tracer samples a glass surface (`PT_DIELECTRIC_WGSL`, `ptSampleRefraction`); `choice` picks reflection or refraction.
 */
function branch(
  v: Vec3,
  h: Vec3,
  eta: number,
  f0: number,
  choice: number,
): { l: Vec3; refracted: boolean } {
  const cosI = Math.abs(dot(v, h))
  const g2 = eta * eta - 1 + cosI * cosI
  if (g2 >= 0) {
    const g = Math.sqrt(g2)
    const c = eta >= 1 ? cosI : g / eta
    const f90 = Math.min(Math.max(f0 * 50, 0), 1)
    const fr = f0 + (f90 - f0) * (1 - c) ** 5
    if (choice >= fr) {
      const k = cosI - g
      const d = [-v[0] + h[0] * k, -v[1] + h[1] * k, -v[2] + h[2] * k]
      const n = Math.hypot(d[0], d[1], d[2])
      return { l: [d[0] / n, d[1] / n, d[2] / n], refracted: true }
    }
  }
  // Total internal reflection, or the reflection sampled: the ray -v turned about h.
  const dir = [-v[0] + 2 * cosI * h[0], -v[1] + 2 * cosI * h[1], -v[2] + 2 * cosI * h[2]] as const
  return { l: dir, refracted: false }
}

/** The reflectance of normal incidence of a dielectric of index `ior`. */
const f0OfIor = (ior: number) => ((ior - 1) / (ior + 1)) ** 2

/**
 * The texel (`column`, `row`, `layer`) of the table for the view cosine `noV`, the roughness `roughness` and the index `ior`: `[in, out]`,
 * the means over `samples` points of the Owen-scrambled Sobol sequence of the texel of the weight of the light that leaves the surface by a ray entering
 * it from outside (`in`, the index `ior`) and from inside (`out`, the index `1 / ior`). The view lies in the xz plane.
 */
export function glassEnergyTexel(
  noV: number,
  roughness: number,
  ior: number,
  column: number,
  row: number,
  layer: number,
  samples = GLASS_ENERGY_SAMPLES,
): readonly [number, number] {
  const vz = Math.max(noV, 1e-8)
  const v: Vec3 = [Math.sqrt(Math.max(1 - vz * vz, 0)), 0, vz]
  const alpha = Math.max(roughness, MIN_ROUGHNESS) ** 2
  const f0 = f0OfIor(ior)
  let inside = 0
  let outside = 0
  for (let i = 0; i < samples; i++) {
    // The texel's place on the sequence's image: the layers side by side, eight across.
    const [e0, e1, e2] = owenSobolPoint(
      column + GLASS_ENERGY_SIZE * (layer & 7),
      row + GLASS_ENERGY_SIZE * (layer >> 3),
      0,
      i,
      samples,
    )
    const h = visibleHalf(e0, e1, alpha, v)
    for (const [eta, side] of [
      [ior, 0],
      [1 / ior, 1],
    ] as const) {
      const { l, refracted } = branch(v, h, eta, f0, e2)
      const weight = refracted ? refraction(l, v, h, alpha) : reflection(l, v, h, alpha)
      if (side === 0) inside += weight
      else outside += weight
    }
  }
  return [inside / samples, outside / samples]
}

/** The table as 16-bit unsigned integers, `[in, out]` a texel, texel after texel along the view cosine, then the roughness, then the index. */
export function glassEnergyTable(samples = GLASS_ENERGY_SAMPLES) {
  const n = GLASS_ENERGY_SIZE
  const table = new Uint16Array(n * n * n * 2)
  for (let layer = 0; layer < n; layer++)
    for (let row = 0; row < n; row++)
      for (let column = 0; column < n; column++) {
        const [a, b] = glassEnergyTexel(
          (column + 0.5) / n,
          (row + 0.5) / n,
          glassEnergyEta((layer + 0.5) / n),
          column,
          row,
          layer,
          samples,
        )
        table.set([unorm16(a), unorm16(b)], ((layer * n + row) * n + column) * 2)
      }
  return table
}

/** The source of the data module (`glassEnergyTable.ts`) holding `table`, base64 of its little-endian bytes in lines. */
function glassEnergyTableSource(table: Uint16Array) {
  const text = Buffer.from(table.buffer, table.byteOffset, table.byteLength).toString('base64')
  const lines = text.match(/.{1,100}/g) ?? []
  return `// Generated by \`node packages/sdk-core/src/lighting/glassEnergy.fixture.ts\`: do not edit.
// The glass energy table as the sixteen bits of each value, base64, little-endian (\`glassEnergy.ts\`).
export const GLASS_ENERGY_BASE64 = [
${lines.map((line) => `  '${line}',`).join('\n')}
].join('')
`
}

if (import.meta.main)
  writeFileSync(
    new URL('./glassEnergyTable.ts', import.meta.url),
    glassEnergyTableSource(glassEnergyTable()),
  )
