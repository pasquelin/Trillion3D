// `effect.outline`: a pass drawn over the display image whose objects, colour and thickness are
// watched — each write, the colour's own included, counts one revision of the chain that holds it
// and asks for a frame —, idle while it outlines no object.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from './chain.ts'
import { effect } from './index.ts'
import { Object3D } from '../object/object3d.ts'

test('an outline takes its defaults, runs after tone mapping, and is idle with no object', () => {
  const outline = effect.outline()
  assert.equal(outline.stage, 'after-tone-mapping')
  assert.deepEqual([outline.objects, outline.thickness, outline.color.getHex()], [[], 2, 0xff9f1c])
  assert.equal(outline.idle, true)
  const chain = new EffectChain().add(outline).add(effect.bloom())
  assert.deepEqual(chain.stage('after-tone-mapping'), [outline])
  assert.equal(chain.stage('before-tone-mapping').length, 1)
})

test('objects, colour and thickness are watched: each write reaches the chain', () => {
  let asked = 0
  const chain = new EffectChain(() => void asked++)
  const [a, b] = [new Object3D(), new Object3D()]
  const outline = effect.outline({ objects: [a], color: '#ffe36e', thickness: 3 })
  chain.add(outline)
  assert.equal(outline.idle, false)
  const list = [b]
  outline.objects = list
  list.push(a) // the page's array: the outline keeps its own copy
  assert.deepEqual(outline.objects, [b])
  outline.color.set('#00ff00')
  outline.thickness = 5
  assert.deepEqual([chain.revision, asked], [4, 4])
  outline.objects = []
  assert.equal(outline.idle, true)
  chain.remove(outline)
  outline.color.set('#ffffff') // out of the chain: nothing to redraw
  assert.equal(chain.revision, 6)
})

test('a thickness outside (0, 32] and objects that are no list are refused', () => {
  assert.throws(() => effect.outline({ thickness: 0 }), /OUTLINE_THICKNESS:0/)
  assert.throws(() => effect.outline({ thickness: 33 }), /OUTLINE_THICKNESS:33/)
  assert.throws(() => (effect.outline().thickness = Number.NaN), /OUTLINE_THICKNESS/)
  assert.throws(() => effect.outline({ objects: new Object3D() as never }), /OUTLINE_OBJECTS/)
  assert.equal(effect.outline({ thickness: 32 }).thickness, 32)
})
