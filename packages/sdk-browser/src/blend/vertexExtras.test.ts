// The vertex stage's extras: named lanes allocated in order into `vec4f` members, an ask never split
// between two members, written by the vertex stage and read by a fragment by name; and the three
// words of an item that share one flat member.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { allocateExtras, extraRead, extraWrite } from './vertexExtras.ts'
import { WORDS } from './vertexReadsWgsl.ts'
import { blendVertexWgsl } from './vertexWgsl.ts'

test('asks fill the members in order, none split between two', () => {
  const { places, members } = allocateExtras([
    { name: 'layer', lanes: 4 },
    { name: 'shade', lanes: 1 },
    { name: 'mix', lanes: 2 },
    { name: 'tint', lanes: 3 },
  ])
  assert.deepEqual(members, ['extras0', 'extras1', 'extras2'])
  assert.deepEqual(places.layer, { member: 'extras0', lane: 0, lanes: 4 })
  assert.deepEqual(places.shade, { member: 'extras1', lane: 0, lanes: 1 })
  assert.deepEqual(
    places.mix,
    { member: 'extras1', lane: 1, lanes: 2 },
    'after the shade, in its member',
  )
  assert.deepEqual(
    places.tint,
    { member: 'extras2', lane: 0, lanes: 3 },
    'three do not fit after three',
  )
  assert.deepEqual(allocateExtras([]), { places: {}, members: [] })
  assert.throws(
    () =>
      allocateExtras([
        { name: 'a', lanes: 1 },
        { name: 'a', lanes: 1 },
      ]),
    /asked for twice/,
  )
})

test('an ask is written by the vertex stage lane by lane, or whole, and read by the fragment by its name', () => {
  const { places } = allocateExtras([
    { name: 'layer', lanes: 4 },
    { name: 'shade', lanes: 1 },
    { name: 'mix', lanes: 2 },
  ])
  assert.equal(extraWrite(places.layer, 'l'), 'out.extras0=l;')
  assert.equal(extraWrite(places.shade, 's'), 'out.extras1.x=s;')
  assert.equal(extraWrite(places.mix, 'm'), 'out.extras1.y=m.x;out.extras1.z=m.y;')
  assert.equal(extraRead(places.layer), 'in.extras0')
  assert.equal(extraRead(places.shade, 'v'), 'v.extras1.x')
  assert.equal(extraRead(places.mix), 'in.extras1.yz')
})

test('the triangle’s rank, the diagnostic word and the surface record’s rank share one flat member of the stage’s output', () => {
  for (const lobes of [true, false]) {
    const code = wgslModule(blendVertexWgsl(lobes))
    assert.match(code, /@location\(7\) @interpolate\(flat\) words:vec3u/)
    const struct = /struct VSOut\{([^}]*)\}/.exec(code)![1]
    for (const old of ['tri:', 'diagId:', 'material:']) assert.ok(!struct.includes(old), old)
    for (const old of [/\bout\.tri\b/, /\bout\.diagId\b/, /\bout\.material\b/])
      assert.doesNotMatch(code, old)
    for (const lane of Object.values(WORDS)) assert.ok(code.includes(`out.${lane}`), lane)
  }
})
