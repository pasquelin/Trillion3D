// The fog volume (`./fog/`): its grid and its frame, the view block a surface reads it from, and the
// text of its programs read by name. Its programs run as shipped (`shaderRun`) in `fogScatter.test.ts`,
// `fogIntegrate.test.ts` and `fogRead.test.ts`; its work on the kit's device is `fogVolumeGpu.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { halton } from '../../../math/src/sequence/halton.ts'
import { VOLUMETRIC_FOG_FILTERS } from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { FOG_MATCH_GLOW_SCALE, FOG_VOLUME_FRAME_AT, writeSampleOffsets } from './fog/layout.ts'
import { sliceParams, volumeUvMax, cellGrid } from './fog/layout.ts'
import { FOG_VOLUME_FLAG, writeFogVolumeFrame } from './fog/frame.ts'
import { writeFogViewBlock } from './fog/viewBlock.ts'
import { FOG_VIEW_FLOATS, FOG_VIEW_SLOT } from './fog/viewSlots.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'
import type { ResolvedHeightFog } from '../../../sdk-core/src/scene/core/fogHeight.ts'
import type { ResolvedVolumetricFog } from '../../../sdk-core/src/scene/core/fogVolumetric.ts'
import {
  camera,
  depthAtSlice,
  image,
  newFogVolumeFrame,
  previousOf,
  sliceAtDepth,
} from './fogVolumeRun.fixture.ts'
import { assertProgramAssembles } from '../gpu/core/wgslNames.fixture.ts'

test('the grid: a cell a side of pixels across the view, the depth spread by its logarithm', () => {
  assert.deepEqual(cellGrid(1920, 1080, 8, 128), { x: 240, y: 135, z: 128, pixelSize: 8 })
  assert.deepEqual(cellGrid(1921, 1081, 16, 64), { x: 121, y: 68, z: 64, pixelSize: 16 })
  // Past what a texture holds the cell is made larger, the least that fits.
  assert.deepEqual(cellGrid(8000, 2000, 2, 4, 2048), { x: 2000, y: 500, z: 4, pixelSize: 4 })
  // The first slice starts a little past the near plane, the last ends at the far end.
  const p = sliceParams(0.1, 60, 32, 128)
  near([depthAtSlice(0, p), depthAtSlice(128, p)], [0.1 + 0.095, 60], 'ends', 1e-9)
  near([sliceAtDepth(depthAtSlice(37.5, p), p)], [37.5], 'round trip', 1e-9)
  // A smaller scale packs the slices nearer the eye: the first is thinner.
  const spread = sliceParams(0.1, 60, 8, 128)
  assert.ok(
    depthAtSlice(1, spread) - depthAtSlice(0, spread) < depthAtSlice(1, p) - depthAtSlice(0, p),
  )
  // The read's last coordinate keeps a bilinear tap inside the cells the view covers.
  const [u, v] = volumeUvMax(160, 90, cellGrid(160, 90, 8, 8))
  near([u, v], [(160 - 5) / 160, (96 - 5) / 96], 'uv max', 1e-9)
})

test('the jitter: the image’s Halton point first, the images before after it', () => {
  const offsets = new Float32Array(64)
  writeSampleOffsets(offsets, 0, 5, 4, true)
  near(
    Array.from(offsets.subarray(0, 4)),
    [halton(5, 2), halton(5, 3), halton(5, 5), 0],
    'now',
    1e-6,
  )
  near(
    Array.from(offsets.subarray(4, 8)),
    [halton(4, 2), halton(4, 3), halton(4, 5), 0],
    'before',
    1e-6,
  )
  // Past the samples asked, and without jitter, the centre of the cell.
  near(Array.from(offsets.subarray(16, 20)), [0.5, 0.5, 0.5, 0], 'unused', 0)
  writeSampleOffsets(offsets, 0, 5, 4, false)
  near(Array.from(offsets.subarray(0, 4)), [0.5, 0.5, 0.5, 0], 'none', 0)
})

