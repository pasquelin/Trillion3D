// Generated scenes for the exact transmission read (`transmissionWgsl.ts`), a brute-force cast in
// f64 and the texel store the read replaced, to hold the read against.
import { type Caster, pack, unpack } from './transmissionRead.fixture.ts'
import {
  type Tri,
  type V,
  f32,
  geometry,
  random,
  sheet,
  waves,
} from './transmissionSheets.fixture.ts'

/** A brute-force cast in f64: the casters strictly above `z` at `p`, their factors multiplied. */
export function oracle(casters: Caster[], p: V, z: number) {
  let through = [1, 1, 1]
  for (const { tri, d, q } of casters) {
    const [a, b, c] = tri
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    const wa = ((b[0] - p[0]) * (c[1] - p[1]) - (b[1] - p[1]) * (c[0] - p[0])) / area
    const wb = ((c[0] - p[0]) * (a[1] - p[1]) - (c[1] - p[1]) * (a[0] - p[0])) / area
    const wc = 1 - wa - wb
    if (wa < 0 || wb < 0 || wc < 0) continue
    if (wa * d[0] + wb * d[1] + wc * d[2] <= z) continue
    through = through.map((x, i) => x * (1 - unpack(q)[i]))
  }
  return through
}

/** The texel store the read replaces, at each texel centre: the casters over it multiplied in 8
 *  bits from white (stored as 1 − colour), the nearest one's height; read as four texels each
 *  compared with the receiver, mixed bilinearly. */
export function texelStore(casters: Caster[]) {
  const word = new Uint32Array(128 * 128),
    top = new Float64Array(128 * 128).fill(-Infinity)
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const c = [x + 0.5, y + 0.5]
      for (const { tri, d, q } of casters) {
        if (!geometry.vsmTInside(...tri, c)) continue
        const [a, b, cc] = tri
        const area = (b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0])
        const wa = ((b[0] - c[0]) * (cc[1] - c[1]) - (b[1] - c[1]) * (cc[0] - c[0])) / area
        const wb = ((cc[0] - c[0]) * (a[1] - c[1]) - (cc[1] - c[1]) * (a[0] - c[0])) / area
        const h = wa * d[0] + wb * d[1] + (1 - wa - wb) * d[2]
        const old = unpack(word[y * 128 + x])
        word[y * 128 + x] = pack(old.map((o, i) => 1 - (1 - o) * (1 - unpack(q)[i])))
        top[y * 128 + x] = Math.max(top[y * 128 + x], h)
      }
    }
  return (p: V, z: number) => {
    const h = p.map((v) => Math.min(Math.max(v - 0.5, 0), 127))
    const i = h.map(Math.floor),
      f = h.map((v, k) => v - i[k])
    const j = i.map((v) => Math.min(v + 1, 127))
    const at = (x: number, y: number) =>
      top[y * 128 + x] > z ? unpack(word[y * 128 + x]).map((c) => 1 - c) : [1, 1, 1]
    const [a, b, c, d] = [at(i[0], i[1]), at(j[0], i[1]), at(i[0], j[1]), at(j[0], j[1])]
    return [0, 1, 2].map((k) => {
      const lo = a[k] + (b[k] - a[k]) * f[0],
        hi = c[k] + (d[k] - c[k]) * f[0]
      return lo + (hi - lo) * f[1]
    })
  }
}

export const byte = (c: V) => c.map((x) => Math.round(x * 255))

/** Generated scenes: a wave sheet over part of the page (its edge crossing it), a pane, slivers. */
export function scene(seed: number): Caster[] {
  const rnd = random(seed)
  const colour = () => pack([0.2 + 0.6 * rnd(), 0.2 + 0.6 * rnd(), 0.2 + 0.6 * rnd()])
  const sea = colour()
  const height = (p: V) => 2 + 0.3 * Math.sin(p[0] * 0.1 + seed) + 0.2 * Math.cos(p[1] * 0.13)
  const casters: Caster[] = sheet(6, -20 + 30 * rnd(), 70 + 40 * rnd(), waves).map((tri) => ({
    tri,
    d: tri.map(height).map(f32),
    q: sea,
  }))
  const ox = 70 + 30 * rnd(),
    oy = 10 + 30 * rnd()
  const pane: Tri = [
    [ox, oy],
    [ox + 25 + 10 * rnd(), oy + 3],
    [ox + 5, oy + 30 + 10 * rnd()],
  ].map((v) => v.map(f32)) as Tri
  casters.push({ tri: pane, d: [5, 5, 5], q: colour() })
  return casters
}
