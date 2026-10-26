import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { aoOcclusionShader, aoShapeOf } from './occlusionWgsl.ts'
import { quadBlur } from './reference.fixture.ts'
import { runChain } from './chain.fixture.ts'
import { createScene, HEIGHT, sceneScope, settingsOf, uniformOf, WIDTH } from './scene.fixture.ts'

// The screen-space ambient occlusion (`./`): its tables, its plan and its uniform, then its shaders run in JavaScript over
// a synthetic view (`scene.fixture.ts`) and set against the search written apart (`reference.fixture.ts`).
test('a flat wall, a box’s face and the open sky are unoccluded; a concave corner is, near its crease', () => {
  const searchOf = (geometry: object, quality = 30) => {
    const scene = createScene(geometry)
    const settings = settingsOf({ ambientOcclusionLevels: 1, ambientOcclusionQuality: quality })
    const { aoSearch } = shaderRun<{ aoSearch: (p: number[]) => { value: number } }>(
      aoOcclusionShader(aoShapeOf('final', settings.shaderQuality, false)),
      ['aoSearch'],
      sceneScope(scene, uniformOf(1, 0, settings)),
    )
    return { scene, at: (x: number, y: number) => aoSearch([x, y]).value }
  }
  const every = Array.from({ length: HEIGHT }, (_, y) => y)
  const values = (at: (x: number, y: number) => number, rows: number[]) =>
    rows.flatMap((y) => Array.from({ length: WIDTH }, (_, x) => at(x, y)))
  // A wall facing the eye and an empty sky give every pixel the whole sky: a value of exactly one.
  assert.ok(
    values(searchOf({ wall: 5 }).at, every).every((v) => v === 1),
    'a flat wall',
  )
  assert.ok(
    values(searchOf({}).at, every).every((v) => v === 1),
    'no surface at all',
  )
  // A floor seen at a grazing angle is lightly marked, by the depth pyramid's blocks of two pixels, never as a crease.
  const floor = values(searchOf({ floor: 1.5 }).at, every)
  assert.ok(Math.min(...floor) > 0.8, `a grazing floor: ${Math.min(...floor)}`)
  const corner = searchOf({ floor: 1.5, wall: 6 }).at
  // The crease sits near row 26 of 36: the wall just above it and the floor just under it are occluded, the far wall is not.
  const near = values(corner, [23, 24, 25, 26, 27, 28])
  assert.ok(Math.min(...near) < 0.7, `the crease: ${Math.min(...near)}`)
  assert.ok(near.every((v) => v <= 1 && v > 0.5))
  assert.ok(
    values(corner, [0, 1, 2, 3, 4, 5]).every((v) => v === 1),
    'the wall far from the crease',
  )
  // A box standing in front of the wall: its own face is unoccluded, as a convex surface is.
  const { scene, at } = searchOf({ wall: 6, box: 3.5 })
  let faces = 0
  for (const y of every)
    for (let x = 0; x < WIDTH; x++)
      if (scene.surfaceAt(x, y).depth === 3.5) {
        faces++
        assert.equal(at(x, y), 1, `the box's face at (${x}, ${y})`)
      }
  assert.ok(faces > 100, `${faces} pixels of the face`)
})

test('the occlusion’s passes are the search written apart, through each quality, resolution and radius mode', () => {
  const geometry = { floor: 1.5, wall: 6, box: 3.5 }
  // Each shader quality, over one, two and three resolutions (the blur among a quad is the fragment stage's, apart from the search).
  for (const [quality, levels] of [
    [3, 1],
    [10, 2],
    [30, 3],
    [60, 2],
    [80, 3],
    [100, 1],
  ]) {
    const chain = runChain(geometry, {
      ambientOcclusionQuality: quality,
      ambientOcclusionLevels: levels,
    })
    assert.equal(chain.passes.length, [1, 3, 5][levels - 1])
    assert.ok(chain.worst < 2e-6, `quality ${quality}, ${levels} levels: ${chain.worst}`)
  }
  // The radius in the world's units, a larger bias, power and intensity, another climb of the pyramid.
  const tuned = runChain(geometry, {
    ambientOcclusionQuality: 80,
    ambientOcclusionRadiusInWorldSpace: true,
    ambientOcclusionRadius: 1.2,
    ambientOcclusionBias: 6,
    ambientOcclusionPower: 1.5,
    ambientOcclusionIntensity: 0.8,
    ambientOcclusionMipScale: 2.5,
  })
  assert.ok(tuned.worst < 2e-6, `tuned: ${tuned.worst}`)
  // The coarse levels do blend in: the same view at one resolution differs from three.
  const one = runChain(geometry, { ambientOcclusionQuality: 80, ambientOcclusionLevels: 1 })
  const three = runChain(geometry, { ambientOcclusionQuality: 80, ambientOcclusionLevels: 3 })
  assert.notDeepEqual(one.wgsl, three.wgsl)
})

