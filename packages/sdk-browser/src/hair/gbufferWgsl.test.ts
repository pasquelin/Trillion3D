// The pass after the material, read from the shipped text: the strands' union of lighting channels reaches the surfaces they empty.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unresolvedNames } from '../gpu/core/wgslNames.fixture.ts'
import { hairGbufferWgsl } from './gbufferWgsl.ts'

test('the walk takes the union of the lighting channels of a pixel samples', () => {
  const code = hairGbufferWgsl(true)
  assert.match(code, /out\.channels=out\.channels\|\(\(nodeData\[at\+4u\]>>24u\)&7u\);/)
})

test('an emptied surface is in the lighting channels of its strands, and the depth-only walk empties none', () => {
  assert.match(hairGbufferWgsl(true), /\|flagsOfChannels\(found\.channels\),0u,0u,0u\)\);/)
  assert.doesNotMatch(hairGbufferWgsl(false), /flagsOfChannels\(found/)
})

test('both walks name everything they use', () => {
  assert.deepEqual(unresolvedNames(hairGbufferWgsl(true)), [])
  assert.deepEqual(unresolvedNames(hairGbufferWgsl(false)), [])
})
