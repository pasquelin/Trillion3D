import { MIB } from '../../../../math/src/constants.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  FEEDBACK_BYTES,
  SURFACE_BYTES_PER_PIXEL,
  SURFACE_FORMATS,
  checkSurfaceSize,
  frameTargetBytes,
} from './surfaceBuffer.ts'
import { createSurfaceBuffer } from './surfaceAllocation.ts'
import { MODEL_SHIFT, SURFACE_MODEL, modelFlag } from './surfaceModelWord.ts'
import {
  EMISSIVE_AO_SURFACE_FLAG,
  FIRST_PERSON_SURFACE_FLAG,
  HOLDOUT_SURFACE_FLAG,
  NO_CONTACT_SHADOW_SURFACE_FLAG,
} from './surfaceModel.ts'
import {
  PLACEMENT_CHANNELS_SHIFT,
  PLACEMENT_EVALUATE,
  PLACEMENT_FIRST_PERSON,
  PLACEMENT_HOLDOUT,
  PLACEMENT_NO_CONTACT_SHADOW,
} from '../../geometry/dag/info/placementInfoLayout.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { SHADE_SHADER } from '../../visibility/shader/shadeWgsl.ts'

test('a surface rejects an invalid or off-device size, and nothing else: no byte ceiling', () => {
  const { device } = fakeDevice({ limits: { maxTextureDimension2D: 1024 } })
  assert.throws(() => checkSurfaceSize(device, 0, 10), /INVALID_SURFACE_SIZE/)
  assert.throws(() => checkSurfaceSize(device, 1025, 1), /SURFACE_DEVICE_LIMIT/)
  assert.equal(checkSurfaceSize(device, 100, 100), 280000)
  assert.equal(checkSurfaceSize(device, 1024, 1024), MIB * 28, 'targets follow resolution')
  const pyramid = Math.max(9, 3 * (4 + 1)) * 4 * 2
  assert.equal(
    frameTargetBytes(3, 3, true),
    9 * 52 + 9 * 4 + pyramid + 8 + 16,
    'no material depth: 24 B/px beside the surfaces; the Hi-Z pyramid as made: level 0 (4 B/px, the opaque depth; the front layer is a scene with transparents’ alone), then two slices of max(N, 3M) words (N = 9 at level 0, M = 4 + 1 in the coarser levels, odd levels at ceil dimensions); the 1×1 thin transmission and lobes',
  )
})

test('the per-pixel frame holds the surfaces: 28 B/px', () => {
  assert.equal(SURFACE_BYTES_PER_PIXEL, 28)
  // Read off the formats (`textureBytesOf`): the feedback's 4, the frame's 24 beside the surfaces.
  assert.equal(FEEDBACK_BYTES, 4)
  assert.equal(frameTargetBytes(1, 1, false), 24 + 28 + 8 + 16)
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
  const surface = createSurfaceBuffer(gpu.device, 3840, 2160)
  assert.equal(surface.allocationBytes, 3840 * 2160 * SURFACE_BYTES_PER_PIXEL + 8 + 16)
  assert.equal(gpu.buffers.length, 0, 'no per-pixel buffer beside the targets')
  assert.equal(
    gpu.textures.length,
    4,
    'the colours and the words; disabled transmission and lobes a 1×1 each',
  )
  surface.dispose()
  surface.dispose()
  assert.equal(gpu.destroyed.length, 4, 'four textures, each exactly once')
})

test('a partial surface allocation failure destroys all textures already allocated', () => {
  let created = 0
  const { device, destroyed } = fakeDevice({
    limits: { maxTextureDimension2D: 1024 },
    refuse: () => (++created === 3 ? 'throw' : undefined),
  })
  assert.throws(() => createSurfaceBuffer(device, 16, 16), /NO_MEMORY/)
  assert.equal(destroyed.length, 2)
})

/** The fourth argument of every `SurfaceOut(…)` the resolve builds, and every value it assigns
 *  to `flag`: the expressions of the flags target. */
