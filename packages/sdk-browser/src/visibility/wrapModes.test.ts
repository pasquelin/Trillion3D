// One bit per axis, never both modes of the same axis, no bit in clamp.
// Each material map addresses its texture in its own wrap. Each texture's header
// therefore carries its own nibble, and each shader read folds by the nibble of the texture it
// samples — not the material flags, which carry only one for all of them.
// Proof on a real GPU is `tests/gpu/texture/texture-addressing.gpu.ts`.
import type { Texture } from '../../../sdk-core/src/index.ts'
import { importWrapMode } from '../host/wrapImport.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import {
  WRAP_S_MIRROR,
  WRAP_S_REPEAT,
  WRAP_T_MIRROR,
  WRAP_T_REPEAT,
  wrapNibble,
} from './wrapModes.ts'
import { SHADE_SHADER } from './shader/shadeWgsl.ts'
import { MASK_KEEP_WGSL } from './shader/pageWgsl.ts'
import { MAPS, mixedNibbles } from '../../../../tests/gpu/texture/addressingMaps.ts'
import { BLEND_SHADER } from '../gpu/core/shaderTexts.fixture.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

const carte = (wrapS: number, wrapT: number) =>
  ({ wrapS: importWrapMode(wrapS), wrapT: importWrapMode(wrapT) }) as Texture
/** Expected nibble of a fixture entry, recomputed from its two declared wrap modes. */
const expected = (c: (typeof MAPS)[number]) => wrapNibble(carte(c.wrapS, c.wrapT))

test('wrapNibble sets the repeat or mirror bit per axis, no bit in clamp', () => {
  assert.equal(wrapNibble(undefined), 0, 'no map')
  assert.equal(wrapNibble(carte(G.HOST_WRAP_CLAMP_TO_EDGE, G.HOST_WRAP_CLAMP_TO_EDGE)), 0)
  assert.equal(
    wrapNibble(carte(G.HOST_WRAP_REPEAT, G.HOST_WRAP_REPEAT)),
    WRAP_S_REPEAT | WRAP_T_REPEAT,
  )
  assert.equal(
    wrapNibble(carte(G.HOST_WRAP_MIRRORED_REPEAT, G.HOST_WRAP_MIRRORED_REPEAT)),
    WRAP_S_MIRROR | WRAP_T_MIRROR,
  )
  assert.equal(
    wrapNibble(carte(G.HOST_WRAP_MIRRORED_REPEAT, G.HOST_WRAP_REPEAT)),
    WRAP_S_MIRROR | WRAP_T_REPEAT,
    'a different mode per axis sets a different bit per axis',
  )
  assert.equal(
    wrapNibble(carte(G.HOST_WRAP_CLAMP_TO_EDGE, G.HOST_WRAP_MIRRORED_REPEAT)),
    WRAP_T_MIRROR,
    'S in clamp sets no S bit',
  )
})

test('each map carries its own nibble in its header, whatever the others', () => {
  const lus = mixedNibbles()
  for (const [i, entree] of MAPS.entries())
    assert.equal(lus[i], expected(entree), `map ${entree.name} in its header`)
  assert.equal(new Set(lus).size, MAPS.length, 'six maps, six distinct nibbles')
})

// Every atlas read folds by the nibble of the texture it reads, from that texture's header: no
// read takes an addressing argument, so none can take another map's (`../texture/sampling.ts`).
for (const [nom, text] of Object.entries({ SHADE_SHADER, BLEND_SHADER }))
  test(`${nom} reads each map with no addressing argument`, () => {
    // The transparent pass reads its first UV set, `in.uv.xy`: a lobed program carries a second
    // one in the same varying (`blendSurfaceWgsl`).
    assert.match(
      text,
      /colorSample\(page\.mapIndex,uv,ddx,ddy,HAS_SAMPLING\)|colorSample\(in\.ids\.x,in\.uv\.xy,g\.gradX,g\.gradY,blendSampled\(in\)\)/,
    )
    assert.doesNotMatch(text, /wrapOf|wrapModes/, 'no per-material addressing word')
  })

test('alpha cut-out addresses the base map by its header, never by the flags', () => {
  assert.ok(
    wgslSource(MASK_KEEP_WGSL).includes('maskAlpha(page.mapIndex,uv,ddx,ddy,(page.flags&64u)!=0u)'),
  )
})
