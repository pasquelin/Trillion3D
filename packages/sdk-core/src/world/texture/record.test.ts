import test from 'node:test'
import assert from 'node:assert/strict'
import { Texture } from './texture.ts'
import { closeTextureJournal, openTextureJournal } from '../../texture/writes.ts'

/** The general composition, about a pivot (`cx`, `cy`), as nine numbers column by column: the
 *  oracle a texture's own transform is held to, at a pivot of zero. */
function aboutPivot(tx: number, ty: number, sx: number, sy: number, turn: number) {
  const [cx, cy, c, s] = [0, 0, Math.cos(turn), Math.sin(turn)]
  // prettier-ignore
  return [
    sx * c, -sy * s, 0,
    sx * s, sy * c, 0,
    -sx * (c * cx + s * cy) + cx + tx, -sy * (-s * cx + c * cy) + cy + ty, 1,
  ]
}

test('a placement write composes the transform to the bit of the pivoted composition', () => {
  const texture = new Texture(null)
  assert.deepEqual([...texture.transform], aboutPivot(0, 0, 1, 1, 0), 'composed at creation')
  assert.ok(Object.is(texture.transform[1], -0), 'the identity carries the pivoted -0')
  let seed = 7
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 20
  const bits = (values: ArrayLike<number>) => [...new Float32Array(Float64Array.from(values))]
  for (let i = 0; i < 10_000; i++) {
    const [tx, ty, sx, sy, turn] = [next(), next(), next(), next(), next()]
    const placement = texture.placement
    texture.offset.set(tx, ty)
    texture.repeat.set(sx, sy)
    texture.rotation = turn
    assert.equal(texture.placement, placement + 3)
    const want = aboutPivot(tx, ty, sx, sy, turn)
    assert.ok(
      want.every((value, k) => Object.is(value, texture.transform[k])),
      `case ${i}`,
    )
    assert.deepEqual(bits(texture.transform), bits(want))
  }
})

test('a write lands the record its holders hold in every open journal, once', () => {
  const texture = new Texture(null)
  const journal = openTextureJournal()
  texture.repeat.set(2, 2)
  texture.wrap = 'repeat'
  texture.needsUpdate = true
  assert.deepEqual([...journal], [texture], 'the proxy, not its target')
  journal.clear()
  closeTextureJournal(journal)
  texture.rotation = 1
  assert.equal(journal.size, 0, 'a closed journal hears nothing')
})

test('one write among ten thousand textures journals one record', () => {
  const textures = Array.from({ length: 10_000 }, () => new Texture(null))
  const journal = openTextureJournal()
  textures[4321].offset.x = 0.5
  assert.deepEqual([...journal], [textures[4321]])
  closeTextureJournal(journal)
})
