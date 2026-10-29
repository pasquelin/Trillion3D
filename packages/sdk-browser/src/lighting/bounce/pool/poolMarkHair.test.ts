// The strands' mark pass (`pool/poolMarkHairWgsl.ts`): its text assembles, binds what the host binds and marks from the list of all the tiles.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { MARK_HAIR_BINDINGS, MARK_HAIR_SHADER } from './poolMarkHairWgsl.ts'

test('the strands mark pass assembles', () => {
  assertProgramAssembles(MARK_HAIR_SHADER)
})

test('every binding the host names is declared once in group 0', () => {
  for (const binding of Object.values(MARK_HAIR_BINDINGS))
    assert.equal(MARK_HAIR_SHADER.split(`@group(0) @binding(${binding})`).length - 1, 1)
})

test('a group is a tile of the list of all the tiles, marking the box of the nearest strand at its eight corners', () => {
  assert.ok(MARK_HAIR_SHADER.includes('rank<hairTileCounts[0]'))
  assert.ok(MARK_HAIR_SHADER.includes('atomicMax(&nearest'))
  assert.ok(MARK_HAIR_SHADER.includes('for(var corner=0u;corner<8u;corner++)'))
  assert.ok(MARK_HAIR_SHADER.includes('if(!(z>0.0)){return;}'))
})