/** The frame of the image over the test camera at `settings`, `frameIndex` 7, its offsets' first. */
const firstOffset = (settings: Parameters<typeof image>[2]) => {
  const img = { ...image(camera([1, 2, 3]), true, settings), frameIndex: 7 }
  const words = writeFogVolumeFrame(newFogVolumeFrame(), img)
  return Array.from(words.subarray(FOG_VOLUME_FRAME_AT.offsets, FOG_VOLUME_FRAME_AT.offsets + 3))
}

test('the samples move from image to image only where the history averages them', () => {
  const moving = { volumetricFogMovesSamples: true, volumetricFogUsesHistory: true }
  near(firstOffset(moving), [halton(7, 2), halton(7, 3), halton(7, 5)], 'moved', 1e-6)
  // With no history the cells would flicker: the offsets stay at the centre.
  near(
    firstOffset({ ...moving, volumetricFogUsesHistory: false }),
    [0.5, 0.5, 0.5],
    'no history',
    0,
  )
  near(firstOffset({ ...moving, volumetricFogMovesSamples: false }), [0.5, 0.5, 0.5], 'still', 0)
})

test('the frame: the grid, the depth numbers of the engine’s projection, the history blended in', () => {
  const cam = camera([1, 2, 3])
  const img = image(cam, { startAt: 2, fadeInLength: 4 })
  const w = writeFogVolumeFrame(newFogVolumeFrame(), img)
  const at = FOG_VOLUME_FRAME_AT
  const field = (f: number, n = 4) => Array.from(w.subarray(f, f + n))
  near(field(at.eye, 3), [1, 2, 3], 'eye', 0)
  near(field(at.grid), [20, 12, 8, 8], 'grid', 0)
  // Reversed depth: the device depth is near over the view depth, so A is 0 and B is the near plane.
  near(field(at.depthMap, 2), [0, 0.1], 'depth map', 1e-6)
  // The first slice starts at the volume's start, 2 m, a near plane being nearer.
  const p = sliceParams(2, 62, 32, 8)
  near(field(at.sliceMap), [p.b, p.o, 32, 1 / 8], 'slice map', 1e-5)
  const flags = field(at.medium)[3]
  const { glow, skipHidden, usesHistory, localShadows } = FOG_VOLUME_FLAG
  assert.equal(flags, glow | skipHidden | usesHistory | localShadows)
  assert.equal(field(at.medium)[2], 0.25)
  // The hidden cells are skipped only where the image says its pyramid is there.
  const bare = writeFogVolumeFrame(newFogVolumeFrame(), { ...img, skipHidden: false })
  assert.equal(bare[at.medium + 3], glow | usesHistory | localShadows)
  // The local lights read their shadows unless the setting says otherwise.
  const unshadowed = { ...img.settings, volumetricFogLocalShadows: false }
  const whole = writeFogVolumeFrame(newFogVolumeFrame(), { ...img, settings: unshadowed })
  assert.equal(whole[at.medium + 3], glow | skipHidden | usesHistory)
  // The rectangle lights' pictures tint the volume's light only where the setting says so (off by default).
  const textured = { ...img.settings, volumetricFogRectLightTexture: true }
  const tinted = writeFogVolumeFrame(newFogVolumeFrame(), { ...img, settings: textured })
  assert.equal(tinted[at.medium + 3], flags | FOG_VOLUME_FLAG.rectTexture)
  // No history, no blend; a previous image with the same grid, the setting's weight; reprojection off, none.
  assert.equal(field(at.blend)[0], 0)
  const previous = previousOf(cam, 160, 90)
  const after = writeFogVolumeFrame(newFogVolumeFrame(), { ...img, previous })
  assert.equal(after[at.blend], Math.fround(0.9))
  // The same view twice: the cells overhang it as before, the ratio is 1; the read may reach
  // `(cover − inset) / textures` along an axis, and the previous image's cells end at `cells / textures`.
  const words = (f: number) => Array.from(after.subarray(f, f + 4))
  near(words(at.previous), [1, 1, (160 - 5) / 160, (96 - 5) / 96], 'previous', 1e-6)
  near(words(at.history), [1, 1, 1, 1], 'history', 1e-6)
  const off = image(cam, true, { volumetricFogUsesHistory: false }, { previous })
  assert.equal(writeFogVolumeFrame(newFogVolumeFrame(), off)[at.blend], 0)
})

