// The shadow mask denoise (`denoisePass.ts`, `denoiseWgsl.ts`): its programs and its passes' count, that it
// opens no pass when off, and its filter run in JavaScript on a tiny mask (`shaderRun.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { VSM_DENOISE_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { denoisePasses, denoiseProjected, writeDenoiseParams } from './denoisePass.ts'
import { vsmDenoiseWgsl, DENOISE_PARAM_WORDS, type DenoiseKind } from './denoiseWgsl.ts'
import { SHADOW_MAP_DEFAULTS_FOR_TEST } from './denoise.fixture.ts'

const KINDS: DenoiseKind[] = ['sun', 'light', 'r32uint', 'rg32uint', 'rgba32uint']

test('the pass is labelled vsm.denoise', () => {
  assert.equal(VSM_DENOISE_PASS, 'vsm.denoise')
})

test('every mask has a program with its entry, reading the geometry and the 3x3 neighbourhood skip', () => {
  for (const kind of KINDS) {
    const text = vsmDenoiseWgsl(kind)
    assert.match(text, /fn vsmDenoise\(/, kind)
    assert.match(text, /hi<=0\.0\|\|lo>=1\.0|dnLaneVaries/, kind)
    assert.match(text, /textureLoad\(dnDepth/, kind)
  }
})

test('the denoise has passes where on and none where off; an odd count begins with a copy', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(denoisePasses), [0, 2, 2, 4, 4])
})

test('with the denoise off nothing is opened or encoded', () => {
  const steps = {
    pass: () => assert.fail('a pass was opened'),
  } as never
  const masks = {
    suns: { width: 4, height: 4, depthOrArrayLayers: 1 } as GPUTexture,
    sunsView: {} as GPUTextureView,
    sunCount: 1,
    localFormat: 'r32uint' as const,
  }
  denoiseProjected({} as GPUDevice, steps, SHADOW_MAP_DEFAULTS_FOR_TEST.view, 0, masks)
})

test('the pass parameters carry the projection, the rect, the step and the copy flag', () => {
  const into = new Float32Array(DENOISE_PARAM_WORDS)
  const view = SHADOW_MAP_DEFAULTS_FOR_TEST.view
  writeDenoiseParams(into, view, [1, 2, 3, 4], 3, 0)
  assert.deepEqual([...new Int32Array(into.buffer, 0, 4)], [1, 2, 3, 4])
  assert.deepEqual([into[24], into[25]], [0, 1], 'an odd count begins with a copy')
  writeDenoiseParams(into, view, [0, 0, 8, 8], 3, 1)
  assert.deepEqual([into[24], into[25]], [1, 0])
  writeDenoiseParams(into, view, [0, 0, 8, 8], 3, 3)
  assert.deepEqual([into[24], into[25]], [4, 0])
  writeDenoiseParams(into, view, [0, 0, 8, 8], 2, 1)
  assert.deepEqual([into[24], into[25]], [2, 0])
})

// A flat wall facing a perspective camera 10 units away, 12 × 12 pixels, reverse-Z with the near plane 0.1.
const SIZE = 12
const NEAR = 0.1
const depthAt = (distance: number) => NEAR / distance
const filterOf = (
  mask: (x: number, y: number) => number,
  distanceAt: (x: number, y: number) => number = () => 10,
  phase = [1, 0, 0, 0],
) => {
  const dn = {
    rect: [0, 0, SIZE, SIZE],
    depthMap: [0, NEAR, -1, 0],
    scale: [1, 1, 2 / SIZE, 2 / SIZE],
    row0: [1, 0, 0, 0],
    row1: [0, 1, 0, 0],
    row2: [0, 0, 1, 0],
    phase,
  }
  const scalar = (value: (x: number, y: number) => number) => ({
    load: ([x, y]: number[]) => [value(x, y), 0, 0, 1],
  })
  const run = shaderRun<{
    dnSmooth: (p: number[], layer: number) => number[]
    dnGeometryWeight: (d: number, z: number, n: number[], q: number[]) => number
    dnPlaneOffset: (z: number, n: number[], p: number[]) => number
    dnViewZ: (d: number) => number
  }>(vsmDenoiseWgsl('sun'), ['dnSmooth', 'dnGeometryWeight', 'dnPlaneOffset', 'dnViewZ'], {
    dn,
    dnDepth: { load: ([x, y]: number[]) => depthAt(distanceAt(x, y)) },
    dnNormals: { load: () => [0, 0, 1, 0] },
    dnSrc: scalar(mask),
  })
  return run
}

