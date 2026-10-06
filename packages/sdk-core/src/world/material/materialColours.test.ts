import test from 'node:test'
import assert from 'node:assert/strict'
import { Material } from './material.ts'
import { Color } from '../math/color.ts'

test('materials hear shared Color instances and stop hearing replaced colors', () => {
  const color = new Color([0.1, 0.2, 0.3])
  const material = new Material('meshStandard', { color })
  let writes = 0
  material._listeners.add(() => writes++)
  color.setRGB(0.4, 0.5, 0.6)
  assert.equal(writes, 1)
  assert.deepEqual(material.surface().baseColor, [0.4, 0.5, 0.6])
  const replacement = new Color([0.7, 0.8, 0.9])
  material.color = replacement
  const before = writes
  color.setScalar(0)
  assert.equal(writes, before)
  replacement.setScalar(1)
  assert.equal(writes, before + 1)
  material.emissive = new Color([1, 0, 0])
  const emissiveBefore = writes
  material.emissive.setRGB(0, 1, 0)
  assert.equal(writes, emissiveBefore + 1)
  material.color = replacement
  const repeated = writes
  replacement.setRGB(0, 0, 1)
  assert.equal(writes, repeated + 1)
})

test('every default color drives revision and wearer notifications when edited in place', () => {
  const material = new Material('meshStandard')
  let changes = 0
  material._listeners.add(() => changes++)
  const before = material.version
  material.color.setRGB(0.2, 0.3, 0.4)
  material.emissive.setRGB(0.4, 0.5, 0.6)
  material.subsurfaceColor.setRGB(0.6, 0.7, 0.8)
  assert.equal(material.version, before + 3)
  assert.equal(changes, 3)
  material.version = 123
  assert.equal(material.version, 123)
  assert.equal(changes, 3, 'the revision itself is bookkeeping')
})

test('reassigning a shared color preserves its existing notification order', () => {
  const color = new Color(0xffffff)
  const first = new Material('meshBasic', { color })
  const second = new Material('meshBasic', { color })
  const notifications: string[] = []
  first._listeners.add(() => notifications.push('first'))
  second._listeners.add(() => notifications.push('second'))
  first.color = color
  notifications.length = 0
  color.setRGB(0.2, 0.3, 0.4)
  assert.deepEqual(notifications, ['first', 'second'])
})

test('a numeric constructor color remains observed through later channel edits', () => {
  const material = new Material('meshStandard', { color: 0x112233 })
  let changes = 0
  material._listeners.add(() => changes++)
  material.color.setRGB(0.1, 0.2, 0.3)
  assert.equal(changes, 1)
  assert.deepEqual(material.surface().baseColor, [0.1, 0.2, 0.3])
})

test('a color shared by two slots stays observed until both slots release it', () => {
  const color = new Color(0x123456),
    material = new Material('meshStandard', { color, emissive: color })
  let writes = 0
  material._listeners.add(() => writes++)
  material.color = new Color(0xffffff)
  writes = 0
  color.set(0x112233)
  assert.equal(writes, 1)
  assert.deepEqual(material.emissive.toArray(), color.toArray())
  material.emissive = new Color(0x111111)
  writes = 0
  color.set(0xaabbcc)
  assert.equal(writes, 0)
})

test('a newly created optional color continues to notify its material after construction', () => {
  const material = new Material('meshPhong', { specular: 0x112233 })
  let writes = 0
  material._listeners.add(() => writes++)
  ;(material.specular as Color).set(0x334455)
  assert.equal(writes, 1)
  material.sheenColor = 0xffaa00
  writes = 0
  ;(material.sheenColor as Color).set(0xff0000)
  assert.equal(writes, 1)
})

test('every colour field holds a Color, written in place and heard, whatever value it is given', () => {
  const material = new Material('meshPhysical')
  let writes = 0
  material._listeners.add(() => writes++)
  const held = material.subsurfaceColor
  Object.assign(material, { subsurfaceColor: 0xff0000 })
  assert.equal(material.subsurfaceColor, held, 'the same Color, set in place')
  const base = material.color
  Object.assign(material, { color: [0.5, 0.5, 0.5] })
  assert.equal(material.color, base)
  material.attenuationColor = 0x00ff00
  assert.ok(material.attenuationColor instanceof Color)
  writes = 0
  ;(material.attenuationColor as Color).setRGB(0, 0, 1)
  assert.equal(writes, 1)
})
