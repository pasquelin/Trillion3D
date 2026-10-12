// Two glass panes facing each other at an angle, over a floor, each with an opaque base (`glassPage.ts`):
// the one reflection chain meets a blended surface as it meets a wall.
//
//  - pane A's pixels whose exact mirror ray meets pane B, and those whose ray meets B's base, change
//    with B as B is composited where the ray lands: the difference B makes in A's pixel follows the
//    difference it makes at the pixel the ray meets (a correlation near one over every channel);
//  - pane B, alone, reflects the floor and the bases only: its pixel's difference from the same image
//    without it follows what the ray meets, and no streak of its own pixels runs along it;
//  - B's base, an opaque surface behind the glass, is drawn, never culled by the glass in front.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/glass.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import type { GlassReading } from './glassPage.ts'

/** The Pearson correlation of two series, and the mean magnitude of the first. */
function correlate(x: number[], y: number[]) {
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n,
    my = y.reduce((a, b) => a + b, 0) / n
  let sxy = 0,
    sxx = 0,
    syy = 0
  for (let k = 0; k < n; k++) {
    sxy += (x[k] - mx) * (y[k] - my)
    sxx += (x[k] - mx) ** 2
    syy += (y[k] - my) ** 2
  }
  return {
    r: sxy / Math.sqrt(sxx * syy || 1),
    mean: x.reduce((a, b) => a + Math.abs(b), 0) / n,
  }
}

/** The share of the variance of `y` that `a·u + b·v + c` explains, by least squares (R²). */
function explained(y: number[], u: number[], v: number[]) {
  const n = y.length
  const rows = y.map((_, k) => [u[k], v[k], 1])
  const normal = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0)),
  )
  const rhs = [0, 1, 2].map((i) => rows.reduce((s, r, k) => s + r[i] * y[k], 0))
  // Gauss–Jordan on the 3 × 3 normal equations.
  for (let i = 0; i < 3; i++) {
    const pivot = normal[i][i] || 1e-12
    for (let j = 0; j < 3; j++)
      if (j !== i) {
        const f = normal[j][i] / pivot
        for (let k = 0; k < 3; k++) normal[j][k] -= f * normal[i][k]
        rhs[j] -= f * rhs[i]
      }
  }
  const [a, b, c] = rhs.map((value, i) => value / (normal[i][i] || 1e-12))
  const mean = y.reduce((s, value) => s + value, 0) / n
  let residual = 0,
    total = 0
  y.forEach((value, k) => {
    residual += (value - (a * u[k] + b * v[k] + c)) ** 2
    total += (value - mean) ** 2
  })
  return 1 - residual / (total || 1)
}

/** The half-side of the square of pixels a ray's footprint reads, around the pixel it meets. */
const SOFT = 1

test('a pane reflects the neighbouring pane and its base, never itself', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'glassPage.ts'),
    'reflectionGlass',
  )) as typeof import('./glassPage.ts')
  const result = (await runOnDawn(page.run, undefined)) as GlassReading & {
    error?: string
    errors?: string[]
  }
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.held, [true, true, true, true, true, true], 'every image is held')
  const { images, seesPane, seesBase, seesFloor, behindPane } = result
  const size = result.size
  /** A pixel's channels, the mean of the `2 · soft + 1` square around it (a ray's footprint). */
  const pixel = (image: number[], p: number, soft = 0) => {
    const sum = [0, 0, 0]
    let count = 0
    for (let v = -soft; v <= soft; v++)
      for (let u = -soft; u <= soft; u++) {
        const x = (p % size[0]) + u,
          y = Math.floor(p / size[0]) + v
        if (x < 0 || y < 0 || x >= size[0] || y >= size[1]) continue
        for (let k = 0; k < 3; k++) sum[k] += image[(y * size[0] + x) * 4 + k]
        count++
      }
    return sum.map((value) => value / count)
  }
  /** The correlation of what `near` differs from `far` at the pixels of `pairs`, with what `then`
   *  differs from `now` at the pixel each one's ray meets. */
  const follows = (
    pairs: [number, number][],
    [near, far]: [number[], number[]],
    [then, now]: [number[], number[]],
  ) => {
    const here: number[] = [],
      there: number[] = []
    for (const [p, h] of pairs) {
      const a = pixel(near, p),
        b = pixel(far, p),
        c = pixel(then, h, SOFT),
        d = pixel(now, h, SOFT)
      for (let k = 0; k < 3; k++) {
        here.push(a[k] - b[k])
        there.push(c[k] - d[k])
      }
    }
    return correlate(here, there)
  }
  // The same scene with B's pane another colour, then with B's base another: what A shows of each
  // changes as each changes where A's ray meets it.
  const pane = follows(seesPane, [images.full, images.tinted], [images.full, images.tinted])
  const base = follows(seesBase, [images.full, images.rebased], [images.full, images.rebased])
  // B alone: what a pixel shows is what lies behind it and what its ray meets — the floor and the
  // bases, which lie in the image where the ray lands: any streak of its own pixels breaks the fit.
  const channels = [0, 1, 2].map((k) => {
    const shown: number[] = [],
      behind: number[] = [],
      met: number[] = []
    for (const [p, h] of seesFloor) {
      shown.push(pixel(images.alone, p)[k])
      behind.push(pixel(images.bare, p)[k])
      met.push(pixel(images.alone, h, SOFT)[k])
    }
    return explained(shown, behind, met)
  })
  const alone = Math.min(...channels)
  console.log(
    JSON.stringify({
      pane: [seesPane.length, pane],
      base: [seesBase.length, base],
      alone: [seesFloor.length, alone],
    }),
  )
  assert.ok(seesPane.length > 300 && seesBase.length > 100 && seesFloor.length > 100)
  assert.ok(pane.mean > 1 && base.mean > 1, `B changes what A shows: ${pane.mean}, ${base.mean}`)
  assert.ok(pane.r > 0.9, `A follows B's pane as composited: ${pane.r}`)
  assert.ok(base.r > 0.9, `A follows B's base as composited: ${base.r}`)
  assert.ok(alone > 0.9, `B alone shows what lies behind it and what its ray meets: ${alone}`)
  // B's base behind B's pane: drawn, green over the grey floor.
  const green = behindPane.filter((p) => {
    const [r, g, b] = pixel(images.full, p)
    return g > r + 20 && g > b + 20
  })
  assert.ok(behindPane.length > 100)
  assert.ok(green.length >= 0.9 * behindPane.length, `${green.length} of ${behindPane.length}`)
})
