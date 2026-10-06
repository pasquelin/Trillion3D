import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHADE_SHADER } from '../../visibility/buffer.ts'
import { WATER_SURFACE_WGSL } from '../water/surfaceWgsl.ts'
import { unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { feedbackFreeEntry } from './feedbackAbWgsl.ts'
import { BLEND_SHADER } from '../../gpu/core/shaderTexts.fixture.ts'

const SURFACE = [
  ['baseMetal', 'vec4f'],
  ['normalRough', 'vec4f'],
  ['emissiveAo', 'vec4f'],
] as const
const FRAGMENT_IN = ['in:VSOut,@builtin(front_facing) front:bool', 'in,front'] as const

// A device refuses a module naming what it does not declare: each target-free entry calls the
// renamed source entry and returns its own output structure, so every name it adds resolves.
test('target-free opaque, transparent and water entries declare every name they use', () => {
  const shade = feedbackFreeEntry(
    SHADE_SHADER,
    'shade_fs',
    'SurfaceOut',
    [...SURFACE, ['flags', 'u32']],
    '@builtin(position) pos:vec4f',
    'pos',
  )
  assert.deepEqual(unresolvedNames(shade), [])
  let blend = BLEND_SHADER + WATER_SURFACE_WGSL
  for (const entry of ['fs', 'fsFiltered'])
    blend = feedbackFreeEntry(blend, entry, 'BlendOut', [['color', 'vec4f']], ...FRAGMENT_IN)
  blend = feedbackFreeEntry(
    blend,
    'fsWater',
    'WaterOut',
    [...SURFACE, ['word', 'vec4f']],
    ...FRAGMENT_IN,
  )
  assert.deepEqual(unresolvedNames(blend), [])
})

test('an entry the shader does not hold is refused by name', () => {
  assert.throws(
    () => feedbackFreeEntry(BLEND_SHADER, 'fsMissing', 'BlendOut', [], ...FRAGMENT_IN),
    { message: 'FEEDBACK_ENTRY_MISSING:fsMissing' },
  )
})
