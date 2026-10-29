// The manager of the atlas: slots counted by the lights that name them, and the updates that turn what changed into what the device does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { INVALID_SLOT } from './layout.ts'
import { createRectLightAtlasManager, type AtlasConfig } from './manager.ts'

const CONFIG: AtlasConfig = {
  maxResolution: 4096,
  maxRatio: 2,
  forceUpdate: false,
  resetOnChange: false,
  clear: false,
  debugClear: false,
  filterQuality: 0,
  format: 0,
}
const WHOLE = [1, 1, 0, 0] as const
const picture = (width: number, height = width) => ({ width, height })

test('a picture named twice is one slot, counted, and given back by the last light', () => {
  const atlas = createRectLightAtlasManager()
  const image = picture(128)
  const a = atlas.addTexture(image, WHOLE, 2)
  const b = atlas.addTexture(image, WHOLE, 2)
  assert.equal(a, b)
  assert.equal(atlas.slots[a].refs, 2)
  atlas.removeTexture(a)
  assert.equal(atlas.slots[a].refs, 1)
  atlas.removeTexture(a)
  assert.equal(atlas.slots.length, 0, 'the last slot goes with its last light')
})

test('another share of the same picture is another slot', () => {
  const atlas = createRectLightAtlasManager()
  const image = picture(128)
  const whole = atlas.addTexture(image, WHOLE, 2)
  const half = atlas.addTexture(image, [0.5, 1, 0, 0], 2)
  assert.notEqual(whole, half)
  assert.equal(atlas.slots[half].rect.size.x, 64)
})

test('a slot freed in the middle is reused, in the order they were freed', () => {
  const atlas = createRectLightAtlasManager()
  const slots = [64, 96, 128, 160].map((side) => atlas.addTexture(picture(side), WHOLE, 2))
  atlas.removeTexture(slots[1])
  atlas.removeTexture(slots[0])
  assert.equal(atlas.slots[slots[1]].source, undefined, 'a free slot holds no picture')
  assert.equal(atlas.addTexture(picture(32), WHOLE, 2), slots[1])
  assert.equal(atlas.addTexture(picture(40), WHOLE, 2), slots[0])
  assert.equal(atlas.addTexture(undefined, WHOLE, 2), INVALID_SLOT)
})

test('the first update makes the atlas and draws the pictures; a second with nothing to do does nothing', () => {
  const atlas = createRectLightAtlasManager()
  const id = atlas.addTexture(picture(128), WHOLE, 2)
  assert.equal(atlas.placeOf(id).placed, false, 'no place until the update')
  const first = atlas.update(CONFIG)!
  assert.deepEqual(first.made, { x: 256, y: 256 }, 'the atlas starts at 256')
  assert.equal(first.copies, false)
  assert.equal(first.drawn.length, 1)
  assert.deepEqual(atlas.placeOf(id), { placed: true, x: 0, y: 0, width: 128, height: 128 })
  assert.equal(atlas.update(CONFIG), undefined)
})

test('a picture added later is drawn into the atlas as it is, with no copy', () => {
  const atlas = createRectLightAtlasManager()
  atlas.addTexture(picture(128), WHOLE, 2)
  atlas.update(CONFIG)
  const id = atlas.addTexture(picture(64), WHOLE, 2)
  const update = atlas.update(CONFIG)!
  assert.equal(update.made, undefined)
  assert.equal(update.copySlots.length, 0)
  assert.deepEqual(
    update.drawn.map((s) => s.id),
    [id],
  )
})

test('when the atlas has no room it is made again larger and the slots in place are copied', () => {
  const atlas = createRectLightAtlasManager()
  const first = atlas.addTexture(picture(256), WHOLE, 2)
  atlas.update(CONFIG)
  const second = atlas.addTexture(picture(256), WHOLE, 2)
  const update = atlas.update(CONFIG)!
  assert.deepEqual(update.made, { x: 512, y: 512 })
  assert.equal(update.copies, true)
  assert.deepEqual(
    update.copySlots.map((c) => c.id),
    [first],
  )
  assert.deepEqual(
    update.drawn.map((s) => s.id),
    [second],
  )
  assert.ok(atlas.placeOf(first).placed && atlas.placeOf(second).placed)
})