function flagExpressions(shader: string) {
  const found: string[] = []
  for (const at of shader.matchAll(/SurfaceOut\(/g)) {
    const args: string[] = []
    let depth = 0,
      start = at.index + at[0].length
    for (let i = start; depth >= 0; i++) {
      const c = shader[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      if ((c === ',' && depth === 0) || depth < 0) {
        args.push(shader.slice(start, i))
        start = i + 1
      }
    }
    if (args.length === 5) found.push(args[3])
  }
  for (const [, value] of shader.matchAll(/\bflag=(?!=)([^;]+);/g)) found.push(value)
  return found.filter((expression) => expression !== 'flag')
}

test('every flag the resolve writes fits the flags word unchanged, in eight bits', () => {
  assert.equal(SURFACE_FORMATS[3], 'r32uint')
  const select = (f: number, t: number, c: boolean) => (c ? t : f)
  // The model lane's flag, as the shader maps it (`modelFlag`), run as shipped.
  const lane = shaderRun<{ modelFlag: (flags: number) => number }>(
    wgslModule(modelFlag),
    ['modelFlag'],
    {},
  )
  const written = new Set<number>()
  for (const expression of flagExpressions(SHADE_SHADER)) {
    const run = new Function(
      'select',
      'model',
      'page',
      'flag',
      'emissiveAoFlag',
      'modelFlag',
      'emissive',
      'ao',
      `return ${expression.replace(/(\d)u\b/g, '$1')};`,
    )
    // The page's flags: unlit or lit, its model in its lane — any but the shadow catcher's, which
    // is always blended.
    for (const model of Object.values(SURFACE_MODEL).filter((m) => m !== SURFACE_MODEL.shadow))
      for (const lit of [0, 1])
        for (const flag of [1, 2, 4])
          for (const mark of [0, EMISSIVE_AO_SURFACE_FLAG])
            written.add(
              run(
                select,
                model,
                { flags: lit | (model << MODEL_SHIFT) },
                flag,
                () => mark,
                lane.modelFlag,
              ) as number,
            )
  }
  // Background 0, unlit 1, lit 2, as-is 3, diffuse 4: the whole documented set; a surface
  // shown unlit or lit with its emission-and-occlusion mark; a held-out primitive's pixel, unlit with
  // its own mark above the eight bits.
  const marked = [1, 2, 4].map((flag) => flag | EMISSIVE_AO_SURFACE_FLAG)
  assert.deepEqual(
    [...written].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, ...marked, 1 | HOLDOUT_SURFACE_FLAG],
  )
  for (const value of written) {
    assert.equal(Uint32Array.of(value)[0], value, `${value} as the r32uint target held it`)
    const low = value & ~HOLDOUT_SURFACE_FLAG
    assert.equal(Uint8Array.of(low)[0], low, `${value} in eight bits, the holdout mark apart`)
  }
})

test('a surface wears the marks of its object in its flags: first person, lets the contact shadow rays through, its lighting channels', () => {
  const { withPageMarks } = shaderRun<{
    withPageMarks: (out: { flags: number }, marks: number) => { flags: number }
  }>(SHADE_SHADER, ['withPageMarks'], {})
  const lit = 2
  const flagsOf = (marks: number) => withPageMarks({ flags: lit }, marks).flags
  assert.equal(flagsOf(0), lit, 'no mark, no bit')
  assert.equal(flagsOf(PLACEMENT_FIRST_PERSON), lit | FIRST_PERSON_SURFACE_FLAG)
  assert.equal(flagsOf(PLACEMENT_NO_CONTACT_SHADOW), lit | NO_CONTACT_SHADOW_SURFACE_FLAG)
  assert.equal(
    flagsOf(1 << PLACEMENT_CHANNELS_SHIFT),
    lit | (NO_CONTACT_SHADOW_SURFACE_FLAG << 1),
    'the channels move to their place in the flags, above the contact shadow’s bit',
  )
  assert.equal(
    flagsOf(PLACEMENT_HOLDOUT | PLACEMENT_EVALUATE),
    lit,
    'the switches that are no page marks add nothing',
  )
  assert.equal(
    withPageMarks({ flags: 0 }, PLACEMENT_FIRST_PERSON | PLACEMENT_NO_CONTACT_SHADOW).flags,
    0,
    'an empty surface, nothing drawn, wears none',
  )
})
