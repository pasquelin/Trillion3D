// Common-formulas lot: each WGSL fragment factored out of `pageWgsl.ts` must stay the
// unique write of its identifier, and each shader that assembles it must carry it only once —
// two copies in the same text would be two chances of seeing it drift, as before this lot.
import { importWrapMode } from '../../host/wrapImport.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import {
  PAGE_INFO_STRUCT_WGSL,
  EDGE_WGSL,
  PAGE_VERTEX_WGSL,
  PAGE_UV_WGSL,
  MASK_KEEP_WGSL,
  BARY_WEIGHTS_WGSL,
} from './pageWgsl.ts'
import { WRAP_COORD_WGSL } from '../wrapModes.ts'
import { linearTexels } from '../../../../../tests/gpu/texture/addressingCases.ts'
import { COLOR_SAMPLE_WGSL, DATA_SAMPLE_WGSL, maskAlphaWgsl } from '../../webgpu/tile/wgsl.ts'
import { rasterSource } from '../../gpu/raster/shader.ts'
import { SHADE_SHADER } from './shadeWgsl.ts'
import { VIS_SHADER } from './visWgsl.ts'
import { wrapLinear } from '../wrapModes.fixture.ts'
import { TAA_SHADER } from '../../gpu/core/shaderTexts.fixture.ts'

const SMALL_SHADER = rasterSource(4, 16)

/** How many times `fragment` appears, character for character, in `text`. */
const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1

function eachOnce(fragment: string, shaders: Record<string, string>) {
  for (const [name, text] of Object.entries(shaders))
    assert.equal(occurrences(text, fragment), 1, `${name} should carry the fragment once`)
}

