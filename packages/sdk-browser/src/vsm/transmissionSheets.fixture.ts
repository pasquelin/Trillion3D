// The exact transmission read's geometry under test (`transmissionWgsl.ts`), its shipped WGSL run
// by `shaderRun`: the edge rule and the bin's cells, and the generated sheets they are proven on.
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { vsmTransmissionBinWgsl, vsmTransmissionReadWgsl } from './transmissionWgsl.ts'
import { vsmLayout } from './layout.ts'

export type V = number[]
export type Tri = [V, V, V]
export const f32 = (x: number) => Math.fround(x)
/** The engine's layout for one sun. */
export const LAYOUT = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27)
/** Texels of a block, of a cell, cells a side, the memory's width (`transmissionWgsl.ts`). */
export const BLOCK = 512
export const CELL = 8
export const CELLS = 16

export const geometry = shaderRun<{
  vsmTInside: (a: V, b: V, c: V, p: V) => boolean
  vsmTCoversCell: (a: V, b: V, c: V, s: number, cell: V) => boolean
  vsmTCellRange: (lo: V, hi: V) => V
}>(
  vsmTransmissionReadWgsl(14) + vsmTransmissionBinWgsl(LAYOUT),
  [
    'vsmTEdge',
    'vsmTEdgeHolds',
    'vsmTInside',
    'vsmTEdgeMeets',
    'vsmTCovers',
    'vsmTCellRange',
    'vsmTCoversCell',
  ],
  {},
)

/** A seeded generator in [0, 1). */
export function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

/** A sheet of `n` × `n` quads over [lo, hi]², corners moved by `move`, each quad cut along
 *  alternating diagonals: as the sea's grid is drawn. */
export function sheet(n: number, lo: number, hi: number, move: (p: V) => V): Tri[] {
  const at = (i: number, j: number) => {
    const p = [lo + ((hi - lo) * i) / n, lo + ((hi - lo) * j) / n]
    return move(p).map(f32)
  }
  const out: Tri[] = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
      if ((i + j) % 2) out.push([a, b, c], [a, c, d])
      else out.push([a, b, d], [b, c, d])
    }
  return out
}

export const waves = (p: V) => [
  p[0] + 1.3 * Math.sin(p[1] * 0.21) + 0.4 * Math.sin(p[0] * 0.53),
  p[1] + 1.1 * Math.cos(p[0] * 0.17) + 0.3 * Math.sin(p[1] * 0.71),
]
export const count = (tris: Tri[], p: V) =>
  tris.reduce((n, [a, b, c]) => n + (geometry.vsmTInside(a, b, c, p) ? 1 : 0), 0)