test('a picture given back leaves a hole the next one takes without growing the atlas', () => {
  const atlas = createRectLightAtlasManager()
  const a = atlas.addTexture(picture(128), WHOLE, 2)
  atlas.addTexture(picture(128), WHOLE, 2)
  atlas.update(CONFIG)
  const where = atlas.placeOf(a)
  atlas.removeTexture(a)
  const again = atlas.addTexture(picture(100), WHOLE, 2)
  const update = atlas.update(CONFIG)!
  assert.equal(update.made, undefined)
  assert.deepEqual([atlas.placeOf(again).x, atlas.placeOf(again).y], [where.x, where.y])
})

test('a refreshed picture is drawn again in place', () => {
  const atlas = createRectLightAtlasManager()
  const image = picture(128)
  const id = atlas.addTexture(image, WHOLE, 2)
  atlas.update(CONFIG)
  const where = atlas.placeOf(id)
  assert.equal(atlas.refresh(image), true)
  const update = atlas.update(CONFIG)!
  assert.deepEqual(
    update.drawn.map((s) => s.id),
    [id],
  )
  assert.deepEqual(atlas.placeOf(id), where)
  assert.equal(atlas.update(CONFIG), undefined)
  assert.equal(atlas.refresh(picture(8)), false)
})

test('the settings that made the atlas, changed, make it again from nothing', () => {
  const atlas = createRectLightAtlasManager()
  const id = atlas.addTexture(picture(128), WHOLE, 2)
  atlas.update(CONFIG)
  const update = atlas.update({ ...CONFIG, maxResolution: 2048 })!
  assert.deepEqual(update.made, { x: 2048, y: 2048 }, 'a reset starts from the greatest side')
  assert.equal(update.copySlots.length, 0)
  assert.equal(update.drawn.length, 1)
  assert.ok(atlas.placeOf(id).placed)
  assert.equal(atlas.update({ ...CONFIG, maxResolution: 2048 }), undefined)
})

test('a force update makes it again at every image, and a reset on change when a picture joins', () => {
  const atlas = createRectLightAtlasManager()
  atlas.addTexture(picture(64), WHOLE, 2)
  atlas.update(CONFIG)
  assert.ok(atlas.update({ ...CONFIG, forceUpdate: true }))
  assert.ok(atlas.update({ ...CONFIG, forceUpdate: true }))
  const reset = { ...CONFIG, resetOnChange: true, clear: true }
  atlas.addTexture(picture(64), WHOLE, 2)
  const update = atlas.update(reset)!
  assert.equal(update.drawn.length, 2, 'both pictures are laid again')
})

test('a picture that streams in larger than its slot gets a new one', () => {
  const atlas = createRectLightAtlasManager()
  const image = { width: 64, height: 64 }
  const id = atlas.addTexture(image, WHOLE, 2)
  atlas.update(CONFIG)
  image.width = image.height = 128
  const update = atlas.update(CONFIG)!
  assert.deepEqual(
    update.drawn.map((s) => s.id),
    [id],
  )
  assert.equal(atlas.placeOf(id).width, 128)
  assert.equal(
    atlas.update(CONFIG),
    undefined,
    'and is sized for what it is now: no new slot each image',
  )
})

test('a clear with the reset on change clears the atlas rather than making it again', () => {
  const atlas = createRectLightAtlasManager()
  atlas.addTexture(picture(64), WHOLE, 2)
  atlas.update(CONFIG)
  const joined = { ...CONFIG, clear: true, resetOnChange: false }
  atlas.addTexture(picture(32), WHOLE, 2)
  const update = atlas.update(joined)!
  assert.equal(update.clear, false, 'the atlas is cleared only with the reset on change')
})