test('PAGE_INFO_STRUCT_WGSL declares struct PageInfo only once in every shader that reads it', () => {
  assert.match(PAGE_INFO_STRUCT_WGSL, /struct PageInfo\{/)
  eachOnce(PAGE_INFO_STRUCT_WGSL, {
    SMALL_SHADER,
    SHADE_SHADER,
    VIS_SHADER,
    TAA_SHADER,
  })
})

test('EDGE_WGSL declares fn edge only once in the small-triangle raster and in shading', () => {
  assert.match(EDGE_WGSL, /fn edge\(/)
  eachOnce(EDGE_WGSL, { SMALL_SHADER, SHADE_SHADER })
})

test('PAGE_VERTEX_WGSL declares fn vertPos only once in the raster and shading', () => {
  assert.match(PAGE_VERTEX_WGSL, /fn vertPos\(/)
  eachOnce(PAGE_VERTEX_WGSL, { SHADE_SHADER, VIS_SHADER })
})

test('PAGE_UV_WGSL declares fn vertUv only once in the raster and shading', () => {
  assert.match(PAGE_UV_WGSL, /fn vertUv\(/)
  eachOnce(PAGE_UV_WGSL, { SHADE_SHADER, VIS_SHADER })
})

test('WRAP_COORD_WGSL declares fn wrapCoord only once, directly as via MASK_KEEP_WGSL', () => {
  assert.match(WRAP_COORD_WGSL, /fn wrapCoord\(/)
  eachOnce(WRAP_COORD_WGSL, { SMALL_SHADER, SHADE_SHADER, VIS_SHADER })
})

test('MASK_KEEP_WGSL declares fn maskKeep only once in the raster', () => {
  assert.match(MASK_KEEP_WGSL, /fn maskKeep\(/)
  eachOnce(MASK_KEEP_WGSL, { SMALL_SHADER, VIS_SHADER })
})

test('BARY_WEIGHTS_WGSL declares fn baryWeights only once in shading, never in the raster', () => {
  assert.match(BARY_WEIGHTS_WGSL, /fn baryWeights\(/)
  eachOnce(BARY_WEIGHTS_WGSL, { SHADE_SHADER })
  // The raster decides coverage on its three edges, not on derived weights.
  assert.doesNotMatch(SMALL_SHADER, /baryWeights/)
})

// Defect 7: under linear filtering with `Repeat`, a period's seam must mix the last texel and
// the first. The oracle rule is in tests/gpu/texture/addressingCases.ts, written
// independently of `wrapLinear` and already checked against the real WebGPU sampler by
// `tests/gpu/texture/texture-addressing.gpu.ts`: the low rank comes from the coordinate shifted by
// a half-texel, and each of the two ranks undergoes the mode for itself (WebGPU's sampler rule).
// Copying it here used to make a third write of the same rule.
const regle = linearTexels
/** The value the two mixed texels yield: tap order is not imposed, colour is. */
const valeur = ([i0, i1, weights]: [number, number, number]) => i0 * (1 - weights) + i1 * weights

test('wrapLinear mixes the two texels of the rule, a period seam included', () => {
  const coordonnees = []
  for (const entier of [-1001, -3, -1, 0, 1, 2, 1000])
    for (const reste of [0, 0.01, 0.2, 0.499, 0.5, 0.501, 0.8, 0.99])
      coordonnees.push(Math.fround(entier + reste))
  let couture = 0
  for (const taille of [1, 2, 3, 4, 5, 8])
    for (const wrap of [G.HOST_WRAP_CLAMP_TO_EDGE, G.HOST_WRAP_REPEAT, G.HOST_WRAP_MIRRORED_REPEAT])
      for (const t of coordonnees) {
        const expected = regle(t, taille, wrap)
        if (expected[1] !== expected[0] + 1 && wrap === G.HOST_WRAP_REPEAT) couture++
        assert.ok(
          Math.abs(valeur(wrapLinear(t, taille, importWrapMode(wrap))) - valeur(expected)) <= 1e-9,
          `${taille} texels, t=${t}: rule ${expected}, read ${wrapLinear(t, taille, importWrapMode(wrap))}`,
        )
      }
  assert.ok(couture > 100, `the series must exercise the seam, only ${couture} cases`)
})

// Folding a coordinate cannot wrap a period: both taps and their weight are therefore carried
// through to the atlas reads, which mix four reads on the seam and a single one elsewhere. A
// read that took the folded coordinate alone would reopen the defect.
test("atlas reads fold by their texture's nibble and mix four taps", () => {
  assert.match(
    WRAP_COORD_WGSL,
    /struct WrapTaps\{proche:vec2f,loin:vec2f,poids:vec2f,couture:bool,\}/,
  )
  for (const [nom, bloc] of Object.entries({
    COLOR_SAMPLE_WGSL,
    MASK_ALPHA_WGSL: maskAlphaWgsl(true),
    DATA_SAMPLE_WGSL,
  })) {
    // Each level folds on its own size: a mip level's seam is half of its own texel wide.
    assert.match(
      `${COLOR_SAMPLE_WGSL}${DATA_SAMPLE_WGSL}${bloc}`,
      /(color|data)Blend\(/,
      `${nom} must read through the level blend`,
    )
    // #360, #361: the header is read once, then the default read — the footprint's level, no
    // other test — unless the page's maps take their filter rule (`sampled`), blended and
    // shadow alike.
    assert.match(
      bloc,
      /let s=(color|data)Slot\(slot\);\n if\(sampled\)\{return \w+Sampled\(slot,s,uv,ddx,ddy\);\}\n return \w+At\(s,uv,slotLod\(s,ddx,ddy\),false\);/,
      `${nom} must read its header once, then the default read`,
    )
    assert.match(
      bloc,
      /let r=(color|data)Footprint\(slot,s,uv,ddx,ddy,(true|false)\);/,
      `${nom} must read its footprint once when sampled`,
    )
  }
  for (const [nom, bloc] of Object.entries({ COLOR_SAMPLE_WGSL, DATA_SAMPLE_WGSL })) {
    assert.match(
      bloc,
      /let t=wrapUv\(uv,s\.wrap,levelSize\(s\.size,level\)\);/,
      `${nom} must fold each level on that level's size`,
    )
    assert.match(bloc, /if\(!t\.couture\|\|nearest\)\{return /, `${nom} must keep the unique read`)
    assert.match(
      bloc,
      /mix\(mix\(s00,s10,t\.poids\.x\),mix\(s01,s11,t\.poids\.x\),t\.poids\.y\)/,
      nom,
    )
  }
  for (const [nom, text] of Object.entries({
    SMALL_SHADER,
    SHADE_SHADER,
    VIS_SHADER,
  }))
    // An atlas read (`let t=wrapUv(`) or the feedback that names it (`return wrapUv(`): the
    // coordinate the pixel asks for is the one it reads.
    assert.equal(
      occurrences(text, 'wrapUv('),
      occurrences(text, 'fn wrapUv(') +
        occurrences(text, 'let t=wrapUv(') +
        occurrences(text, 'return wrapUv('),
      `${nom} only folds a coordinate in an atlas read, never on its own account`,
    )
})
