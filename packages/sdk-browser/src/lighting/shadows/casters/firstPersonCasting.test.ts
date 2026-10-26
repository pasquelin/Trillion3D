// The two first-person switches of an object as the shadows read them: a first-person object casts
// none of its own; the object that stands for it in the world casts into the suns' first-person
// clipmaps alone, its placement's word telling the raster so.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HIDDEN_SHADOW_ROOT,
  nodeCasting,
  SHADOWLESS_ROOT,
  WORLD_SPACE_ROOT,
} from '../../../visibility/shader/castingMark.ts'
import { castFlagsOf } from './castFlags.ts'
import { castsWhileHidden } from '../../../placement/hidden.ts'
import {
  MOBILITY_HIDDEN_SHADOW,
  MOBILITY_SHADOWLESS,
  MOBILITY_WORLD_SPACE,
} from '../mobilityBits.ts'

test('a first-person object casts no shadow, the object that stands for it is marked for the first-person clipmap', () => {
  assert.equal(nodeCasting({ castShadow: true }), 0)
  assert.equal(nodeCasting({ castShadow: true, firstPerson: true }), SHADOWLESS_ROOT)
  assert.equal(
    nodeCasting({ castShadow: true, firstPersonWorldSpaceRepresentation: true }),
    WORLD_SPACE_ROOT,
  )
  // Casting nothing at all, it needs no clipmap.
  assert.equal(
    nodeCasting({ castShadow: false, firstPersonWorldSpaceRepresentation: true }),
    SHADOWLESS_ROOT | WORLD_SPACE_ROOT,
  )
})

test('the placement’s word carries the mark to the raster', () => {
  assert.equal(castFlagsOf({ mark: WORLD_SPACE_ROOT }) & MOBILITY_WORLD_SPACE, MOBILITY_WORLD_SPACE)
  assert.equal(castFlagsOf({ mark: 0 }) & MOBILITY_WORLD_SPACE, 0)
  const both = castFlagsOf({ mark: WORLD_SPACE_ROOT | SHADOWLESS_ROOT })
  assert.equal(both & MOBILITY_SHADOWLESS, MOBILITY_SHADOWLESS)
})

test('an object that casts while hidden is marked, unless it casts nothing or stands for a first-person one', () => {
  assert.equal(nodeCasting({ castShadow: true, castHiddenShadow: true }), HIDDEN_SHADOW_ROOT)
  assert.equal(
    nodeCasting({
      castShadow: true,
      castHiddenShadow: true,
      firstPersonWorldSpaceRepresentation: true,
    }),
    WORLD_SPACE_ROOT,
    'the reference reads the hidden shadow of an object that is no world-space representation alone',
  )
  assert.equal(castsWhileHidden({ mark: HIDDEN_SHADOW_ROOT }), true)
  assert.equal(castsWhileHidden({ mark: HIDDEN_SHADOW_ROOT | SHADOWLESS_ROOT }), false)
  assert.equal(castsWhileHidden({ mark: 0 }), false)
  assert.equal(
    castFlagsOf({ mark: HIDDEN_SHADOW_ROOT }) & MOBILITY_HIDDEN_SHADOW,
    MOBILITY_HIDDEN_SHADOW,
  )
})
