// What reconstructing the previous form is worth, in the reproduction benches of the
// inverse-transpose and normal-transform defects
// (`tests/gpu/math/inverse-transpose-small-scale.gpu.ts` and
// `normal-transform-small-scale.gpu.ts`).
//
// A bare `text.replace(INVERSE_TRANSPOSE_WGSL, INVERSE_TRANSPOSE_BEFORE_WGSL)`, guarded by a single
// `assert.notEqual(result, text)`, catches the case where the shipped block is not
// found, but it only says "something moved": it lets a partial substitution through (shipped
// block present twice, only the first replaced) and a crooked substitution (`$&`, `` $` ``, `$'`,
// `$$` interpreted in the replacement). In both cases the bench would replay a shader that is NOT
// the previous form, and conclude on it.
//
// `substitutionBefore.ts` replaces that guard with a proof. This test keeps its failure messages:
// a substitution that does not happen must say which case we are in, and where to go.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from '../gpu/dag/shader/shader.ts'
import { INVERSE_TRANSPOSE_WGSL } from '../gpu/shader/inverseTransposeWgsl.ts'
import { NORMAL_TRANSFORM_WGSL } from '../lighting/standardLighting.ts'
import { substitutePreviousForm } from '../../../../tests/gpu/math/substitutionBefore.ts'
import { INVERSE_TRANSPOSE_BEFORE_WGSL } from '../gpu/shader/inverseTransposeBefore.fixture.ts'

const ORIGIN = 'packages/sdk-browser/src/gpu/shader/inverseTransposeWgsl.ts'
const ABSOLUTE_THRESHOLD = 'abs(det)<1e-20'
const real = (text: string, name: string) => ({
  text,
  shipped: INVERSE_TRANSPOSE_WGSL,
  previous: INVERSE_TRANSPOSE_BEFORE_WGSL,
  name,
  origin: ORIGIN,
  marker: ABSOLUTE_THRESHOLD,
})

test('on the two real shaders, substitution yields the pre-batch form', () => {
  for (const [name, text] of [
    ['DAG selection', DAG_SELECTION_SHADER],
    ['lighting', NORMAL_TRANSFORM_WGSL],
  ] as const) {
    const before = substitutePreviousForm(real(text, name))
    assert.ok(
      before.includes(ABSOLUTE_THRESHOLD),
      `${name}: the absolute threshold did not come back`,
    )
    assert.ok(
      !text.includes(ABSOLUTE_THRESHOLD),
      `${name}: the shipped text still carries the threshold`,
    )
    assert.equal(
      before.length,
      text.length - INVERSE_TRANSPOSE_WGSL.length + INVERSE_TRANSPOSE_BEFORE_WGSL.length,
    )
  }
})

/** The call must throw, and the message must contain that fragment. */
function fails(options: Parameters<typeof substitutePreviousForm>[0], fragment: string) {
  assert.throws(
    () => substitutePreviousForm(options),
    (error: Error) => {
      assert.ok(error.message.includes(fragment), `message without "${fragment}": ${error.message}`)
      assert.ok(error.message.includes(ORIGIN), `message without the origin: ${error.message}`)
      return true
    },
  )
}

test('shipped block not found: the bench stops instead of replaying the fixed text', () => {
  // The case that counts: the kernel moved and the previous constant no longer matches it. Without
  // a guard, `replace` returns the unchanged text and the bench measures the FIXED version on both sides.
  fails(
    { ...real(DAG_SELECTION_SHADER, 'shader without the block'), shipped: 'fn neverWritten(){}' },
    'appears 0 times',
  )
})

test('shipped block present twice: the substitution would be partial', () => {
  fails(
    real(`${DAG_SELECTION_SHADER}\n${INVERSE_TRANSPOSE_WGSL}`, 'shader with doubled block'),
    'appears 2 times',
  )
})

test('a "$" in the previous form: the raw replace pastes crookedly, this one does not', () => {
  // `$&` is the matched text: a raw `replace(shipped, previous)` pastes the SHIPPED block into the
  // "previous shader", which then replays the fixed version in the middle of the defect. The
  // function-based replace, itself, reads no `$`.
  const withDollar = `${INVERSE_TRANSPOSE_BEFORE_WGSL}\n// $&`
  const naive = DAG_SELECTION_SHADER.replace(INVERSE_TRANSPOSE_WGSL, withDollar)
  assert.ok(naive.includes(INVERSE_TRANSPOSE_WGSL), 'the raw replace did not interpret "$&"')
  const sound = substitutePreviousForm({
    ...real(DAG_SELECTION_SHADER, 'previous form with $&'),
    previous: withDollar,
  })
  assert.ok(
    !sound.includes(INVERSE_TRANSPOSE_WGSL),
    'the shipped block stayed in the previous shader',
  )
  assert.ok(sound.includes('// $&'), 'the "$&" must stay the text it is')
  assert.equal(
    sound.length,
    DAG_SELECTION_SHADER.length - INVERSE_TRANSPOSE_WGSL.length + withDollar.length,
  )
})

test('a previous form that no longer carries the marker reproduces nothing', () => {
  fails(
    {
      ...real(DAG_SELECTION_SHADER, 'previous form without threshold'),
      previous: INVERSE_TRANSPOSE_WGSL,
    },
    'both blocks are the same text',
  )
  fails(
    {
      ...real(DAG_SELECTION_SHADER, 'watered-down previous form'),
      previous: INVERSE_TRANSPOSE_BEFORE_WGSL.replace(ABSOLUTE_THRESHOLD, 'abs(det)<1e-30'),
    },
    `no longer carries « ${ABSOLUTE_THRESHOLD} »`,
  )
})

test('the previous form already present in the text: this is no longer a reproduction', () => {
  const alreadyBefore = DAG_SELECTION_SHADER.replace(
    INVERSE_TRANSPOSE_WGSL,
    () => INVERSE_TRANSPOSE_BEFORE_WGSL,
  )
  fails(real(alreadyBefore, 'shader already rolled back'), 'appears 0 times')
})
