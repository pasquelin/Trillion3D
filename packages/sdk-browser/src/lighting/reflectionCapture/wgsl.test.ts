// The reflection captures' programs (`compositeWgsl.ts`, `captureWgsl.ts`, `localLightWgsl.ts`) assemble, hold their entries and bindings, and
// follow the engine's rules for shader text (no word of the reference, no reserved WGSL word as a name, no backtick).
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { SKY_CUBE_WGSL, SKY_SAMPLING_WGSL } from '../../modules/sky/skyLight/cubeWgsl.ts'
import { offSpecularPeakDirection } from '../deferred/ambientCubemapWgsl.ts'
import { ENVIRONMENT_LIGHTING_WGSL } from '../direct/lightingWgsl.ts'
import { DEFERRED_CAPTURE_BINDINGS } from '../deferred/bindings.ts'
import { capturedLocalLightWgsl } from './localLightWgsl.ts'
import {
  CAPTURE_COPY_CODE,
  CAPTURE_COPY_ENTRY,
  CAPTURE_DIFFUSE_CODE,
  CAPTURE_DIFFUSE_ENTRIES,
} from './captureWgsl.ts'
import { reflectionCapturesWgsl, reflectionCaptureLayoutEntries } from './compositeWgsl.ts'
import { CAPTURE_RECORD_WORDS, MAX_REFLECTION_CAPTURES } from './layout.ts'

const RESERVED = [
  'target',
  'filter',
  'from',
  'type',
  'patch',
  'set',
  'get',
  'ref',
  'self',
  'sample',
  'smooth',
  'pass',
  'use',
]
const identifiers = (text: string) =>
  [...text.matchAll(/\b(?:let|var|const|fn)\s+([A-Za-z_]\w*)/g)].map((m) => m[1])

const programs = {
  composite: wgslModule(reflectionCapturesWgsl(DEFERRED_CAPTURE_BINDINGS)),
  local: wgslModule(capturedLocalLightWgsl(DEFERRED_CAPTURE_BINDINGS)),
  copy: CAPTURE_COPY_CODE,
  diffuse: CAPTURE_DIFFUSE_CODE,
}

test('each program holds its entries and bindings', () => {
  assert.match(programs.copy, new RegExp(`fn ${CAPTURE_COPY_ENTRY}`))
  for (const entry of Object.values(CAPTURE_DIFFUSE_ENTRIES))
    assert.match(programs.diffuse, new RegExp(`fn ${entry}\\(`))
  const { cube, sampler, block } = DEFERRED_CAPTURE_BINDINGS
  for (const binding of [cube, sampler, block])
    assert.match(programs.composite, new RegExp(`@binding\\(${binding}\\)`))
  assert.match(
    programs.composite,
    new RegExp(`array<ReflectionCapture,${MAX_REFLECTION_CAPTURES}>`),
  )
  assert.match(programs.local, /fn resolvedLocalLight\(/)
  assert.match(programs.local, /fn capturedAmbient\(/)
  assert.deepEqual(
    reflectionCaptureLayoutEntries(DEFERRED_CAPTURE_BINDINGS, 2).map((e) => e.binding),
    [cube, sampler, block],
  )
})

test('the record struct has the words the host packs', () => {
  const struct = /struct ReflectionCapture\{([^}]*)\}/.exec(programs.composite)![1]
  assert.equal(
    struct.split(',').filter((field) => field.includes('vec4f')).length * 4,
    CAPTURE_RECORD_WORDS,
  )
})

/** The lines of the code these programs list (the sky light's cube, the environment's lighting), which are not theirs to change. */
const listed = new Set(
  wgslModule(
    SKY_CUBE_WGSL,
    SKY_SAMPLING_WGSL,
    ENVIRONMENT_LIGHTING_WGSL,
    offSpecularPeakDirection,
  ).split('\n'),
)

test('the text follows the rules: no word of the reference, no reserved name, no backtick', () => {
  for (const [name, text] of Object.entries(programs)) {
    assert.doesNotMatch(text, /unreal|epic|lumen|nanite|substrate/i, name)
    for (const line of text.split('\n'))
      assert.ok(!line.includes('`') || listed.has(line), `${name} holds a backtick: ${line}`)
    for (const id of identifiers(text)) assert.ok(!RESERVED.includes(id), `${name} names ${id}`)
  }
})
