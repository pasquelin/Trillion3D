import { GOLDEN_FRACTION } from '../../../math/src/constants.ts'
import { floorLog2 } from '../../../math/src/scalar/integers.ts'
import { wgslBlock, wgslConst, wgslFn } from '../../../math/src/wgsl/decl.ts'
/**
 * Spatio-temporal blue noise for the projection: one noise value and a pair per pixel and frame,
 * the frames' slices stacked down one texture, a pixel's texel at (x mod 64, 64·(frame mod 64) +
 * y mod 64) (`vsmNoiseTexel`). They are generated here, deterministically, once per device:
 *
 * - three 64×64 rank maps, each built by filling the emptiest place and emptying the most crowded
 *   one in turn (a Gaussian energy of σ = 1.9 on the torus, a seeded generator, ties to the lowest
 *   index), one for the scalar and two for the vec2;
 * - 64 temporal slices made by an additive offset of each map: slice t of a map v is
 *   frac(v + t·α), α = 1/φ (φ the golden ratio) for the scalar and (1/p, 1/p²) (p the plastic
 *   number, 0.7548776662, 0.5698402910) for the two vec2 channels — each slice keeps the spatial
 *   spectrum of its map, and each texel walks an evenly spread 1D sequence through time;
 * - quantized to 8 bits.
 *
 * Packed in ONE rgba8unorm texture of 64 × (64·64): r = the value, g/b = the pair. A tile of 64 × 64
 * pixels and 64 frames, wrapped by masks of 63: a 64² tile, not 128², keeps the startup cost of the
 * rank maps in script low.
 */

const VSM_BLUE_NOISE_SIZE = 64
const VSM_BLUE_NOISE_SLICES = 64

const GOLDEN = GOLDEN_FRACTION
/** The step of the additive 2D sequence, (1/p, 1/p²), p the plastic number: its points spread
 *  evenly over the unit square. The pair's slices walk it, and so do the rays' noise offsets
 *  (`vsmAdditive2d`, `traceWgsl.ts`). */
export const VSM_PLASTIC_STEP = [0.7548776662466927, 0.5698402909980532] as const
const [R2X, R2Y] = VSM_PLASTIC_STEP

/** A small deterministic generator of uniform numbers in [0, 1) from a 32-bit seed. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The rank map of an n×n torus (n a power of two), values (rank + 0.5)/n² in (0, 1). */
function vsmVoidAndCluster(n: number, seed: number, sigma = 1.9): Float64Array {
  const N = n * n,
    mask = n - 1,
    shift = floorLog2(n),
    R = Math.min(n >> 1, Math.ceil(4 * sigma)),
    side = 2 * R + 1
  const kernel = new Float64Array(side * side)
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++)
      kernel[(dy + R) * side + dx + R] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
  const splat = (energy: Float64Array, i: number, sign: number) => {
    const x = i & mask,
      y = i >>> shift
    for (let dy = -R; dy <= R; dy++) {
      const row = ((y + dy) & mask) * n,
        k = (dy + R) * side + R
      for (let dx = -R; dx <= R; dx++) energy[row + ((x + dx) & mask)] += sign * kernel[k + dx]
    }
  }
  /**
   * A pattern and its energy, with each row's tightest cluster (first set texel of greatest
   * energy) and largest void (first unset texel of least energy). The first row whose extremum
   * beats every earlier row's holds the first extremum of the whole torus — the texel a scan of all
   * n² texels finds, ties to the lowest index. A flip splats 2R + 1 rows: those alone are scanned
   * again, a quarter of the torus at n = 64 instead of all of it.
   */
  const extrema = (pattern: Uint8Array, energy: Float64Array) => {
    const clusters = new Int32Array(n),
      voids = new Int32Array(n)
    const scan = (r: number) => {
      let cluster = -1,
        high = -Infinity,
        hole = -1,
        low = Infinity
      for (let i = r * n, end = i + n; i < end; i++) {
        const e = energy[i]
        if (pattern[i]) {
          if (e > high) {
            high = e
            cluster = i
          }
        } else if (e < low) {
          low = e
          hole = i
        }
      }
      clusters[r] = cluster
      voids[r] = hole
    }
    for (let r = 0; r < n; r++) scan(r)
    return {
      flip(i: number, set: 0 | 1) {
        pattern[i] = set
        splat(energy, i, set ? 1 : -1)
        const y = i >>> shift
        for (let dy = -R; dy <= R; dy++) scan((y + dy) & mask)
      },
      tightestCluster() {
        let best = -1,
          e = -Infinity
        for (let r = 0; r < n; r++) {
          const i = clusters[r]
          if (i >= 0 && energy[i] > e) {
            e = energy[i]
            best = i
          }
        }
        return best
      },
      largestVoid() {
        let best = -1,
          e = Infinity
        for (let r = 0; r < n; r++) {
          const i = voids[r]
          if (i >= 0 && energy[i] < e) {
            e = energy[i]
            best = i
          }
        }
        return best
      },
    }
  }

  // Initial binary pattern: 10% random minority pixels, relaxed until stable.
  const random = prng(seed)
  const pattern = new Uint8Array(N),
    energy = new Float64Array(N)
  const ones = Math.max(1, Math.floor(N / 10))
  for (let placed = 0; placed < ones;) {
    const i = Math.floor(random() * N)
    if (pattern[i]) continue
    pattern[i] = 1
    splat(energy, i, 1)
    placed++
  }
  {
    const torus = extrema(pattern, energy)
    for (let guard = 0; guard < 16 * N; guard++) {
      const c = torus.tightestCluster()
      torus.flip(c, 0)
      const v = torus.largestVoid()
      torus.flip(v, 1)
      if (v === c) break
    }
  }

  const rank = new Int32Array(N)
  // Phase 1: ranks below the prototype's count, removing the tightest clusters.
  {
    const torus = extrema(pattern.slice(), energy.slice())
    for (let r = ones - 1; r >= 0; r--) {
      const c = torus.tightestCluster()
      torus.flip(c, 0)
      rank[c] = r
    }
  }
  // Phases 2 and 3: the rest, filling the largest voids.
  {
    const torus = extrema(pattern.slice(), energy.slice())
    for (let r = ones; r < N; r++) {
      const v = torus.largestVoid()
      torus.flip(v, 1)
      rank[v] = r
    }
  }
  const out = new Float64Array(N)
  for (let i = 0; i < N; i++) out[i] = (rank[i] + 0.5) / N
  return out
}