test('a view drawn smaller than the one before reads it where its cells were: the ratio of the overhangs, the cells it covered', () => {
  const cam = camera([1, 2, 3])
  const textures = image(cam).grid
  // The image before: 160 × 90, 20 × 12 cells of 8 pixels, overhanging its view by 1 and 90/96.
  // This one: 120 × 66, 15 × 9 cells, overhanging by 1 and 66/72, in the same textures.
  const smaller = camera([1, 2, 3], 120, 66)
  const now = { ...image(smaller), grid: { ...textures, x: 15, y: 9 }, resource: textures }
  const previous = previousOf(cam, 160, 90)
  const w = writeFogVolumeFrame(newFogVolumeFrame(), { ...now, previous })
  const at = FOG_VOLUME_FRAME_AT
  const words = (f: number) => Array.from(w.subarray(f, f + 4))
  const ratio = [1 / 1, 90 / 96 / (66 / 72)]
  near(words(at.previous).slice(0, 2), ratio, 'the overhangs before over now', 1e-6)
  near(words(at.history), [ratio[0], ratio[1], 1, 1], 'over the cells it covered', 1e-6)
  // The image before was the smaller one: its cells end short of the textures'.
  const back = writeFogVolumeFrame(newFogVolumeFrame(), {
    ...image(cam),
    previous: previousOf(cam, 120, 66),
  })
  near(Array.from(back.subarray(at.history + 2, at.history + 4)), [15 / 20, 9 / 12], 'ends', 1e-6)
})

/** What the view block takes of the camera and the fog beside the frame: a perspective view, no fog. */
const LOOK = { perspective: true, eyeHeight: 2, fog: {} as ResolvedHeightFog }

test('the view block: what a surface needs of the image, all zero where no volume was built', () => {
  const cam = camera([1, 2, 3])
  const img = image(cam, { startAt: 2 }, { volumetricFogReadFilter: 'tricubic' })
  const frame = writeFogVolumeFrame(newFogVolumeFrame(), img)
  const block = writeFogViewBlock(new Float32Array(FOG_VIEW_FLOATS), frame, img.settings, LOOK)
  const slot = (s: number) => Array.from(block.subarray(s * 4, s * 4 + 4))
  near(slot(FOG_VIEW_SLOT.eye), [1, 2, 3, 1], 'eye, built', 0)
  near([slot(FOG_VIEW_SLOT.forward)[3]], [VOLUMETRIC_FOG_FILTERS.indexOf('tricubic')], 'filter', 0)
  near(slot(FOG_VIEW_SLOT.projection), Array.from(cam.viewProj.subarray(0, 4)), 'matrix', 1e-6)
  near(slot(FOG_VIEW_SLOT.grid), [20, 12, 8, 8], 'grid', 0)
  const none = writeFogViewBlock(block, undefined, img.settings, LOOK)
  assert.ok(none.every((v) => v === 0))
})

test('the programs: every name declared, braces paired, none twice, no reserved word', () => {
  for (const [name, code] of Object.entries(FOG_PROGRAMS)) {
    assertProgramAssembles(code, undefined, name)
  }
})

test('the frame carries the fog-wide settings: the edge fade, the sky light’s share, the local shadows, the glow in the matched unit', () => {
  const at = FOG_VOLUME_FRAME_AT
  const words = (
    settings: Parameters<typeof image>[2],
    volumetric: Parameters<typeof image>[1] = true,
  ) => writeFogVolumeFrame(newFogVolumeFrame(), image(camera([1, 2, 3]), volumetric, settings))
  const base = words({})
  assert.equal(base[at.blend + 2], 0, 'no fade by default')
  assert.equal(words({ volumetricFogEdgeFade: 1.5 })[at.blend + 2], 1.5)
  // The glow is read in the unit of the fog's own colour where the fog matches the volume.
  const glow = (settings: Parameters<typeof image>[2]) =>
    words(settings, { glow: [1, 2, 3] })[at.glow]
  near([glow({ fogMatchesVolume: true }) / glow({})], [FOG_MATCH_GLOW_SCALE], 'unit', 1e-3)
})

