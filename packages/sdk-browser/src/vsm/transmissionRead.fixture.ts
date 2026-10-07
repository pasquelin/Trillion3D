// The exact transmission read's proofs (`transmissionWgsl.ts`), its shipped WGSL run by
// `shaderRun`: generated scenes, a slice laid out as the resolve writes it, a brute-force cast and
// the texel store the read replaced.
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { VSM_TRANSMISSION_NONE, vsmTransmissionReadWgsl } from './transmissionWgsl.ts'
import { type Tri, type V, BLOCK, geometry } from './transmissionSheets.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'

const WIDTH = 1024

export interface Caster {
  tri: Tri
  /** World height of each corner along the light's axis (the light straight above). */
  d: V
  q: number
}

const NONE = VSM_TRANSMISSION_NONE

/** The memory a resolve writes for physical page 0's dynamic slice of `casters` (page headers,
 *  cell headers, chain, records, cell lists), as texels by "x,y". */
export function memoryOf(casters: Caster[]) {
  const memory = new Map<string, V>()
  const rows = 1
  const slice: V[] = []
  const records = casters.map(({ tri, d, q }) => {
    const bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]
    return [
      [bits(tri[0][0]), bits(tri[0][1]), bits(tri[1][0]), bits(tri[1][1])],
      [bits(tri[2][0]), bits(tri[2][1]), bits(d[0]), bits(d[1])],
      [bits(d[2]), 0, q, 0],
      [0, 0, 0, 0],
    ]
  })
  const lists: number[][] = Array.from({ length: 256 }, () => [])
  casters.forEach(({ tri: [a, b, c] }, l) => {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (area === 0) return
    const lo = [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1])]
    const hi = [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1])]
    if (hi[0] < 0 || hi[1] < 0 || lo[0] >= 128 || lo[1] >= 128) return
    const r = geometry.vsmTCellRange(lo, hi)
    for (let y = r[1]; y <= r[3]; y++)
      for (let x = r[0]; x <= r[2]; x++)
        if (geometry.vsmTCoversCell(a, b, c, Math.sign(area), [x, y])) lists[y * 16 + x].push(l)
  })
  const recordsAt = 72,
    listsAt = recordsAt + 4 * records.length
  let at = listsAt
  const headers: number[] = []
  for (const list of lists) {
    headers.push((at << 16) | list.length)
    for (let k = 0; k < list.length; k += 4)
      slice[at++] = [0, 1, 2, 3].map((i) => (k + i < list.length ? recordsAt + 4 * list[k + i] : 0))
  }
  for (let t = 0; t < 64; t++) slice[t] = headers.slice(4 * t, 4 * t + 4)
  const blocks = ceilDiv(at, BLOCK)
  const chain = Array.from({ length: 32 }, (_, j) => (j < blocks ? j : NONE))
  for (let t = 0; t < 8; t++) slice[64 + t] = chain.slice(4 * t, 4 * t + 4)
  records.forEach((r, l) => r.forEach((w, t) => (slice[recordsAt + 4 * l + t] = w)))
  slice.forEach((w, v) => {
    const b = Math.floor(v / BLOCK)
    const x = (b & 1) * BLOCK + (v % BLOCK)
    memory.set(`${x},${rows + (b >> 1)}`, w)
  })
  memory.set('0,0', [0, NONE, NONE, NONE])
  return memory
}

export type Read = { vsmTransmissionThrough: (...a: unknown[]) => V }

/** The shipped read over `memory`, the light straight down the map's z. */
export function reader(memory: Map<string, V>): Read {
  const vector =
    (n: number) =>
    (...args: Array<number | V>) => {
      const flat = args.flat().map((x) => Math.trunc(Number(x)) >>> 0)
      return flat.length === 1 ? new Array<number>(n).fill(flat[0]) : flat
    }
  return shaderRun<Read>(
    wgslModule(vsmTransmissionReadWgsl(14)),
    [
      'vsmTransmissionThrough',
      'vsmTransmissionBlocks',
      'vsmTLoad',
      'vsmTBlock',
      'vsmTRead',
      'vsmTMemBlock',
      'vsmTScanPage',
      'vsmTScanSlice',
      'vsmTHitOf',
      'vsmTPatch',
      'vsmTLess',
      'vsmTInside',
      'vsmTEdgeHolds',
      'vsmTEdge',
      'vsmTWeights',
      'bilinear3',
    ],
    {
      vsm: { poolPages: 4, poolPagesXY: [2, 2] },
      VSM_PAGE_TEXELS: 128,
      vsmTransmissionMemory: 'memory',
      vec2u: vector(2),
      vec4u: vector(4),
      textureDimensions: () => [WIDTH, 4],
      textureLoad: (_m: string, t: V) => [...(memory.get(`${t[0]},${t[1]}`) ?? [0, 0, 0, 0])],
      bitcast_vec4f: (w: V) => [...new Float32Array(new Uint32Array(w).buffer)],
      unpack4x8unorm: (w: number) => [0, 8, 16, 24].map((s) => ((w >>> s) & 255) / 255),
      fract: (v: V) => v.map((x) => x - Math.floor(x)),
      vsmProjectionOf: () => ({
        shiftedToMapUv: [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      }),
      VsmTReceiver: (p: V, directional: boolean, axis: V, d: number, at: V) => ({
        p,
        directional,
        axis,
        d,
        at,
      }),
      VsmTHit: (distance: number, key: number, through: V) => ({ distance, key, through }),
      VsmTScan: (count: number, product: V, next: V, nextCount: number, nextThrough: V) => ({
        count,
        product,
        next,
        nextCount,
        nextThrough,
      }),
    },
  )
}

/** The read at page point `p` for a receiver at height `z` (the normal bias already added). */
export const readAt = (read: Read, p: V, z: number) =>
  read.vsmTransmissionThrough(
    {
      poolTexel: p.map(Math.floor),
      mapTexelPos: p,
      handle: { id: 0 },
      valid: true,
    },
    [p[0], p[1], z],
    [p[0], p[1], z],
    [0, 0, 0],
    true,
  )

export const pack = (c: V) =>
  c.reduce((w, x, i) => w | (Math.floor(Math.min(Math.max(x, 0), 1) * 255 + 0.5) << (8 * i)), 0)
export const unpack = (w: number) => [0, 8, 16].map((s) => ((w >>> s) & 255) / 255)
