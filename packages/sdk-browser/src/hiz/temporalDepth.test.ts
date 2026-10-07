// The cut's three rasters write one depth buffer its history owns, so the buffer must carry
// the whole image every time — widened when the viewport grows, and never carrying a pixel of the
// image before it. The failure this pins is the quiet one: `hizBuildFlat` refuses a depth shorter
// than the image (`HIZ_DEPTH_SIZE`) and `webgpu/pages/render/cpu.ts:86-92` swallows that error, so a
// buffer left too small would draw the whole cut every frame and say nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTemporalHiz, type TemporalHizState } from './hiz.ts'
import { cameraAt } from '../../../../tests/fixtures/hiz.ts'
import { createEngineCamera, readCameraWorld } from '../camera/world.ts'
import { quadScene, narrowViewport, wideViewport } from './temporalScene.fixture.ts'

const cam = readCameraWorld(createEngineCamera(), cameraAt(6))
const PETIT = narrowViewport()
const LARGE = wideViewport()

/** The quad scene the other temporal tests build, four behind the near one rather than two. */
function scene() {
  return quadScene([
    [-1.7, -1.7, 1, 1.7, 1.7, 1],
    [-1.2, -1.2, 0, 1.2, 1.2, 0],
    [-0.6, -0.6, -1, 0.6, 0.6, -1],
    [0.4, 1.6, -2, 1.2, 2.4, -2],
    [1.6, -2.4, -2, 2.4, -1.6, -2],
  ])
}

/** The ranks and the rejects of a cut: what two histories have to agree on. Copied at once, the
 *  cut's lists being the ones the next image rewrites. */
function verdict(cut: { shownPacked: number[]; hizRejected: number }) {
  return { packed: [...cut.shownPacked], rejected: cut.hizRejected }
}

/** What the cut decides, image by image, on a history that has seen nothing else. */
function seul(viewport: [number, number], images = 2) {
  const { pages, locations, dispose } = scene(),
    history: TemporalHizState = {},
    verdicts = []
  for (let i = 0; i < images; i++)
    verdicts.push(verdict(applyTemporalHiz(pages, locations, cam, viewport, history)))
  dispose()
  return verdicts
}

test("the depth buffer is the history's, one for the three rasters, grown but never narrowed", () => {
  const { pages, locations, dispose } = scene(),
    un: TemporalHizState = {},
    second: TemporalHizState = {}
  assert.equal(un.depth, undefined, 'nothing before the first image')
  applyTemporalHiz(pages, locations, cam, PETIT, un)
  const etroit = un.depth!
  assert.equal(etroit.length, PETIT[0] * PETIT[1], 'the buffer carries the first image')
  applyTemporalHiz(pages, locations, cam, LARGE, un)
  assert.equal(un.depth!.length, LARGE[0] * LARGE[1], 'and grows for the wider one')
  assert.notEqual(un.depth, etroit, 'by a new array, not a longer view of the old one')
  applyTemporalHiz(pages, locations, cam, PETIT, un)
  assert.equal(un.depth!.length, LARGE[0] * LARGE[1], 'a narrower image keeps the wide buffer')
  applyTemporalHiz(pages, locations, cam, LARGE, second)
  assert.notEqual(second.depth, un.depth, 'and no two histories share one')
  dispose()
})

test('a wide image after a narrow one decides what it would on a history of its own', () => {
  const [premier, second] = seul(LARGE)
  assert.equal(premier.packed.length, 2, 'the first image draws the whole cut: no pyramid yet')
  assert.ok(second.rejected > premier.rejected, 'the second culls the occluded half')

  // The same history, narrow first: the buffer grew for the wide image, and the narrow raster left
  // nothing behind it that the wide pyramid could read. A viewport change drops the pyramid, so the
  // wide image starts its own history, as on a first frame.
  const { pages, locations, dispose } = scene(),
    melange: TemporalHizState = {}
  applyTemporalHiz(pages, locations, cam, PETIT, melange)
  assert.deepEqual(verdict(applyTemporalHiz(pages, locations, cam, LARGE, melange)), premier)
  assert.deepEqual(
    verdict(applyTemporalHiz(pages, locations, cam, LARGE, melange)),
    second,
    'and the image after it stands on its own depth',
  )
  dispose()
})

test('a narrow image after a wide one culls what it would alone: the tail is never read', () => {
  const [premier, second] = seul(PETIT)
  const { pages, locations, dispose } = scene(),
    melange: TemporalHizState = {}
  // Two wide images first: the buffer is at its widest, and its tail holds the wide raster's values.
  applyTemporalHiz(pages, locations, cam, LARGE, melange)
  applyTemporalHiz(pages, locations, cam, LARGE, melange)
  assert.equal(melange.depth!.length, LARGE[0] * LARGE[1], 'the buffer stayed wide')
  assert.deepEqual(
    verdict(applyTemporalHiz(pages, locations, cam, PETIT, melange)),
    premier,
    'a pixel of the wide image cannot reach the small pyramid',
  )
  assert.deepEqual(
    verdict(applyTemporalHiz(pages, locations, cam, PETIT, melange)),
    second,
    'and the next small image stands on its own depth',
  )
  dispose()
})

test('the same cut, image after image, holds its verdict: the buffer carries nothing between', () => {
  const { pages, locations, dispose } = scene(),
    history: TemporalHizState = {}
  const premier = verdict(applyTemporalHiz(pages, locations, cam, LARGE, history)),
    second = verdict(applyTemporalHiz(pages, locations, cam, LARGE, history)),
    troisieme = verdict(applyTemporalHiz(pages, locations, cam, LARGE, history))
  assert.deepEqual(troisieme, second, 'a third image decides as the second did')
  assert.ok(second.packed.length < premier.packed.length, 'the pyramid culls something')
  dispose()
})