test('the frame carries the translucency volume the cells read: its cells and the slices’ law, zero where the image made none', () => {
  const at = FOG_VOLUME_FRAME_AT
  const words = (more: Parameters<typeof image>[3]) =>
    writeFogVolumeFrame(newFogVolumeFrame(), image(camera([1, 2, 3]), true, {}, more))
  const made = words({ translucencyGi: { grid: [44, 25, 24, 1], z: [1, 1, 4, 0] } })
  assert.deepEqual(Array.from(made.subarray(at.giGrid, at.giGrid + 4)), [44, 25, 24, 1])
  assert.deepEqual(Array.from(made.subarray(at.giZ, at.giZ + 4)), [1, 1, 4, 0])
  const none = words({})
  assert.deepEqual(Array.from(none.subarray(at.giGrid, at.giGrid + 8)), Array(8).fill(0))
})

test('the view block’s switches: each lane zero at the defaults, set by the settings, the observer by an orthographic view’s height', () => {
  const slot = (block: Float32Array, s: number) => Array.from(block.subarray(s * 4, s * 4 + 4))
  const block = (settings: Parameters<typeof image>[2], look = LOOK) =>
    writeFogViewBlock(
      new Float32Array(FOG_VIEW_FLOATS),
      undefined,
      image(camera([1, 2, 3]), true, settings).settings,
      look,
    )
  const lanes = (b: Float32Array) =>
    [FOG_VIEW_SLOT.options, FOG_VIEW_SLOT.observer, FOG_VIEW_SLOT.match, FOG_VIEW_SLOT.albedo].map(
      (s) => slot(b, s),
    )
  const zero = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  assert.deepEqual(lanes(block({})), zero, 'the defaults write nothing')
  assert.deepEqual(slot(block({ fogEnabled: false }), FOG_VIEW_SLOT.options), [1, 0, 0, 0])
  assert.deepEqual(slot(block({ fogReadsAtmosphere: false }), FOG_VIEW_SLOT.options), [0, 1, 0, 0])
  // Matched to the volume: its glow in the fog's unit, its anisotropy and its particles' colour.
  const medium: Pick<ResolvedVolumetricFog, 'glow' | 'anisotropy' | 'particleColor'> = {
    glow: [3 / 100, 2 / 100, 1 / 100],
    anisotropy: 0.4,
    particleColor: [0.5, 0.6, 0.7],
  }
  const matched = block(
    { fogMatchesVolume: true },
    { ...LOOK, fog: { volumetric: medium } as ResolvedHeightFog },
  )
  near(slot(matched, FOG_VIEW_SLOT.options), [0, 0, 1, 0], 'matches', 0)
  near(slot(matched, FOG_VIEW_SLOT.match), [3, 2, 1, 0.4], 'match', 1e-6)
  near(slot(matched, FOG_VIEW_SLOT.albedo), [0.5, 0.6, 0.7, 0], 'albedo', 1e-6)
  // No volume to match: the volume's own defaults.
  assert.ok(
    slot(block({ fogMatchesVolume: true }), FOG_VIEW_SLOT.match)[3] > 0,
    'its default anisotropy',
  )
  // An orthographic view measures the fog from its height: the observer may rise by it, less the 655 m
  // a perspective view's does; a view below the ground gets none.
  const ortho = { ...LOOK, perspective: false, eyeHeight: 2000 }
  assert.deepEqual(slot(block({}, ortho), FOG_VIEW_SLOT.options), [0, 0, 0, 1])
  near(slot(block({}, ortho), FOG_VIEW_SLOT.observer), [2000 - 655.36, 0, 0, 0], 'observer', 1e-3)
  near(
    slot(block({}, { ...ortho, eyeHeight: -5 }), FOG_VIEW_SLOT.observer),
    [-655.36, 0, 0, 0],
    'below',
    1e-3,
  )
  assert.deepEqual(
    lanes(block({ fogOrthoHeightAdjustment: false }, ortho)),
    zero,
    'the setting off',
  )
  assert.deepEqual(lanes(block({}, { ...LOOK, eyeHeight: 2000 })), zero, 'a perspective view')
})