test('a pixel whose 3x3 neighbourhood is wholly lit or wholly shadowed is left as it is', () => {
  const lit = filterOf(() => 1)
  const dark = filterOf(() => 0)
  assert.equal(lit.dnSmooth([6, 6], 0)[0], 1)
  assert.equal(dark.dnSmooth([6, 6], 0)[0], 0)
  // Next to a texel of another value it is filtered.
  const next = filterOf((x) => (x === 7 ? 0 : 1))
  assert.ok(next.dnSmooth([6, 6], 0)[0] < 1)
})

test('the grain of a penumbra is averaged, the result staying between 0 and 1', () => {
  const grain = filterOf((x, y) => ((x + y) & 1 ? 1 : 0))
  for (let y = 3; y < 9; y++)
    for (let x = 3; x < 9; x++) {
      const raw = (x + y) & 1 ? 1 : 0
      const out = grain.dnSmooth([x, y], 0)[0]
      assert.ok(out > 0 && out < 1, `${x},${y}: ${out}`)
      assert.ok(Math.abs(out - 0.5) < Math.abs(raw - 0.5), `${x},${y} moved toward the mean`)
    }
})

test('a tap on another surface weighs nothing, a tap on the pixel’s own plane weighs as much as a tap on a flat wall', () => {
  const far = filterOf(
    () => 0,
    (x) => (x < 6 ? 10 : 20),
  )
  const z = far.dnViewZ(depthAt(10))
  const n = [0, 0, 1]
  const d = far.dnPlaneOffset(z, n, [5, 6])
  assert.ok(far.dnGeometryWeight(d, z, n, [4, 6]) > 0.99)
  assert.ok(far.dnGeometryWeight(d, z, n, [6, 6]) < 1e-6)
})

test('a hard edge between two surfaces stays: the other side does not bleed into the pixel', () => {
  // Mask 1 on the near wall, 0 on a far wall, a grained penumbra on none: the pixel at the edge keeps its side.
  const wall = filterOf(
    (x) => (x < 6 ? 1 : 0),
    (x) => (x < 6 ? 10 : 20),
  )
  assert.ok(wall.dnSmooth([5, 6], 0)[0] > 0.999)
  assert.ok(wall.dnSmooth([6, 6], 0)[0] < 0.001)
})

test('a copy pass writes the pixel as it reads it', () => {
  const copy = filterOf((x, y) => ((x + y) & 1 ? 1 : 0), () => 10, [1, 1, 0, 0])
  assert.equal(copy.dnSmooth([5, 5], 0)[0], 0)
  assert.equal(copy.dnSmooth([5, 6], 0)[0], 1)
})

test('a packed mask’s lanes are filtered alone: a uniform lane stays, a grained lane is averaged', () => {
  // Lane 0 holds a checkerboard of 0 and 15, lane 1 a constant 15, in a 12 × 12 one-word mask.
  const word = (x: number, y: number) => (((x + y) & 1 ? 15 : 0) | (15 << 4)) >>> 0
  const run = shaderRun<{ dnSmoothPacked: (p: number[]) => number[] }>(
    vsmDenoiseWgsl('r32uint'),
    ['dnSmoothPacked'],
    {
      dn: {
        rect: [0, 0, SIZE, SIZE],
        depthMap: [0, NEAR, -1, 0],
        scale: [1, 1, 2 / SIZE, 2 / SIZE],
        row0: [1, 0, 0, 0],
        row1: [0, 1, 0, 0],
        row2: [0, 0, 1, 0],
        phase: [1, 0, 0, 0],
      },
      dnDepth: { load: () => depthAt(10) },
      dnNormals: { load: () => [0, 0, 1, 0] },
      dnSrc: { load: ([x, y]: number[]) => [word(x, y), 0, 0, 1] },
    },
  )
  const out = run.dnSmoothPacked([6, 6])[0]
  assert.equal((out >>> 4) & 15, 15, 'the lit lane is as it was')
  const lane0 = out & 15
  assert.ok(lane0 > 0 && lane0 < 15, `lane 0 averaged: ${lane0}`)
})

test('the interior of a block the adaptive stop left is filtered, a region two steps from any change is not', () => {
  const block = filterOf((x, y) => (x >= 2 && x <= 9 && y >= 4 && y <= 7 ? 0 : 1))
  assert.ok(block.dnSmooth([5, 5], 0)[0] > 0, 'a block texel two rows from its edge is filtered')
  const lit = filterOf((x) => (x === 11 ? 0 : 1))
  assert.equal(lit.dnSmooth([4, 6], 0)[0], 1, 'far from the change it stays')
})
