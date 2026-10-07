import assert from 'node:assert/strict'
import { type WgslSource, wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

/** A WGSL function of `shader`, from `fn name(` to the brace that closes its body, that brace and
 *  the line break before it excluded: a one-line function ends on its own line, not at the next
 *  function's closing line. */
export const functionText = (input: WgslSource, name: string) => {
  const shader = wgslSource(input)
  const start = shader.indexOf(`fn ${name}(`)
  assert.ok(start >= 0, `${name} is declared`)
  let depth = 0
  for (let at = shader.indexOf('{', start); at >= 0 && at < shader.length; at++) {
    if (shader[at] === '{') depth++
    else if (shader[at] === '}' && --depth === 0)
      return shader.slice(start, shader[at - 1] === '\n' ? at - 1 : at)
  }
  assert.fail(`${name} is closed`)
}