test('the compute pass makes one resolution from the depth’s normals and smooths it, as the same pass written apart', () => {
  const geometry = { floor: 1.5, wall: 6, box: 3.5 }
  const kinds = (chain: ReturnType<typeof runChain>) => chain.passes.map((pass) => pass.kind)
  const smoothed = runChain(geometry, { ambientOcclusionCompute: 1 })
  const plain = runChain(geometry, {
    ambientOcclusionCompute: 3,
    ambientOcclusionComputeSmooth: false,
    ambientOcclusionQuality: 90,
    ambientOcclusionLevels: 3,
  })
  // One resolution whatever the quality and the levels ask, and the smoothing a pass of its own, unless the setting leaves it out.
  assert.deepEqual([kinds(smoothed), kinds(plain)], [['final', 'smooth'], ['final']])
  assert.ok(smoothed.worst < 2e-6 && plain.worst < 2e-6, `${smoothed.worst} ${plain.worst}`)
  // The smoothing is a box of the result: it moves what the unsmoothed pass leaves.
  const bare = runChain(geometry, {
    ambientOcclusionCompute: 1,
    ambientOcclusionComputeSmooth: false,
  })
  const moved = smoothed.wgsl.flat().filter((v, i) => Math.abs(v - bare.wgsl.flat()[i]) > 1e-3)
  assert.ok(moved.length > 20, `${moved.length} texels moved`)
})

test('a pixel past the fade’s end leaves the occlusion at one, and the intensity scales what is left', () => {
  const geometry = { floor: 1.5, wall: 6 }
  // Fade out from 2.5 m to 3 m: the wall, 6 m away, takes none; the floor near the eye still does.
  const faded = runChain(geometry, {
    ambientOcclusionLevels: 1,
    ambientOcclusionFadeDistance: 3,
    ambientOcclusionFadeRadius: 0.5,
  })
  assert.ok(faded.worst < 2e-6)
  const wall = faded.wgsl.slice(0, 20).flat()
  assert.ok(
    wall.every((v) => v === 1),
    'the wall past the fade',
  )
  const half = runChain(geometry, { ambientOcclusionLevels: 1, ambientOcclusionIntensity: 0.25 })
  const full = runChain(geometry, { ambientOcclusionLevels: 1, ambientOcclusionIntensity: 1 })
  const crease = (chain: typeof half) => Math.min(...chain.wgsl.flat())
  // 1 - (1 - raised) · intensity: a quarter of the darkening is a quarter of the whole's.
  assert.ok(Math.abs(1 - crease(half) - (1 - crease(full)) / 4) < 1e-6)
})

test('a pixel blends with its two neighbours of the quad by how alike their normals are, as the fine derivatives read them', () => {
  const scene = createScene({ floor: 1.5, wall: 6 })
  const settings = settingsOf({ ambientOcclusionLevels: 1, ambientOcclusionQuality: 30 })
  const text = aoOcclusionShader(aoShapeOf('final', settings.shaderQuality, false))
  const { aoSearch } = shaderRun<{ aoSearch: (p: number[]) => AoSample }>(
    text,
    ['aoSearch'],
    sceneScope(scene, uniformOf(1, 0, settings)),
  )
  type AoSample = { value: number; depth: number; normal: number[] }
  const at = (x: number, y: number) => aoSearch([x, y])
  // The fine derivative along an axis is the difference of the quad's two pixels along it, the same for both of them.
  const derivative = (axis: 0 | 1, x: number, y: number) => {
    const [a, b] = axis ? [at(x, y & ~1), at(x, y | 1)] : [at(x & ~1, y), at(x | 1, y)]
    return [b.value - a.value, 0, b.normal[0] - a.normal[0], b.normal[1] - a.normal[1]]
  }
  let blurred = 0
  for (const [x, y] of [
    [10, 25],
    [11, 25],
    [10, 26],
    [11, 26],
    [30, 27],
    [31, 26],
  ]) {
    const own = at(x, y)
    const { aoQuadBlur } = shaderRun<{ aoQuadBlur: (s: AoSample, p: number[]) => number }>(
      text,
      ['aoQuadBlur'],
      { dpdxFine: () => derivative(0, x, y), dpdyFine: () => derivative(1, x, y) },
    )
    const got = aoQuadBlur(own, [x, y])
    const want = quadBlur(own, x, y, at)
    assert.ok(Math.abs(got - want) < 1e-6, `(${x}, ${y}): ${got} against ${want}`)
    blurred += Math.abs(got - own.value)
  }
  assert.ok(blurred > 0, 'the blur moves the values near the crease')
})
