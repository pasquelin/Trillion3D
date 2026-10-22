// The fog volume (`./fog/`): its grid and its frame, the view block a surface reads it from, and the
// text of its programs read by name. Its programs run as shipped (`shaderRun`) in `fogScatter.test.ts`,
// `fogIntegrate.test.ts` and `fogRead.test.ts`; its work on the kit's device is `fogVolumeGpu.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { halton } from '../../../math/src/sequence/halton.ts'
import { VOLUMETRIC_FOG_FILTERS } from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { FOG_VOLUME_FRAME_AT, writeSampleOffsets } from './fog/layout.ts'
import { sliceParams, volumeUvMax, cellGrid, FIRST_SLICE_MARGIN } from './fog/layout.ts'
import {
  FOG_VOLUME_FLAG,
  newFogVolumeFrame,
  writeFogViewBlock,
  writeFogVolumeFrame,
} from './fog/frame.ts'
import { FOG_VIEW_FLOATS, FOG_VIEW_SLOT } from './fog/viewSlots.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'
import { camera, depthAtSlice, image, sliceAtDepth } from './fogVolumeRun.fixture.ts'
import {
  reservedNames,
  topLevelNames,
  unbalanced,
  unresolvedNames,
} from '../gpu/core/wgslNames.fixture.ts'

test('the grid: a cell a side of pixels across the view, the depth spread by its logarithm', () => {
  assert.deepEqual(cellGrid(1920, 1080, 8, 128), { x: 240, y: 135, z: 128, pixelSize: 8 })
  assert.deepEqual(cellGrid(1921, 1081, 16, 64), { x: 121, y: 68, z: 64, pixelSize: 16 })
  // Past what a texture holds the cell is made larger, the least that fits.
  assert.deepEqual(cellGrid(8000, 2000, 2, 4, 2048), { x: 2000, y: 500, z: 4, pixelSize: 4 })
  // The first slice starts a little past the near plane, the last ends at the far end.
  const p = sliceParams(0.1, 60, 32, 128)
  near([depthAtSlice(0, p), depthAtSlice(128, p)], [0.1 + FIRST_SLICE_MARGIN, 60], 'ends', 1e-9)
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
  assert.equal(
    flags,
    FOG_VOLUME_FLAG.glow | FOG_VOLUME_FLAG.skipHidden | FOG_VOLUME_FLAG.usesHistory,
  )
  assert.equal(field(at.medium)[2], 0.25)
  // The hidden cells are skipped only where the image says its pyramid is there.
  const bare = writeFogVolumeFrame(newFogVolumeFrame(), { ...img, skipHidden: false })
  assert.equal(bare[at.medium + 3], FOG_VOLUME_FLAG.glow | FOG_VOLUME_FLAG.usesHistory)
  // No history, no blend; a previous image with the same grid, the setting's weight; reprojection off, none.
  assert.equal(field(at.blend)[0], 0)
  const previous = { viewProj: cam.viewProj, width: 160, height: 90 }
  const after = writeFogVolumeFrame(newFogVolumeFrame(), { ...img, previous })
  assert.equal(after[at.blend], Math.fround(0.9))
  // The cells lie at multiples of their side in pixels: the history is read at the view over the
  // cells' span, the last row of cells reaching past the edge of the view.
  near(Array.from(after.subarray(at.previous, at.previous + 2)), [1, 90 / 96], 'span', 1e-6)
  const off = image(cam, true, { volumetricFogUsesHistory: false }, { previous })
  assert.equal(writeFogVolumeFrame(newFogVolumeFrame(), off)[at.blend], 0)
})

test('the view block: what a surface needs of the image, all zero where no volume was built', () => {
  const cam = camera([1, 2, 3])
  const img = image(cam, { startAt: 2 }, { volumetricFogReadFilter: 'tricubic' })
  const frame = writeFogVolumeFrame(newFogVolumeFrame(), img)
  const block = writeFogViewBlock(new Float32Array(FOG_VIEW_FLOATS), frame, img.settings)
  const slot = (s: number) => Array.from(block.subarray(s * 4, s * 4 + 4))
  near(slot(FOG_VIEW_SLOT.eye), [1, 2, 3, 1], 'eye, built', 0)
  near([slot(FOG_VIEW_SLOT.forward)[3]], [VOLUMETRIC_FOG_FILTERS.indexOf('tricubic')], 'filter', 0)
  near(slot(FOG_VIEW_SLOT.projection), Array.from(cam.viewProj.subarray(0, 4)), 'matrix', 1e-6)
  near(slot(FOG_VIEW_SLOT.grid), [20, 12, 8, 8], 'grid', 0)
  const none = writeFogViewBlock(block, undefined, img.settings)
  assert.ok(none.every((v) => v === 0))
})

test('the programs: every name declared, braces paired, none twice, no reserved word', () => {
  for (const [name, code] of Object.entries(FOG_PROGRAMS)) {
    assert.deepEqual(unresolvedNames(code), [], `${name} names a name it does not declare`)
    assert.deepEqual(reservedNames(code), [], `${name} spells a reserved word`)
    assert.equal(unbalanced(code), '', `${name} braces`)
    const seen = new Set<string>()
    const twice = topLevelNames(code).filter((n) => seen.size === seen.add(n).size)
    assert.deepEqual(twice, [], `${name} declares a name twice`)
  }
})
