// The cards' visibility stage writes an identifier and a depth: it reads each card pixel's coverage
// and surface point alone, never the normal or the ORM maps, which only the surface stage writes.
// Both stages keep the same pixels: they blend the coverage through one function. Fails on the old
// pass: the visibility stage blended the whole surface, six page-table reads a pixel it threw away.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../impostor/lent.fixture.ts'
import { cardPassWgsl } from './cardWgsl.ts'
import { core } from '../../impostor/borrowed.ts'

/** The functions `entry` reaches in `code`, by name. */
function reached(code: string, entry: string) {
  const bodies = new Map<string, string>()
  const heads = [...code.matchAll(/fn (\w+)\(/g)]
  heads.forEach((head, i) => bodies.set(head[1], code.slice(head.index, heads[i + 1]?.index)))
  const seen = new Set<string>(),
    stack = [entry]
  while (stack.length) {
    const name = stack.pop()!
    if (seen.has(name) || !bodies.has(name)) continue
    seen.add(name)
    for (const [callee] of bodies)
      if (callee !== name && new RegExp(`\\b${callee}\\(`).test(bodies.get(name)!))
        stack.push(callee)
  }
  return seen
}

test('the visibility stage reads the coverage and point of a card pixel, never its normal or ORM', () => {
  const code = cardPassWgsl(core.cardTileWgsl())
  for (const entry of ['card_vis_fs', 'card_vis_hiz_fs']) {
    const fns = reached(code, entry)
    assert.ok(fns.has('impColours') && fns.has('impPoint'), `${entry} reads coverage and point`)
    for (const surface of ['impBlend', 'impOrm'])
      assert.ok(!fns.has(surface), `${entry} never reaches ${surface}`)
  }
  const surface = reached(code, 'card_fs')
  assert.ok(surface.has('impBlend') && surface.has('impColours'), 'one coverage for both stages')
})