let cachedTexels: Uint8Array | undefined

/** RGBA8 texels of the 64 × (64·64) texture (r scalar, g/b vec2, a = 255). Computed once. */
function vsmBlueNoiseTexels(): Uint8Array {
  if (cachedTexels) return cachedTexels
  const n = VSM_BLUE_NOISE_SIZE,
    slices = VSM_BLUE_NOISE_SLICES
  const a = vsmVoidAndCluster(n, 0x5eed0001),
    b = vsmVoidAndCluster(n, 0x5eed0002),
    c = vsmVoidAndCluster(n, 0x5eed0003)
  const q = (v: number) => Math.round((v - Math.floor(v)) * 255)
  const out = new Uint8Array(n * n * slices * 4)
  for (let t = 0; t < slices; t++)
    for (let i = 0; i < n * n; i++) {
      const o = (t * n * n + i) * 4
      out[o] = q(a[i] + t * GOLDEN)
      out[o + 1] = q(b[i] + t * R2X)
      out[o + 2] = q(c[i] + t * R2Y)
      out[o + 3] = 255
    }
  return (cachedTexels = out)
}

/** Bytes of the blue-noise texture (`createVsmBlueNoiseTexture`). */
export const VSM_BLUE_NOISE_BYTES =
  VSM_BLUE_NOISE_SIZE * VSM_BLUE_NOISE_SIZE * VSM_BLUE_NOISE_SLICES * 4

/** A blue-noise texture, uploaded: the projection's of one set (`projectionPass.ts`). */
export function createVsmBlueNoiseTexture(device: GPUDevice): GPUTexture {
  const n = VSM_BLUE_NOISE_SIZE,
    h = n * VSM_BLUE_NOISE_SLICES
  const t = device.createTexture({
    label: 'vsm.blueNoise',
    size: [n, h],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture: t },
    vsmBlueNoiseTexels() as Uint8Array<ArrayBuffer>,
    { bytesPerRow: n * 4 },
    [n, h],
  )
  return t
}

/** The tile the rays' noise repeats over: the blue noise's size and slices. */
export const VSM_NOISE_TILE = wgslConst(
  'VSM_NOISE_TILE',
  [],
  `const VSM_NOISE_TILE=vec3u(${VSM_BLUE_NOISE_SIZE}u,${VSM_BLUE_NOISE_SIZE}u,${VSM_BLUE_NOISE_SLICES}u);`,
)

/**
 * The noise value read over
 * `vsmBlueNoise` declared at (`group`, `binding`).
 */
export const vsmBlueNoiseWgsl = (group: number, binding: number) =>
  wgslBlock(
    `vsmBlueNoiseWgsl(${group}, ${binding})`,
    [VSM_NOISE_TILE],
    `
@group(${group}) @binding(${binding}) var vsmBlueNoise:texture_2d<f32>;
const VSM_NOISE_WRAP=vec3u(${VSM_BLUE_NOISE_SIZE - 1}u,${VSM_BLUE_NOISE_SIZE - 1}u,${VSM_BLUE_NOISE_SLICES - 1}u);
fn vsmNoiseTexel(pixelAt:vec2u,frameIndex:u32)->vec4f{
 let w=vec3u(pixelAt,frameIndex)&VSM_NOISE_WRAP;
 return textureLoad(vsmBlueNoise,vec2u(w.x,w.z*VSM_NOISE_TILE.y+w.y),0);
}
fn vsmNoiseOne(pixelAt:vec2u,frameIndex:u32)->f32{return vsmNoiseTexel(pixelAt,frameIndex).r;}
`,
  )

/** The rays' random pair at a pixel and frame (`vsmNoiseTwo`, the traces' noise provider), over
 *  the same texture. */
export const vsmBlueNoiseTwo = (group: number, binding: number) =>
  wgslFn(
    'vsmNoiseTwo',
    [vsmBlueNoiseWgsl(group, binding)],
    'fn vsmNoiseTwo(pixelAt:vec2u,frameIndex:u32)->vec2f{return vsmNoiseTexel(pixelAt,frameIndex).gb;}',
  )
