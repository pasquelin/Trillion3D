// One bit per axis, never both modes of the same axis, no bit in clamp.
// Each material map addresses its texture in its own wrap. Each texture's header
// therefore carries its own nibble, and each shader read folds by the nibble of the texture it
// samples — not the material flags, which carry only one for all of them.
// Proof on a real GPU is `tests/gpu/texture/texture-addressing.gpu.ts`.
import type { Texture, WrapMode } from '../../../sdk-core/src/texture/contract.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { wrapNibble } from './wrapModes.ts'
import { SHADE_SHADER } from './shader/shadeWgsl.ts'
import { maskKeepWgsl } from './shader/pageWgsl.ts'
import { maskAlphaWgsl } from '../webgpu/tile/wgsl.ts'
import { MAPS, mixedNibbles } from '../../../../tests/gpu/texture/addressingMaps.ts'
import { BLEND_SHADER } from '../gpu/core/shaderTexts.fixture.ts'

/** The nibble's bits, as the texture header writes them: repeat and mirror of S, then of T. */
const [WRAP_S_REPEAT, WRAP_S_MIRROR, WRAP_T_REPEAT, WRAP_T_MIRROR] = [1, 2, 4, 8]
const carte = (wrapS: WrapMode, wrapT: WrapMode) => ({ wrapS, wrapT }) as Texture
/** Expected nibble of a fixture entry, recomputed from its two declared wrap modes. */
const expected = (c: (typeof MAPS)[number]) => wrapNibble(carte(c.wrapS, c.wrapT))

test('wrapNibble sets the repeat or mirror bit per axis, no bit in clamp', () => {
  assert.equal(wrapNibble(undefined), 0, 'no map')
  assert.equal(wrapNibble(carte('clamp', 'clamp')), 0)
  assert.equal(wrapNibble(carte('repeat', 'repeat')), WRAP_S_REPEAT | WRAP_T_REPEAT)
  assert.equal(wrapNibble(carte('mirror', 'mirror')), WRAP_S_MIRROR | WRAP_T_MIRROR)
  assert.equal(
    wrapNibble(carte('mirror', 'repeat')),
    WRAP_S_MIRROR | WRAP_T_REPEAT,
    'a different mode per axis sets a different bit per axis',
  )
  assert.equal(wrapNibble(carte('clamp', 'mirror')), WRAP_T_MIRROR, 'S in clamp sets no S bit')
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
    // Each map at the UV set its record names: the resolve's `mapCoord`, the transparent pass's
    // `blendUv` (`blendSurfaceWgsl`).
    assert.match(
      text,
      /colorSample\(m\.mapIndex,mapCoord\(m,0u\)\.uv,mapCoord\(m,0u\)\.ddx,mapCoord\(m,0u\)\.ddy,HAS_SAMPLING\)|colorSample\(in\.ids\.x,c\.uv,c\.ddx,c\.ddy,blendSampled\(in\)\)/,
    )
    assert.doesNotMatch(text, /wrapOf|wrapModes/, 'no per-material addressing word')
  })

test('alpha cut-out addresses the base map by its header, never by the flags', () => {
  assert.ok(
    maskKeepWgsl(maskAlphaWgsl(false)).text.includes(
      'maskAlpha(m.mapIndex,uv,ddx,ddy,(page.flags&64u)!=0u)',
    ),
  )
})
