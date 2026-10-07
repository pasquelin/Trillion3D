// Puts back, into a shipped shader, the WGSL block from before a fix — without the substitution
// half succeeding or failing in silence.
//
// What a raw `text.replace(shipped, previous)` does not say, and a reproduction must know:
//   — `String.prototype.replace` with a STRING pattern replaces the FIRST occurrence only: a
//     shipped block present twice leaves the second fixed, and the "previous shader" is a mix of
//     both versions, reproducing something other than the defect;
//   — the replacement interprets `$&`, `` $` ``, `$'`, `$$` and `$<name>`: a previous block
//     carrying a `$` would paste crookedly;
//   — a shipped block no longer found returns the text unchanged: the reproduction would replay
//     the FIXED text believing it replays the defect, and conclude "the defect no longer
//     reproduces" on a shader never changed.
// `assert.notEqual(result, text)` catches only the last of the three, and even then only says that
// something moved, not that the expected block did.
//
// This function makes sure of the substitution instead of hoping for it: occurrences counted
// before and after, a replacement by FUNCTION — `replace(shipped, () => previous)`, the only form
// that interprets no `$` —, and an exact round trip: putting the shipped block back must give the
// original text, character for character. It also requires the previous block to carry the marker
// that MAKES the reproduction (the threshold, the formula, what the fix changed) and the shipped
// block not to: a reproduction that no longer reproduces reassures wrongly.
import assert from 'node:assert/strict'
import {
  INVERSE_TRANSPOSE_BEFORE,
  INVERSE_TRANSPOSE_SHIPPED,
} from '../../../packages/sdk-browser/src/gpu/shader/inverseTransposeBefore.fixture.ts'

/** Occurrences of `block` in `text`, without overlap. */
function occurrences(text: string, block: string): number {
  let count = 0
  for (let i = text.indexOf(block); i >= 0; i = text.indexOf(block, i + block.length)) count++
  return count
}

/**
 * `text` with `shipped` replaced by `previous`, or a failure that names exactly what is missing.
 * `name` names the text and `origin` the file of the previous form beside the shipped one, so the
 * message says where to look when the kernel has moved. `marker` is the fragment that tells the
 * previous form from the shipped one.
 */
export function substitutePreviousForm({
  text,
  shipped,
  previous,
  name,
  origin,
  marker,
}: {
  text: string
  shipped: string
  previous: string
  name: string
  origin: string
  marker: string
}): string {
  const where = `${name}: the previous form comes from ${origin}`
  assert.notEqual(shipped, previous, `${where} — both blocks are the same text, nothing to replay`)
  assert.ok(
    previous.includes(marker),
    `${where} — the previous form no longer carries « ${marker} »`,
  )
  assert.ok(!shipped.includes(marker), `${where} — the shipped form still carries « ${marker} »`)
  assert.equal(
    occurrences(text, shipped),
    1,
    `${where} — the shipped block appears ${occurrences(text, shipped)} times in ${name} instead ` +
      `of once: substituting would replace the first only, and the "previous shader" would mix ` +
      `both versions`,
  )
  assert.equal(
    occurrences(text, previous),
    0,
    `${where} — the previous form is ALREADY in ${name}: this is no longer a reproduction`,
  )
  const result = text.replace(shipped, () => previous)
  assert.equal(occurrences(result, previous), 1, `${where} — the previous form was not inserted`)
  assert.equal(occurrences(result, shipped), 0, `${where} — the shipped form stayed in place`)
  assert.equal(
    result.replace(previous, () => shipped),
    text,
    `${where} — the round trip does not give the original text back: the substitution touched ` +
      `something other than the expected block`,
  )
  return result
}

/** `text`, a shader holding the shipped inverse-transpose kernel, with the form from before
 *  defects 6 and 9 put back (`inverseTransposeBefore.fixture.ts`): the absolute threshold on the
 *  raw determinant, and the local vector a singular matrix returned. Both texts are the engine's: a
 *  proof writes neither, or it would replay its own variant of the defect. Each function is
 *  substituted where the program's assembly wrote it. */
export const inverseTransposeBeforeIn = (text: string, name: string) => {
  const origin = 'packages/sdk-browser/src/gpu/shader/inverseTransposeBefore.fixture.ts'
  const prepared = substitutePreviousForm({
    text,
    shipped: INVERSE_TRANSPOSE_SHIPPED.prep,
    previous: INVERSE_TRANSPOSE_BEFORE.prep,
    name,
    origin,
    marker: 'abs(det)<1e-20',
  })
  return substitutePreviousForm({
    text: prepared,
    shipped: INVERSE_TRANSPOSE_SHIPPED.apply,
    previous: INVERSE_TRANSPOSE_BEFORE.apply,
    name,
    origin,
    marker: 'select(v,',
  })
}
