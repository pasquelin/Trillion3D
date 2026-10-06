import test from 'node:test'
import assert from 'node:assert/strict'
import { createWater, type WaterSpec } from '../../../sdk-core/src/fluids/index.ts'
import type { Waves } from '../../../sdk-core/src/fluids/waves.ts'
import { OCEAN } from '../../../sdk-core/src/fluids/waves.fixture.ts'
import { PLANE_WORDS, WATER_PIECE_WORDS } from '../../../sdk-core/src/physics/index.ts'
import { random } from '../page/cut/cutRuleChecks.fixture.ts'
import { startModule, type Module } from './module.fixture.ts'
import { waveRest } from '../../../sdk-core/src/fluids/waveRest.ts'

/** `wavePatch` as the page computes it without the module: the frozen oracle, never edited. */
function patch(
  waves: Waves,
  px: number,
  pz: number,
  hx: number,
  hz: number,
  corners: Float64Array,
) {
  let y = 0
  corners.fill(0)
  for (let i = 0; i < waves.count; i++) {
    const [dx, dz, k] = [waves.dirX[i], waves.dirZ[i], waves.k[i]]
    const [amplitude, lateral] = [waves.amplitude[i], waves.lateral[i]]
    const f = k * (dx * px + dz * pz) - waves.phase[i]
    const [s, c] = [Math.sin(f), Math.cos(f)]
    const [sa, ca] = [Math.sin(k * dx * hx), Math.cos(k * dx * hx)]
    const [sb, cb] = [Math.sin(k * dz * hz), Math.cos(k * dz * hz)]
    y += amplitude * s
    for (let corner = 0; corner < 4; corner++) {
      const [sx, sz] = [corner & 1 ? 1 : -1, corner & 2 ? 1 : -1]
      const sinD = sx * sa * cb + sz * ca * sb,
        cosD = ca * cb - sx * sz * sa * sb
      const cosF = c * cosD - s * sinD
      corners[corner * 3] += lateral * dx * cosF
      corners[corner * 3 + 1] += amplitude * (s * cosD + c * sinD)
      corners[corner * 3 + 2] += lateral * dz * cosF
    }
  }
  for (let corner = 0; corner < 4; corner++) {
    corners[corner * 3] += px + (corner & 1 ? hx : -hx)
    corners[corner * 3 + 2] += pz + (corner & 2 ? hz : -hz)
  }
  return y
}

/** The planes the page's `StepWords` writes for `pieces` without the module computing them. */
function oracle(water: ReturnType<typeof createWater>, pieces: Float32Array) {
  const count = pieces.length / WATER_PIECE_WORDS,
    out = new Uint32Array(count * PLANE_WORDS),
    f = new Float32Array(out.buffer),
    ids = new Uint32Array(pieces.buffer, pieces.byteOffset, pieces.length),
    p = new Float64Array(3),
    c = new Float64Array(12)
  for (let i = 0; i < count; i++) {
    const [from, to] = [i * WATER_PIECE_WORDS, i * PLANE_WORDS]
    const [x, z] = [pieces[from + 2], pieces[from + 3]]
    const hx = Math.max(pieces[from + 4], water.sample),
      hz = Math.max(pieces[from + 5], water.sample)
    waveRest(water.waves, x, z, p)
    const y = patch(water.waves, p[0], p[2], hx, hz, c)
    const [ax, ay, az] = [c[6] - c[3], c[7] - c[4], c[8] - c[5]]
    const [bx, by, bz] = [c[9] - c[0], c[10] - c[1], c[11] - c[2]]
    const [nx, ny, nz] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
    const length = Math.hypot(nx, ny, nz)
    out.set([ids[from], ids[from + 1]], to)
    f.set([x, water.level + y, z, nx / length, ny / length, nz / length], to + 2)
  }
  return out
}

/** The module's planes for `pieces` (written into its command buffer) on `water`'s waves, through
 *  the worker's own call. */
function planes(jolt: Module, water: ReturnType<typeof createWater>, pieces: Float32Array) {
  const at = (
    jolt.raw.exports as unknown as { jolt_buffer(a: number, b: number): number }
  ).jolt_buffer(0, Math.max(1, pieces.length))
  new Float32Array(jolt.raw.memory.buffer, at, pieces.length).set(pieces)
  const count = pieces.length / WATER_PIECE_WORDS
  return jolt.planes(water.waves, water.level, water.sample, count, at).slice()
}

/** Word for word, a NaN matching any NaN (its payload is the platform's). */
function same(module: Uint32Array, page: Uint32Array, what: string) {
  const [a, b] = [new Float32Array(module.buffer), new Float32Array(page.buffer)]
  const differ = [...module.keys()].filter(
    (i) => module[i] !== page[i] && !(a[i] !== a[i] && b[i] !== b[i]),
  )
  assert.deepEqual(differ, [], `${what}: words ${differ.slice(0, 4)} differ`)
}

const EDGES = [0, -0, NaN, Infinity, -Infinity, 1e-30, 3.4e38, -1e5]

test("the module's water planes are the page's, word for word, on random waves and pieces", async () => {
  const jolt = await startModule()
  for (let seed = 1; seed <= 60; seed++) {
    const next = random(seed)
    const waves = Array.from({ length: Math.floor(next() * 9) }, () => ({
      direction: [next() - 0.5, next() < 0.2 ? 0 : next() - 0.5] as [number, number],
      wavelength: 0.5 + next() * 200,
      amplitude: next() < 0.15 ? 0 : next() * 2,
      steepness: next() < 0.2 ? [0, 1][Math.floor(next() * 2)] : next(),
      phase: next() * 7,
    }))
    const spec: WaterSpec = { waves, level: (next() - 0.5) * 20 }
    const water = createWater(spec)
    water.waves.setTime(seed % 5 ? next() * 100 : 1e5 + next())
    const count = Math.floor(next() * 40)
    const pieces = new Float32Array(count * WATER_PIECE_WORDS)
    const ids = new Uint32Array(pieces.buffer)
    for (let i = 0; i < count; i++) {
      const at = i * WATER_PIECE_WORDS
      ids[at] = (next() * 2 ** 32) >>> 0
      ids[at + 1] = i | (count << 16)
      for (let k = 2; k < WATER_PIECE_WORDS; k++)
        pieces[at + k] =
          next() < 0.08
            ? EDGES[Math.floor(next() * EDGES.length)]
            : k < 4
              ? (next() - 0.5) * 2e4
              : next() * [0.01, 1, 30][Math.floor(next() * 3)]
    }
    same(planes(jolt, water, pieces), oracle(water, pieces), `seed ${seed}`)
  }
})

test('the planes the worker takes for a step are the pieces the module listed, fitted', async () => {
  const jolt = await startModule()
  const water = createWater({ waves: OCEAN, level: 3 })
  water.waves.setTime(7.25)
  const pieces = new Float32Array([0, 0, 10, -4, 0.5, 0.5, 0, 0, -3, 2, 5, 0.01])
  new Uint32Array(pieces.buffer).set([7, 1 << 16], 0)
  new Uint32Array(pieces.buffer).set([9, 1 << 16], WATER_PIECE_WORDS)
  const words = planes(jolt, water, pieces)
  same(words, oracle(water, pieces), 'ocean')
  const normal = new Float32Array(words.buffer).subarray(PLANE_WORDS + 5, PLANE_WORDS + 8)
  assert.ok(normal.every(Number.isFinite) && normal[1] > 0.5, `a thin piece's normal ${normal}`)
})
